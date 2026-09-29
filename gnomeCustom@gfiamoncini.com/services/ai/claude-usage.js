// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Cota do Claude: acha as contas do Claude Code nesta máquina e pergunta à API
 * quanto de cada uma já foi usado. Só Soup, Gio e GLib, sem APIs do Shell: a
 * página de preferências usa o mesmo serviço para listar as contas.
 *
 * **Nunca escreve nas pastas do Claude Code, e é uma decisão.** O token vence de
 * tempos em tempos; renovar rotacionaria o `refreshToken`, e duas coisas
 * gravando no mesmo arquivo de credenciais (o Claude Code e nós) é como se perde
 * o login. Vencido, o card diz "sessão expirada" até o próximo uso do Claude
 * Code, que renova sozinho.
 *
 * **O token não vai para o log**, nem inteiro nem em pedaço, nem em mensagem de
 * erro: registra-se o código da resposta e o estado.
 *
 * As chamadas usam callback em vez de `Gio._promisify`, pelo mesmo motivo do
 * cliente do clima (`services/weather/openmeteo.js`).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {
    DEFAULT_ACCOUNT_ID, FRESH_SECONDS, OAUTH_BETA, State, USAGE_URL,
    accountId, chooseProfiles, identityPaths, parseCredentials, parseIdentity,
    parseUsage, retryAfterSeconds, sortAccountIds,
} from '../../lib/ai-usage.js';

/**
 * @typedef {object} Profile
 * @property {string} id nome da pasta ('.claude', '.claude-bm')
 * @property {string} dir caminho completo
 * @property {?string} name
 * @property {?string} email
 * @property {?string} organization
 * @property {?string} role
 */

/**
 * @typedef {object} AccountUsage
 * @property {Profile} profile
 * @property {string} state um de `State`
 * @property {object[]} gauges de `parseUsage`
 * @property {?string} plan
 * @property {?{kind: string, status?: number, until?: number}} error por que a leitura falhou
 * @property {?number} since ms da leitura, quando os números são de uma anterior
 */

/** O Soup 3 não tem constante para o 429. */
const TOO_MANY_REQUESTS = 429;

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

export class ClaudeUsageService {
    /**
     * @param {object} [options]
     * @param {object} [options.logger]
     * @param {string} [options.home] os testes apontam para uma pasta de mentira
     * @param {Function} [options.now] () => ms
     */
    constructor({logger = null, home = GLib.get_home_dir(), now = () => Date.now()} = {}) {
        this._logger = logger;
        this._home = home;
        this._now = now;
        this._cancellable = new Gio.Cancellable();
        this._session = null;
        this._identities = new Map();   // caminho -> {mtime, identity}
        this._states = new Map();       // id -> {last, readAt, waitUntil}
    }

    // ------------------------------------------------------------ contas

    /**
     * As contas do Claude Code aqui: toda pasta `~/.claude*` com um
     * `.credentials.json` dentro, mais a que `CLAUDE_CONFIG_DIR` apontar (ela
     * pode estar fora do home). A padrão primeiro, as outras em ordem alfabética.
     *
     * @returns {Profile[]}
     */
    profiles() {
        const dirs = new Map();   // id -> caminho
        const consider = path => {
            if (path && GLib.file_test(`${path}/.credentials.json`, GLib.FileTest.EXISTS)) {
                const id = accountId(path);
                if (!dirs.has(id))
                    dirs.set(id, path);
            }
        };

        consider(`${this._home}/${DEFAULT_ACCOUNT_ID}`);
        try {
            const enumerator = Gio.File.new_for_path(this._home).enumerate_children(
                'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (name.startsWith('.claude') && info.get_file_type() === Gio.FileType.DIRECTORY)
                    consider(`${this._home}/${name}`);
            }
            enumerator.close(null);
        } catch (e) {
            this._logger?.warn(`cota de IA: não deu para procurar as contas (${e.message})`);
        }

        const pointed = GLib.getenv('CLAUDE_CONFIG_DIR');
        if (pointed)
            consider(GLib.canonicalize_filename(pointed, this._home));

        return sortAccountIds([...dirs.keys()]).map(id => this._identity(id, dirs.get(id)));
    }

    /**
     * Quem está logado numa pasta. Guardado entre leituras e conferido pela data
     * do arquivo: o `.claude.json` tem centenas de KB (histórico de projetos) e
     * reler tudo a cada volta seria pagar o parse inteiro por quatro campos.
     */
    _identity(id, dir) {
        const base = {id, dir, name: null, email: null, organization: null, role: null};
        for (const path of identityPaths(this._home, dir)) {
            const file = Gio.File.new_for_path(path);
            let mtime;
            try {
                mtime = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
                    .get_attribute_uint64('time::modified');
            } catch {
                continue;   // não existe aqui: tenta o próximo lugar
            }

            const cached = this._identities.get(path);
            if (cached?.mtime === mtime)
                return {...base, ...cached.identity};
            try {
                const [, bytes] = file.load_contents(null);
                const identity = parseIdentity(JSON.parse(new TextDecoder().decode(bytes)));
                this._identities.set(path, {mtime, identity});
                return {...base, ...identity};
            } catch (e) {
                this._logger?.debug(`cota de IA (${id}): não deu para ler a conta (${e.name})`);
                return base;
            }
        }
        return base;
    }

    // ------------------------------------------------------------ leitura

    /**
     * Lê a cota das contas escolhidas, em paralelo.
     *
     * @param {string[]} chosen ids; vazio é "todas"
     * @param {object} [options]
     * @param {boolean} [options.force] ignora a validade da leitura anterior (não o castigo do 429)
     * @returns {Promise<AccountUsage[]>}
     */
    async read(chosen = [], {force = false} = {}) {
        const profiles = chooseProfiles(this.profiles(), chosen);
        return Promise.all(profiles.map(p => this._cached(p, force)));
    }

    /**
     * A leitura de uma conta respeitando a validade da anterior e o castigo do
     * 429. Uma leitura que falha nunca apaga os números que já havia: barras de
     * dois minutos atrás com um aviso valem mais que uma mensagem de erro.
     */
    async _cached(profile, force) {
        let state = this._states.get(profile.id);
        if (!state) {
            state = {last: null, readAt: 0, waitUntil: 0};
            this._states.set(profile.id, state);
        }
        const now = this._now();

        if (state.last) {
            if (!force && now - state.readAt < FRESH_SECONDS * 1000)
                return {...state.last, profile, error: null, since: null};
            if (now < state.waitUntil)
                return this._stale(state, profile, {kind: 'rate-limited', until: state.waitUntil});
        } else if (now < state.waitUntil) {
            return this._result(profile, State.FAILED, [], null,
                {kind: 'rate-limited', until: state.waitUntil});
        }

        const reading = await this._readAccount(profile);

        if (reading.state === State.OK) {
            state.last = reading;
            state.readAt = now;
            state.waitUntil = 0;
            return reading;
        }

        if (reading.retryAfter) {
            state.waitUntil = now + reading.retryAfter * 1000;
            this._logger?.info(`cota de IA (${profile.id}): esperando ` +
                `${Math.round(reading.retryAfter / 60)} min antes de perguntar de novo`);
            reading.error = {kind: 'rate-limited', until: state.waitUntil};
        }
        delete reading.retryAfter;

        return state.last ? this._stale(state, profile, reading.error) : reading;
    }

    _stale(state, profile, error) {
        return {...state.last, profile, error, since: state.readAt};
    }

    _result(profile, state, gauges, plan, error = null) {
        return {profile, state, gauges, plan, error, since: null};
    }

    async _readAccount(profile) {
        let credentials;
        try {
            const text = await this._readText(`${profile.dir}/.credentials.json`);
            credentials = parseCredentials(JSON.parse(text), this._now());
        } catch (e) {
            if (isCancelled(e))
                throw e;
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return this._result(profile, State.NO_CREDENTIALS, [], null);
            // Só o tipo: a mensagem de um JSON quebrado pode trazer pedaço do arquivo.
            this._logger?.warn(`cota de IA (${profile.id}): não deu para ler as credenciais (${e.name})`);
            return this._result(profile, State.FAILED, [], null, {kind: 'credentials'});
        }

        if (credentials.state !== State.OK)
            return this._result(profile, credentials.state, [], credentials.plan);

        let response;
        try {
            response = await this._get(credentials.token);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            this._logger?.warn(`cota de IA (${profile.id}): falha ao consultar a API (${e.message})`);
            return this._result(profile, State.FAILED, [], credentials.plan, {kind: 'network'});
        }

        const {status} = response;
        if (status !== Soup.Status.OK) {
            this._logger?.warn(`cota de IA (${profile.id}): a API respondeu ${status}`);
            // 401 é token recusado: na prática, vencido do lado de lá.
            const state = status === Soup.Status.UNAUTHORIZED ? State.EXPIRED : State.FAILED;
            const result = this._result(profile, state, [], credentials.plan,
                state === State.FAILED ? {kind: 'http', status} : null);
            if (status === TOO_MANY_REQUESTS)
                result.retryAfter = retryAfterSeconds(response.retryAfter, this._now());
            return result;
        }

        let gauges;
        try {
            gauges = parseUsage(JSON.parse(response.body));
        } catch {
            gauges = [];
        }
        if (gauges.length === 0) {
            this._logger?.warn(`cota de IA (${profile.id}): a resposta não trouxe nenhuma cota`);
            return this._result(profile, State.FAILED, [], credentials.plan, {kind: 'empty'});
        }

        this._logger?.debug(`cota de IA (${profile.id}): ` +
            gauges.map(g => `${g.name} ${Math.round(g.percent)}%`).join(' | '));
        return this._result(profile, State.OK, gauges, credentials.plan);
    }

    _readText(path) {
        return new Promise((resolve, reject) => {
            Gio.File.new_for_path(path).load_contents_async(this._cancellable, (file, result) => {
                try {
                    const [, bytes] = file.load_contents_finish(result);
                    resolve(new TextDecoder().decode(bytes));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _get(token) {
        this._session ??= new Soup.Session({timeout: 15, user_agent: 'GnomeCustom (GNOME Shell extension)'});
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', USAGE_URL);
            const headers = message.get_request_headers();
            headers.append('Authorization', `Bearer ${token}`);
            headers.append('anthropic-beta', OAUTH_BETA);
            headers.append('Accept', 'application/json');
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        resolve({
                            status: message.get_status(),
                            retryAfter: message.get_response_headers().get_one('Retry-After'),
                            body: new TextDecoder().decode(bytes.get_data() ?? new Uint8Array()),
                        });
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    /** @param {Error} error @returns {boolean} o pedido foi cancelado por `destroy()` */
    static isCancelled(error) {
        return isCancelled(error);
    }

    destroy() {
        this._cancellable.cancel();
        this._session?.abort();
        this._session = null;
        this._identities.clear();
        this._states.clear();
    }
}
