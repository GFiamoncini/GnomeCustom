// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Registro de atalhos de teclado.
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.wm.addKeybinding(name, settings, flags, modes, handler)
 *   // GNOME 49: Main.wm.removeKeybinding(name)
 *
 * Todo atalho passa por aqui, e `destroy()` remove todos. Isso importa porque um
 * atalho que sobrevive à desativação continua roubando a combinação de teclas do
 * resto do sistema — e, no caso do módulo de tiling, serão dezenas deles.
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class KeybindingsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._registered = new Set();
    }

    /**
     * @param {string} name nome da chave no esquema
     * @param {object} settings Gio.Settings que contém a chave
     * @param {Function} handler
     * @param {object} [options]
     * @param {number} [options.modes] Shell.ActionMode
     * @param {number} [options.flags] Meta.KeyBindingFlags
     * @returns {boolean}
     */
    add(name, settings, handler, {modes = null, flags = Meta.KeyBindingFlags.NONE} = {}) {
        if (this._registered.has(name)) {
            this._logger.warn(`atalho '${name}' já registrado`);
            return false;
        }

        const actionModes = modes ?? (Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);

        try {
            const action = Main.wm.addKeybinding(name, settings, flags, actionModes, handler);
            if (action === Meta.KeyBindingAction.NONE) {
                this._logger.warn(`o Shell recusou o atalho '${name}'`);
                return false;
            }
            this._registered.add(name);
            this._logger.debug(`atalho registrado: ${name} (${settings.get_strv(name).join(', ')})`);
            return true;
        } catch (e) {
            this._logger.error(`falha ao registrar o atalho '${name}'`, e);
            return false;
        }
    }

    /** @param {string} name */
    remove(name) {
        if (!this._registered.delete(name))
            return;

        try {
            Main.wm.removeKeybinding(name);
            this._logger.debug(`atalho removido: ${name}`);
        } catch (e) {
            this._logger.error(`falha ao remover o atalho '${name}'`, e);
        }
    }

    /** @returns {string[]} */
    get registered() {
        return [...this._registered];
    }

    destroy() {
        for (const name of [...this._registered])
            this.remove(name);
    }
}
