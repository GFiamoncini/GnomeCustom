// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Aplicações instaladas e como lançá-las.
 *
 * APIs internas usadas:
 *   // GNOME 49: Shell.AppSystem.get_default().lookup_app(id)
 *   // GNOME 49: Shell.AppSystem 'installed-changed'
 *   // GNOME 49: resource:///org/gnome/shell/misc/util.js trySpawnCommandLine
 *
 * O serviço prefere sempre lançar por `.desktop` — respeita o ambiente da
 * sessão, aparece corretamente no rastreador de janelas e não passa por shell.
 * Linha de comando é o último recurso.
 */

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {SignalTracker} from '../../core/signals.js';

/** Terminais conhecidos, em ordem de preferência, quando não há configuração. */
const TERMINAL_CANDIDATES = [
    'org.gnome.Ptyxis.desktop',
    'org.gnome.Console.desktop',
    'org.gnome.Terminal.desktop',
    'kgx.desktop',
    'xterm.desktop',
];

/** Gestores de extensão conhecidos, em ordem de preferência. */
const EXTENSION_MANAGER_CANDIDATES = [
    'com.mattjakeman.ExtensionManager.desktop',
    'org.gnome.Extensions.desktop',
];

export class AppsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._appSystem = Shell.AppSystem.get_default();
        this._signals = new SignalTracker({name: 'svc:apps', logger});
        this._listeners = new Set();

        this._signals.connect(this._appSystem, 'installed-changed', () => {
            for (const listener of this._listeners) {
                try {
                    listener();
                } catch (e) {
                    this._logger.error('observador de aplicações falhou', e);
                }
            }
        });
    }

    /**
     * @param {Function} callback chamado quando a lista de aplicações muda
     * @returns {Function} remove o observador
     */
    onInstalledChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * @param {string} desktopId ex. 'org.gnome.Software.desktop'
     * @returns {?object} Shell.App ou null
     */
    lookup(desktopId) {
        if (!desktopId)
            return null;
        return this._appSystem.lookup_app(desktopId) ?? null;
    }

    /**
     * Primeiro id instalado de uma lista de candidatos.
     *
     * @param {string[]} candidates
     * @returns {?object} Shell.App
     */
    lookupFirst(candidates) {
        for (const id of candidates) {
            const app = this.lookup(id);
            if (app)
                return app;
        }
        return null;
    }

    /**
     * Abre uma aplicação por id, com candidatos de reserva.
     *
     * @param {string} desktopId preferido; pode ser vazio
     * @param {string[]} [fallbacks]
     * @returns {boolean}
     */
    launch(desktopId, fallbacks = []) {
        const app = this.lookup(desktopId) ?? this.lookupFirst(fallbacks);
        if (!app) {
            this._logger.warn(
                `aplicação não encontrada: '${desktopId}' (nem alternativas)`);
            return false;
        }

        try {
            app.activate();
            this._logger.debug(`aplicação lançada: ${app.get_id()}`);
            return true;
        } catch (e) {
            this._logger.error(`falha ao lançar ${app.get_id()}`, e);
            return false;
        }
    }

    /** @returns {boolean} */
    launchTerminal(configuredId = '') {
        if (this.launch(configuredId, TERMINAL_CANDIDATES))
            return true;

        // Última tentativa: o terminal declarado pelo próprio GTK.
        return this.spawnCommandLine('gio launch /usr/share/applications/xterm.desktop');
    }

    /** @returns {boolean} */
    launchExtensionManager(configuredId = '') {
        return this.launch(configuredId, EXTENSION_MANAGER_CANDIDATES);
    }

    /**
     * Abre o painel "Sobre" das configurações do sistema.
     *
     * @returns {boolean}
     */
    launchAboutSystem() {
        return this.launchSettingsPanel('about');
    }

    /**
     * Abre um painel das configurações do sistema (ex. 'about', 'bluetooth').
     *
     * @param {string} panel
     * @returns {boolean}
     */
    launchSettingsPanel(panel) {
        const app = this.lookup('org.gnome.Settings.desktop');
        if (!app)
            return false;

        try {
            // O painel é escolhido por argumento de linha de comando; usar a
            // action padrão abriria a última página aberta pelo usuário.
            const appInfo = Gio.AppInfo.create_from_commandline(
                `gnome-control-center ${panel}`, panel, Gio.AppInfoCreateFlags.NONE);
            appInfo.launch([], global.create_app_launch_context(0, -1));
            return true;
        } catch (e) {
            this._logger.debug(`caindo para a activation padrão: ${e.message}`);
            return this.launch('org.gnome.Settings.desktop');
        }
    }

    /**
     * @param {string} commandLine
     * @returns {boolean}
     */
    spawnCommandLine(commandLine) {
        if (!commandLine)
            return false;

        try {
            Util.trySpawnCommandLine(commandLine);
            return true;
        } catch (e) {
            this._logger.error(`falha ao executar '${commandLine}'`, e);
            return false;
        }
    }

    destroy() {
        this._listeners.clear();
        this._signals.destroy();
        this._appSystem = null;
    }
}
