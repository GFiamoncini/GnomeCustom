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
 *   // GNOME 49: Main.panel._leftBox / ._centerBox / ._rightBox
 *   // GNOME 49: Main.panel.statusArea.keyboard._indicatorLabels / ._menuItems[i].indicator
 *
 * **Ordem dos nossos botões** (`lib/panel-order.js`): quem entra com `slot` é
 * arrumado pela lista `panel/button-order`, e não pela ordem em que os módulos
 * ligaram. Na esquerda eles ficam depois dos itens nativos e dos menus; no
 * centro e na direita, antes (do relógio e do menu rápido).
 *
 * Tudo o que o serviço adiciona é registrado, e `destroy()` remove — a extensão
 * precisa devolver o painel ao estado anterior.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import {sortByOrder} from '../../lib/panel-order.js';

const ORDER_KEY = 'button-order';

export class ShellPanelService {
    /**
     * @param {object} options
     * @param {object} options.logger
     * @param {?object} [options.settings] Gio.Settings de `…gnomecustom.panel`
     */
    constructor({logger, settings = null}) {
        this._logger = logger;
        this._added = new Map();       // role -> indicator
        this._slots = new Map();       // role -> {slot, box}
        this._hiddenActors = new Map();  // nome -> {actor, wasVisible}
        this._settings = settings;
        this._orderId = settings?.connect(`changed::${ORDER_KEY}`, () => {
            for (const box of ['left', 'center', 'right'])
                this._arrange(box);
        }) ?? 0;
    }

    /**
     * Insere um indicador no painel.
     *
     * @param {string} role identificador único
     * @param {object} indicator PanelMenu.Button
     * @param {object} [options]
     * @param {number} [options.position] índice na caixa
     * @param {string} [options.box] 'left', 'center' ou 'right'
     * @param {string} [options.slot] id na lista de ordem; com ele, `position`
     *   não vale: o lugar sai de `panel/button-order`
     * @returns {boolean}
     */
    add(role, indicator, {position = 0, box = 'left', slot = null} = {}) {
        if (this._added.has(role)) {
            this._logger.warn(`indicador '${role}' já está no painel`);
            return false;
        }

        Main.panel.addToStatusArea(role, indicator, position, box);
        this._added.set(role, indicator);
        if (slot) {
            this._slots.set(role, {slot, box});
            this._arrange(box);
        }
        this._logger.debug(`indicador adicionado: ${role} (${box}, ${slot ? `ordem '${slot}'` : `pos ${position}`})`);
        return true;
    }

    /**
     * Põe os botões com `slot` de uma seção na ordem da lista.
     *
     * @param {string} box
     */
    _arrange(box) {
        const actor = Main.panel[`_${box}Box`];
        if (!actor)
            return;

        const bySlot = new Map();
        for (const [role, entry] of this._slots) {
            if (entry.box === box)
                bySlot.set(entry.slot, this._added.get(role));
        }
        const order = sortByOrder([...bySlot.keys()], this._settings?.get_strv(ORDER_KEY) ?? []);
        order.forEach((slot, index) => {
            const container = bySlot.get(slot)?.container;
            if (container?.get_parent() !== actor)
                return;
            // Um a um para o fim, na ordem, e eles terminam em ordem no fim.
            actor.set_child_at_index(container, box === 'left' ? actor.get_n_children() - 1 : index);
        });
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
        this._slots.delete(role);
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

    /**
     * Põe em maiúsculas a sigla do layout de teclado ("br" → "BR"), na barra e
     * no menu dela. O Shell refaz os rótulos quando a lista de layouts muda;
     * o nosso observador entra depois do dele e corrige os novos.
     *
     * @returns {Function} desfaz: devolve o texto original de cada rótulo vivo
     */
    uppercaseKeyboardLabels() {
        const originals = new Map();   // rótulo -> texto do Shell
        const apply = () => {
            const indicator = Main.panel.statusArea.keyboard;
            const labels = [
                ...Object.values(indicator?._indicatorLabels ?? {}),
                ...Object.values(indicator?._menuItems ?? {}).map(item => item?.indicator),
            ];
            for (const label of labels) {
                const text = label?.text;
                if (typeof text !== 'string' || text === text.toUpperCase())
                    continue;
                originals.set(label, text);
                label.text = text.toUpperCase();
            }
        };

        let manager = null;
        let id = 0;
        try {
            manager = getInputSourceManager();
            id = manager.connect('sources-changed', apply);
            apply();
        } catch (e) {
            this._logger.warn(`sigla do teclado não alterada: ${e.message}`);
        }

        return () => {
            if (id)
                manager.disconnect(id);
            for (const [label, text] of originals) {
                try {
                    if (label.text === text.toUpperCase())
                        label.text = text;
                } catch {
                    // rótulo de uma lista de layouts que já foi refeita
                }
            }
            originals.clear();
        };
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
        if (this._orderId)
            this._settings.disconnect(this._orderId);
        this._orderId = 0;
        this._settings = null;
    }
}
