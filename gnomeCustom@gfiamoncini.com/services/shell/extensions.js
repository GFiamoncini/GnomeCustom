// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento de `Main.extensionManager` (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.extensionManager.lookup(uuid)
 *   // GNOME 49: Main.extensionManager.getUuids()
 *   // GNOME 49: sinal 'extension-state-changed'
 *   // GNOME 49: resource:///org/gnome/shell/misc/extensionUtils.js ExtensionState
 *
 * Nenhum módulo fala com o extensionManager diretamente.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {SignalTracker} from '../../core/signals.js';

const RUNNING_STATES = [
    ExtensionUtils.ExtensionState.ACTIVE,
    ExtensionUtils.ExtensionState.ENABLED,
].filter(state => state !== undefined);

export class ShellExtensionsService {
    /**
     * @param {object} options
     * @param {object} options.logger
     * @param {string} options.selfUuid uuid da própria extensão, sempre ignorado
     */
    constructor({logger, selfUuid}) {
        this._logger = logger;
        this._selfUuid = selfUuid;
        this._signals = new SignalTracker({name: 'svc:extensions', logger});
        this._listeners = new Set();

        this._signals.connect(Main.extensionManager, 'extension-state-changed',
            (_manager, extension) => this._onStateChanged(extension));
    }

    /**
     * @param {string} uuid
     * @returns {boolean} a extensão está carregada e ativa
     */
    isRunning(uuid) {
        if (uuid === this._selfUuid)
            return false;

        const extension = Main.extensionManager.lookup(uuid);
        if (!extension)
            return false;
        return RUNNING_STATES.includes(extension.state);
    }

    /**
     * @param {string[]} uuids
     * @returns {string[]} subconjunto que está ativo agora
     */
    filterRunning(uuids) {
        return uuids.filter(uuid => this.isRunning(uuid));
    }

    /** @returns {?string} nome legível, quando a extensão está instalada */
    nameOf(uuid) {
        return Main.extensionManager.lookup(uuid)?.metadata?.name ?? null;
    }

    /**
     * Notifica quando qualquer extensão muda de estado.
     *
     * @param {Function} callback recebe o uuid afetado
     * @returns {Function} função que remove o observador
     */
    onStateChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _onStateChanged(extension) {
        const uuid = extension?.uuid;
        if (!uuid || uuid === this._selfUuid)
            return;

        for (const listener of this._listeners) {
            try {
                listener(uuid);
            } catch (e) {
                this._logger.error('observador de estado de extensão falhou', e);
            }
        }
    }

    destroy() {
        this._listeners.clear();
        this._signals.destroy();
    }
}
