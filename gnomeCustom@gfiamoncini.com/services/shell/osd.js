// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento das janelas de OSD (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: OsdWindow (ui/osdWindow.js), exportada
 *   // GNOME 49: OsdWindow.prototype.show
 *   // GNOME 49: OsdWindow._hbox, ._icon, ._vbox, ._level (BarLevel, value 0–2)
 *
 * O serviço não mantém a lista de janelas do `OsdWindowManager`: ele recebe a
 * janela no momento em que ela vai aparecer. Assim uma janela criada depois — um
 * monitor ligado com a extensão ativa — é tratada sem observar `monitors-changed`.
 *
 * Tudo o que é inserido numa janela fica registrado, e `restoreAll()` devolve
 * cada uma ao estado original.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {OsdWindow} from 'resource:///org/gnome/shell/ui/osdWindow.js';

export class ShellOsdService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._decorated = new Map();   // window -> {label, binding, destroyId, iconWasVisible}
        this._unsupported = false;
    }

    /** Protótipo alvo do patch de `show`; o patch em si é do módulo. */
    get windowPrototype() {
        return OsdWindow.prototype;
    }

    get decoratedCount() {
        return this._decorated.size;
    }

    /**
     * Mostra o nível como número no lugar do ícone, enquanto a janela tiver
     * barra de nível. Sem barra (um OSD só de ícone), o ícone volta.
     *
     * Deve ser chamado antes do `show()` original: nesse ponto o
     * `OsdWindowManager` já aplicou `setLevel()`.
     *
     * @param {object} window OsdWindow
     * @param {object} options
     * @param {string} options.styleClass
     * @param {Function} options.format (value: number) => string
     */
    showNumber(window, {styleClass, format}) {
        const entry = this._decorated.get(window) ?? this._attach(window, styleClass, format);
        if (!entry)
            return;

        const hasLevel = window._level.visible;
        entry.label.visible = hasLevel;
        window._icon.visible = !hasLevel;

        this._logger.debug(
            `OSD do monitor ${window._monitorIndex}: ${hasLevel ? `número '${entry.label.text}'` : 'só ícone'}`);
    }

    /** Remove os números e devolve os ícones. Idempotente. */
    restoreAll() {
        for (const [window, entry] of this._decorated) {
            try {
                entry.binding.unbind();
                window.disconnect(entry.destroyId);
                entry.label.destroy();
                window._icon.visible = entry.iconWasVisible;
            } catch (e) {
                this._logger.error('falha ao restaurar uma janela de OSD', e);
            }
        }
        if (this._decorated.size > 0)
            this._logger.debug(`${this._decorated.size} janela(s) de OSD restaurada(s)`);
        this._decorated.clear();
    }

    _attach(window, styleClass, format) {
        if (this._unsupported)
            return null;

        const {_hbox: box, _vbox: column, _icon: icon, _level: level} = window;
        if (!box || !column || !icon || !level) {
            this._unsupported = true;
            this._logger.warn('estrutura do OsdWindow diferente da esperada (GNOME 49); número desativado');
            return null;
        }

        const label = new St.Label({
            style_class: styleClass,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // No lugar do ícone: à esquerda da coluna com o nome do dispositivo e a barra.
        box.insert_child_below(label, column);

        const binding = level.bind_property_full('value', label, 'text',
            GObject.BindingFlags.SYNC_CREATE,
            (_binding, value) => [true, format(value)],
            null);

        // Um monitor desligado destrói a janela, e o número vai junto com ela.
        const destroyId = window.connect('destroy', () => this._decorated.delete(window));

        const entry = {label, binding, destroyId, iconWasVisible: icon.visible};
        this._decorated.set(window, entry);
        return entry;
    }

    destroy() {
        this.restoreAll();
    }
}
