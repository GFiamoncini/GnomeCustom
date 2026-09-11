// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento do painel superior (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.panel.addToStatusArea(role, indicator, position, box)
 *   // GNOME 49: Main.panel.statusArea
 *   // GNOME 49: Main.panel.menuManager
 *   // GNOME 49: Main.sessionMode.panel.left / .center / .right
 *
 * Tudo o que o serviço adiciona é registrado, e `destroy()` remove — a extensão
 * precisa devolver o painel ao estado anterior.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ShellPanelService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._added = new Map();       // role -> indicator
        this._hiddenActors = new Map();  // nome -> {actor, wasVisible}
    }

    /**
     * Insere um indicador no painel.
     *
     * @param {string} role identificador único
     * @param {object} indicator PanelMenu.Button
     * @param {object} [options]
     * @param {number} [options.position] índice na caixa
     * @param {string} [options.box] 'left', 'center' ou 'right'
     * @returns {boolean}
     */
    add(role, indicator, {position = 0, box = 'left'} = {}) {
        if (this._added.has(role)) {
            this._logger.warn(`indicador '${role}' já está no painel`);
            return false;
        }

        Main.panel.addToStatusArea(role, indicator, position, box);
        this._added.set(role, indicator);
        this._logger.debug(`indicador adicionado: ${role} (${box}, pos ${position})`);
        return true;
    }

    /**
     * Remove um indicador que nós adicionamos.
     *
     * @param {string} role
     */
    remove(role) {
        const indicator = this._added.get(role);
        if (!indicator)
            return;

        this._added.delete(role);
        try {
            Main.panel.menuManager?.removeMenu?.(indicator.menu);
        } catch (e) {
            this._logger.debug(`menu de '${role}' já removido: ${e.message}`);
        }
        try {
            indicator.destroy();
        } catch (e) {
            this._logger.error(`falha ao destruir o indicador '${role}'`, e);
        }
        this._logger.debug(`indicador removido: ${role}`);
    }

    /**
     * Índice logo após um item nativo do painel, para inserir ao lado dele.
     *
     * @param {string} name ex. 'activities'
     * @param {string} [box]
     * @returns {number}
     */
    indexAfter(name, box = 'left') {
        const items = Main.sessionMode.panel?.[box] ?? [];
        const index = items.indexOf(name);
        return index === -1 ? 0 : index + 1;
    }

    /**
     * Esconde um item nativo do painel, guardando o estado para restaurar.
     *
     * @param {string} name chave em `Main.panel.statusArea`
     * @returns {boolean}
     */
    hideNative(name) {
        if (this._hiddenActors.has(name))
            return true;

        const indicator = Main.panel.statusArea[name];
        if (!indicator) {
            this._logger.debug(`item nativo '${name}' não existe neste modo de sessão`);
            return false;
        }

        this._hiddenActors.set(name, {actor: indicator, wasVisible: indicator.visible});
        indicator.visible = false;
        this._logger.debug(`item nativo escondido: ${name}`);
        return true;
    }

    /**
     * Devolve a visibilidade original de um item nativo.
     *
     * @param {string} name
     */
    showNative(name) {
        const entry = this._hiddenActors.get(name);
        if (!entry)
            return;

        this._hiddenActors.delete(name);
        try {
            entry.actor.visible = entry.wasVisible;
        } catch (e) {
            this._logger.debug(`item nativo '${name}' já foi destruído: ${e.message}`);
        }
    }

    /** @returns {?object} indicador nativo, quando existe neste modo de sessão */
    lookupNative(name) {
        return Main.panel.statusArea[name] ?? null;
    }

    destroy() {
        for (const role of [...this._added.keys()])
            this.remove(role);
        for (const name of [...this._hiddenActors.keys()])
            this.showNative(name);
    }
}
