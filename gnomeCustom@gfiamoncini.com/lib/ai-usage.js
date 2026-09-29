// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras do módulo de cota de IA, sem dependências.
 *
 * Quanto da cota do Claude já foi usada — o mesmo número que o `/usage` do
 * Claude Code mostra. Pedido do usuário em 2026-09-24, com o desenho do cartão
 * de cota do WinDock (`GFBmsoft/WinDock`, `AiUsageCard`) e a ideia do
 * ai-usagebar (akitaonrails/ai-usagebar, MIT), sem reaproveitar código de nenhum.
 *
 * De onde vêm os números: `GET https://api.anthropic.com/api/oauth/usage`, com o
 * token OAuth que o Claude Code guarda em `<pasta>/.credentials.json`. O endpoint
 * não é documentado e pode mudar sem aviso; quando mudar, o card diz que não
 * conseguiu ler e nada mais depende dele.
 *
 * Este arquivo só interpreta arquivos e respostas; quem lê e pergunta é
 * `services/ai/claude-usage.js`.
 */

const N_ = message => message;

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/** Sem este cabeçalho o endpoint responde 401, mesmo com o token certo. */
export const OAUTH_BETA = 'oauth-2025-04-20';

/** A pasta que o Claude Code usa sem `CLAUDE_CONFIG_DIR`. */
export const DEFAULT_ACCOUNT_ID = '.claude';

/**
 * Quanto uma leitura vale antes de perguntar de novo. Abrir e fechar o card
 * várias vezes seguidas virava vários pedidos e um 429 no WinDock; cota não
 * muda em segundos.
 */
export const FRESH_SECONDS = 2 * 60;

/** Espera depois de um 429 quando o servidor não diz quanto. */
export const BACKOFF_SECONDS = 10 * 60;

/** Um `Retry-After` acima disto é tratado como resposta estranha. */
const MAX_RETRY_SECONDS = 2 * 60 * 60;

/** Estados de uma conta — decidem o que o card mostra dela. */
export const State = Object.freeze({
    UNKNOWN: 'unknown',              // ainda não se leu nesta sessão
    NO_CREDENTIALS: 'no-credentials',
    EXPIRED: 'expired',              // o Claude Code renova sozinho no próximo uso
    OK: 'ok',
    FAILED: 'failed',
});

/** Nomes das janelas (fonte para tradução). */
export const WINDOW_NAMES = Object.freeze({
    session: N_('5 hours'),
    weekly: N_('7 days'),
});

// ------------------------------------------------------------- arquivos

/**
 * O que interessa de `.credentials.json`. O token não sai daqui para log nenhum.
 *
 * @param {?object} json
 * @param {number} nowMs
 * @returns {{state: string, token: ?string, plan: ?string}}
 */
export function parseCredentials(json, nowMs) {
    const oauth = json?.claudeAiOauth;
    const token = typeof oauth?.accessToken === 'string' ? oauth.accessToken.trim() : '';
    if (!token)
        return {state: State.NO_CREDENTIALS, token: null, plan: null};

    const plan = typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null;

    // `expiresAt` em milissegundos. Um minuto de folga evita ir à rede para
    // receber 401 de um token que vence agora.
    const expiresAt = Number(oauth.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= nowMs + 60_000)
        return {state: State.EXPIRED, token: null, plan};

    return {state: State.OK, token, plan};
}

/**
 * Quem está logado, do `.claude.json`. Falhar aqui não impede o card: sem estes
 * campos ele mostra a pasta e os medidores.
 *
 * @param {?object} json
 * @returns {{name: ?string, email: ?string, organization: ?string, role: ?string}}
 */
export function parseIdentity(json) {
    const account = json?.oauthAccount ?? {};
    const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
    return {
        // `displayName` costuma ser o primeiro nome; o card é estreito.
        name: text(account.displayName) ?? text(account.fullName),
        email: text(account.emailAddress),
        organization: text(account.organizationName),
        role: text(account.organizationRole),
    };
}

/**
 * Onde procurar o `.claude.json` de uma pasta, na ordem. O lugar muda com o caso:
 * numa pasta alternativa ele fica dentro dela; na padrão, no home, ao lado dela.
 *
 * @param {string} home
 * @param {string} dir caminho da pasta de configuração
 * @returns {string[]}
 */
export function identityPaths(home, dir) {
    const id = accountId(dir);
    return [`${dir}/.claude.json`, `${home}/${id}.json`];
}

/** @param {string} dir @returns {string} o nome da pasta: '.claude', '.claude-bm' */
export function accountId(dir) {
    return dir.replace(/\/+$/, '').split('/').pop();
}

/**
 * Ordem das contas: a padrão primeiro, depois as outras em ordem alfabética.
 *
 * @param {string[]} ids
 * @returns {string[]}
 */
export function sortAccountIds(ids) {
    return [...new Set(ids)].sort((a, b) => {
        if (a === DEFAULT_ACCOUNT_ID || b === DEFAULT_ACCOUNT_ID)
            return a === DEFAULT_ACCOUNT_ID ? -1 : 1;
        return a.localeCompare(b);
    });
}

/**
 * As contas que a configuração manda mostrar. Lista vazia é "todas": o card
 * funciona sem configurar nada e uma conta nova aparece sozinha.
 *
 * @template T
 * @param {T[]} profiles com `id`
 * @param {string[]} chosen
 * @returns {T[]}
 */
export function chooseProfiles(profiles, chosen) {
    if (!chosen?.length)
        return profiles;
    const wanted = new Set(chosen.map(id => id.toLowerCase()));
    return profiles.filter(p => wanted.has(p.id.toLowerCase()));
}

// ------------------------------------------------------------- resposta

/**
 * @typedef {object} Gauge
 * @property {string} name janela: '5 hours', '7 days' ou '7 days · <modelo>' (sem traduzir)
 * @property {?string} model modelo da janela, quando ela é por modelo
 * @property {string} window 'session' | 'weekly' | 'other'
 * @property {number} percent 0 a 100
 * @property {?number} resetsAt quando zera, em ms desde 1970; null quando a API não diz
 */

/**
 * A resposta vira medidores, na ordem de leitura: a janela curta primeiro, que é
 * a que aperta no meio do trabalho. As cotas por modelo chegam em `limits`; as
 * repetidas (o mesmo `seven_day` aparecendo como `weekly_all`) são descartadas.
 *
 * @param {?object} json
 * @returns {Gauge[]}
 */
export function parseUsage(json) {
    const gauges = [];
    if (!json || typeof json !== 'object')
        return gauges;

    const add = (window, model, utilization, resetsAt) => {
        const percent = Number(utilization);
        if (utilization === null || utilization === undefined || !Number.isFinite(percent))
            return;
        const key = `${window}|${model ?? ''}`.toLowerCase();
        if (gauges.some(g => `${g.window}|${g.model ?? ''}`.toLowerCase() === key))
            return;
        gauges.push({
            name: model && window === 'weekly' ? `${WINDOW_NAMES.weekly} · ${model}`
                : model ?? WINDOW_NAMES[window],
            model: model ?? null,
            window,
            percent: Math.min(100, Math.max(0, percent)),
            resetsAt: parseTime(resetsAt),
        });
    };

    add('session', null, json.five_hour?.utilization, json.five_hour?.resets_at);
    add('weekly', null, json.seven_day?.utilization, json.seven_day?.resets_at);
    add('weekly', 'Sonnet', json.seven_day_sonnet?.utilization, json.seven_day_sonnet?.resets_at);
    add('weekly', 'Opus', json.seven_day_opus?.utilization, json.seven_day_opus?.resets_at);

    for (const limit of Array.isArray(json.limits) ? json.limits : []) {
        const model = typeof limit?.scope?.model?.display_name === 'string'
            ? limit.scope.model.display_name.trim() || null : null;
        const percent = limit?.percent ?? limit?.utilization;
        switch (limit?.kind) {
        case 'session':
            add('session', null, percent, limit.resets_at);
            break;
        case 'weekly_all':
            add('weekly', null, percent, limit.resets_at);
            break;
        case 'weekly_scoped':
            if (model)
                add('weekly', model, percent, limit.resets_at);
            break;
        default:
            if (model)
                add('other', model, percent, limit.resets_at);
        }
    }

    return gauges;
}

/** @param {*} value ISO 8601 @returns {?number} ms desde 1970 */
export function parseTime(value) {
    if (typeof value !== 'string' || !value)
        return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Quanto esperar depois de um 429, em segundos: o `Retry-After` quando ele é
 * razoável (segundos ou data HTTP), senão o castigo fixo.
 *
 * @param {?string} header
 * @param {number} nowMs
 * @returns {number}
 */
export function retryAfterSeconds(header, nowMs) {
    const text = String(header ?? '').trim();
    let seconds = NaN;
    if (/^\d+$/.test(text))
        seconds = Number(text);
    else if (text)
        seconds = (Date.parse(text) - nowMs) / 1000;
    return seconds > 0 && seconds < MAX_RETRY_SECONDS ? Math.ceil(seconds) : BACKOFF_SECONDS;
}

// ------------------------------------------------------------- exibição

/**
 * Faixa de cor de um medidor: azul enquanto sobra, âmbar apertando, vermelho no
 * fim — as faixas do WinDock.
 *
 * @param {number} percent
 * @returns {'calm'|'warning'|'critical'}
 */
export function severity(percent) {
    if (percent >= 90)
        return 'critical';
    if (percent >= 70)
        return 'warning';
    return 'calm';
}

/** @param {number} percent @returns {string} '42%' */
export function formatPercent(percent) {
    return `${Math.round(percent)}%`;
}

const pad = n => String(n).padStart(2, '0');

/** @param {number} ms @returns {string} 'HH:MM' na hora local */
export function formatClock(ms) {
    const date = new Date(ms);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Quanto falta para a janela zerar. Hoje, com a hora — é acionável; de amanhã em
 * diante, só o prazo.
 *
 * Devolve a mensagem em inglês com os marcadores (`%s`) e os valores, para quem
 * exibe traduzir antes de substituir.
 *
 * @param {?number} resetsAt ms
 * @param {number} nowMs
 * @returns {?{message: string, args: string[]}}
 */
export function describeReset(resetsAt, nowMs) {
    if (resetsAt === null || resetsAt === undefined)
        return null;
    const left = resetsAt - nowMs;
    if (left <= 0)
        return {message: N_('resets now'), args: []};

    const minutes = Math.floor(left / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days >= 1)
        return {message: N_('resets in %s'), args: [`${days}d ${hours % 24}h`]};

    const span = hours >= 1 ? `${hours}h${pad(minutes % 60)}` : `${Math.max(1, minutes)} min`;
    const sameDay = new Date(resetsAt).toDateString() === new Date(nowMs).toDateString();
    return sameDay
        ? {message: N_('resets in %s, at %s'), args: [span, formatClock(resetsAt)]}
        : {message: N_('resets in %s'), args: [span]};
}

/**
 * O plano como o card mostra: a API manda 'max', 'team_premium'.
 *
 * @param {?string} plan
 * @returns {string}
 */
export function planLabel(plan) {
    if (!plan)
        return '';
    return plan.replace(/_/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
}

/**
 * A segunda linha da conta: e-mail (quando não é já o título) e organização.
 * A organização de uma conta pessoal chega como "<e-mail>'s Organization" —
 * repetição que só trunca o que interessa, então some.
 *
 * @param {{id: string, name: ?string, email: ?string, organization: ?string, role: ?string}} profile
 * @returns {{title: string, line: string}}
 */
export function describeAccount(profile) {
    const title = profile.name ?? profile.email ?? profile.id;
    const parts = [];
    if (profile.email && profile.email !== title)
        parts.push(profile.email);

    let organization = profile.organization;
    if (organization && profile.email &&
        organization.toLowerCase().includes(profile.email.toLowerCase()))
        organization = null;
    if (organization)
        parts.push(profile.role ? `${organization} · ${profile.role}` : organization);

    return {title, line: parts.join('  ·  ')};
}

/**
 * O que vai ao lado do ícone na barra: a janela de 5 horas da primeira conta que
 * a tiver — é a que se quer de relance. Sem ela, a maior porcentagem.
 *
 * @param {Array<{gauges: Gauge[]}>} accounts
 * @returns {?number}
 */
export function panelPercent(accounts) {
    for (const account of accounts) {
        const session = account.gauges?.find(g => g.window === 'session');
        if (session)
            return session.percent;
    }
    const all = accounts.flatMap(a => a.gauges ?? []).map(g => g.percent);
    return all.length ? Math.max(...all) : null;
}
