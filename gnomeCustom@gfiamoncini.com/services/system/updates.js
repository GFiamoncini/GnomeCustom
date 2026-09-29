// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Atualizações pendentes do sistema (dnf, pelo PackageKit) e do Flatpak. As
 * regras ficam em `lib/updates.js`.
 *
 * **Nada aqui bloqueia o Shell.** O PackageKit é chamado pelas versões
 * assíncronas da PackageKitGlib; o Flatpak, pelo comando `flatpak` num processo
 * à parte, porque a biblioteca dele só tem a busca de atualizações síncrona e
 * ela vai à rede — dentro do Shell, isso congelaria a barra.
 *
 * **Duas profundidades de busca** (a lição do WinDock):
 *
 * - `refresh: true` baixa as listas de pacotes de novo quando elas passaram do
 *   prazo (o `metadata_expire` do dnf; o PackageKit decide) e pergunta ao
 *   servidor do Flatpak. É a única que acha atualização nova;
 * - `refresh: false` relê só o que está guardado. Serve depois de o GNOME
 *   Software atualizar: confirma o que saiu da lista, sem ir à rede.
 *
 * **Quem avisa que algo mudou:** o sinal `UpdatesChanged` do PackageKit, e o
 * arquivo `.changed` que o Flatpak toca a cada instalação ou atualização.
 *
 * **O que nunca faz:** instalar. `openSoftware()` abre o GNOME Software na aba
 * de atualizações, e ele cuida da senha, do download e do reinício.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import '../../core/gio-promises.js';
import {parseFlatpakList, systemPackages} from '../../lib/updates.js';

const PK_NAME = 'org.freedesktop.PackageKit';
const PK_PATH = '/org/freedesktop/PackageKit';

/** Rajadas de avisos (uma atualização toca o `.changed` várias vezes) viram uma. */
const CHANGED_DELAY_MS = 3 * 1000;

/** O `flatpak` que passa disto é encerrado: um servidor mudo não prende o card. */
const FLATPAK_TIMEOUT_MS = 2 * 60 * 1000;

/** Existe enquanto uma atualização baixada espera o reinício (pk-offline). */
const OFFLINE_UPDATE = '/system-update';

const FLATPAK_CHANGED = [
    '/var/lib/flatpak/.changed',
    GLib.build_filenamev([GLib.get_user_data_dir(), 'flatpak', '.changed']),
];

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

export class UpdatesService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._cancellable = new Gio.Cancellable();
        this._listeners = new Set();
        this._pending = {system: false, flatpak: false};
        this._changedId = 0;
        this._packageKit = undefined;   // o módulo GI, carregado na primeira busca

        this._pkSubscription = Gio.DBus.system.signal_subscribe(PK_NAME, PK_NAME,
            'UpdatesChanged', PK_PATH, null, Gio.DBusSignalFlags.NONE,
            () => this._changed('system'));

        this._monitors = [];
        for (const path of FLATPAK_CHANGED) {
            try {
                const monitor = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', () => this._changed('flatpak'));
                this._monitors.push(monitor);
            } catch (e) {
                this._logger.debug(`sem vigiar ${path}: ${e.message}`);
            }
        }
    }

    /**
     * @param {Function} callback ({system: boolean, flatpak: boolean}) — algo
     *   mudou nesta máquina; relida com `refresh: false`, a lista se acerta
     * @returns {Function} para cancelar a inscrição
     */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * As duas buscas, em paralelo. Uma que falha não apaga a outra: o erro vem
     * no campo dela e a lista dela volta `null` ("não se sabe").
     *
     * @param {object} [options]
     * @param {boolean} [options.refresh] ir à rede (ver o comentário do arquivo)
     * @param {{system?: boolean, flatpak?: boolean}} [options.sources] quais buscar
     * @returns {Promise<{system: ?object[], flatpak: ?object[], errors: object, restartPending: boolean}>}
     */
    async check({refresh = false, sources = {system: true, flatpak: true}} = {}) {
        const errors = {system: null, flatpak: null};
        const guard = (source, promise) => promise.catch(e => {
            if (isCancelled(e))
                throw e;
            errors[source] = e.message;
            this._logger.warn(`busca de atualizações (${source}) falhou: ${e.message}`);
            return null;
        });

        const [system, flatpak, restartPending] = await Promise.all([
            sources.system ? guard('system', this._systemUpdates(refresh)) : null,
            sources.flatpak ? guard('flatpak', this._flatpakUpdates(refresh)) : null,
            this._offlineUpdatePrepared(),
        ]);
        return {system, flatpak, errors, restartPending};
    }

    /**
     * Abre o GNOME Software na aba de atualizações.
     *
     * @throws {Error} quando ele não está instalado
     */
    openSoftware() {
        if (!GLib.find_program_in_path('gnome-software'))
            throw new Error('GNOME Software não encontrado');
        // `--mode=updates` só existe na linha de comando; a entrada .desktop não
        // tem ação para isso. A instância que já estiver aberta recebe o pedido.
        Gio.AppInfo.create_from_commandline('gnome-software --mode=updates', 'GNOME Software',
            Gio.AppInfoCreateFlags.NONE).launch([], global.create_app_launch_context(0, -1));
    }

    // ------------------------------------------------------------ sistema

    async _systemUpdates(refresh) {
        const PackageKitGlib = await this._loadPackageKit();
        if (!PackageKitGlib)
            return [];   // sem PackageKit, sem atualização de sistema para mostrar

        const client = new PackageKitGlib.Client();
        if (refresh) {
            try {
                // `false`: só baixa se passou do prazo; quem decide é o dnf.
                await this._pk(client, 'refresh_cache_async', false);
            } catch (e) {
                if (isCancelled(e))
                    throw e;
                // Sem rede: a lista guardada ainda diz alguma coisa.
                this._logger.info(`listas de pacotes não renovadas: ${e.message}`);
            }
        }

        const results = await this._pk(client, 'get_updates_async',
            PackageKitGlib.filter_bitfield_from_string('none'));
        return systemPackages(results.get_package_array().map(p => ({
            name: p.get_name(),
            version: p.get_version(),
            info: PackageKitGlib.info_enum_to_string(p.get_info()),
        })));
    }

    /** `client.method(...args, cancellable, progresso, cb)` + `generic_finish`, como promessa. */
    _pk(client, method, ...args) {
        return new Promise((resolve, reject) => {
            client[method](...args, this._cancellable, () => {}, (source, result) => {
                try {
                    resolve(source.generic_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _loadPackageKit() {
        if (this._packageKit === undefined) {
            try {
                this._packageKit = (await import('gi://PackageKitGlib')).default;
            } catch (e) {
                this._logger.info(`PackageKitGlib indisponível: ${e.message}`);
                this._packageKit = null;
            }
        }
        return this._packageKit;
    }

    // ------------------------------------------------------------ flatpak

    async _flatpakUpdates(refresh) {
        const argv = ['flatpak', 'remote-ls', '--updates', '--columns=application,name,version,branch'];
        if (!refresh)
            argv.splice(3, 0, '--cached');

        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            if (e.matches?.(GLib.SpawnError, GLib.SpawnError.NOENT))
                return [];   // Flatpak não instalado
            throw e;
        }

        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FLATPAK_TIMEOUT_MS, () => {
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [stdout, stderr] = await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, this._cancellable, (source, result) => {
                    try {
                        const [, out, err] = source.communicate_utf8_finish(result);
                        resolve([out ?? '', err ?? '']);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            if (!proc.get_successful())
                throw new Error(stderr.trim().split('\n').pop() || `flatpak terminou com ${proc.get_exit_status()}`);
            return parseFlatpakList(stdout);
        } finally {
            GLib.source_remove(timeout);
            if (this._cancellable.is_cancelled())
                proc.force_exit();
        }
    }

    // ------------------------------------------------------------ reinício

    async _offlineUpdatePrepared() {
        try {
            await Gio.File.new_for_path(OFFLINE_UPDATE).query_info_async(
                Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_LOW, this._cancellable);
            return true;
        } catch {
            return false;
        }
    }

    // ------------------------------------------------------------ avisos

    _changed(source) {
        this._pending[source] = true;
        if (this._changedId)
            GLib.source_remove(this._changedId);
        this._changedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHANGED_DELAY_MS, () => {
            this._changedId = 0;
            const sources = this._pending;
            this._pending = {system: false, flatpak: false};
            for (const listener of this._listeners) {
                try {
                    listener(sources);
                } catch (e) {
                    this._logger.error('observador de atualizações falhou', e);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._changedId) {
            GLib.source_remove(this._changedId);
            this._changedId = 0;
        }
        if (this._pkSubscription) {
            Gio.DBus.system.signal_unsubscribe(this._pkSubscription);
            this._pkSubscription = 0;
        }
        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];
        this._listeners.clear();
    }
}
