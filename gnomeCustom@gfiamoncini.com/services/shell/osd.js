// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento das janelas de OSD (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: OsdWindow (ui/osdWindow.js), exportada
 *   // GNOME 49: OsdWindow.prototype.show
 *   // GNOME 49: OsdWindow._hbox, ._icon, ._vbox, ._level (BarLevel, value 0–2)
 *   // GNOME 49: OsdWindow é alinhada (y_align END) dentro do monitor; a folga de
 *   //           baixo é o `margin-bottom` de `.osd-window`
 *   // GNOME 49: Main.osdWindowManager.show(monitor, gicon, label, level, max)
 *   // GNOME 50: Main.osdWindowManager.showAll(gicon, label, level, max)
 *   // GNOME 49: Main.layoutManager.panelBox / .primaryIndex
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

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {OsdWindow} from 'resource:///org/gnome/shell/ui/osdWindow.js';

/** Folga entre a barra (ou o topo do monitor sem barra) e o indicador. */
const TOP_GAP = 6;
/** Folga da lateral do monitor, quando o indicador não fica no centro. */
const SIDE_GAP = 8;

const ALIGNMENTS = {
    start: Clutter.ActorAlign.START,
    center: Clutter.ActorAlign.CENTER,
    end: Clutter.ActorAlign.END,
};

const PLACEMENT_CLASSES = ['gnomecustom-osd-flat', 'gnomecustom-osd-compact'];

export class ShellOsdService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._decorated = new Map();   // window -> {label, binding, destroyId, iconWasVisible}
        this._placed = new Map();      // window -> {xAlign, yAlign, style, destroyId}
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

    /**
     * Desenho do WinDock (pedido do usuário, 2026-10-07 e 10-11): sem a sombra
     * em volta, logo abaixo da barra em vez de no pé da tela, e menor.
     *
     * Chamado a cada `show()`: a altura da barra pode ter mudado desde a última.
     *
     * @param {object} window OsdWindow
     * @param {object} options
     * @param {boolean} options.belowBar
     * @param {boolean} options.compact
     * @param {string} [options.align] 'start', 'center' ou 'end'
     */
    place(window, {belowBar, compact, align = 'center'}) {
        const box = window._hbox;
        if (!box)
            return;
        if (!this._placed.has(window)) {
            this._placed.set(window, {
                xAlign: window.x_align,
                yAlign: window.y_align,
                style: box.style,
                destroyId: window.connect('destroy', () => this._placed.delete(window)),
            });
        }
        const original = this._placed.get(window);

        box.add_style_class_name('gnomecustom-osd-flat');
        if (compact)
            box.add_style_class_name('gnomecustom-osd-compact');
        else
            box.remove_style_class_name('gnomecustom-osd-compact');

        const styles = [];
        if (belowBar) {
            const onPrimary = window._monitorIndex === Main.layoutManager.primaryIndex;
            const panelBox = Main.layoutManager.panelBox;
            const bar = onPrimary && panelBox?.visible ? Math.round(panelBox.height) : 0;
            window.y_align = Clutter.ActorAlign.START;
            styles.push(`margin-top: ${bar + TOP_GAP}px; margin-bottom: 0;`);
        } else {
            window.y_align = original.yAlign;
        }
        window.x_align = ALIGNMENTS[align] ?? original.xAlign;
        if (align === 'start')
            styles.push(`margin-left: ${SIDE_GAP}px;`);
        else if (align === 'end')
            styles.push(`margin-right: ${SIDE_GAP}px;`);
        box.style = styles.length > 0 ? styles.join(' ') : original.style;
    }

    /** Devolve lugar, sombra e tamanho originais. Idempotente. */
    restorePlacement() {
        for (const [window, original] of this._placed) {
            try {
                window.disconnect(original.destroyId);
                window.x_align = original.xAlign;
                window.y_align = original.yAlign;
                window._hbox.style = original.style;
                for (const name of PLACEMENT_CLASSES)
                    window._hbox.remove_style_class_name(name);
            } catch (e) {
                this._logger.error('falha ao devolver o lugar de uma janela de OSD', e);
            }
        }
        this._placed.clear();
    }

    /**
     * Mostra o indicador em todos os monitores, como as teclas de volume fazem.
     *
     * @param {object} options
     * @param {string} options.iconName
     * @param {?string} [options.label]
     * @param {?number} [options.level] 0–1
     */
    show({iconName, label = null, level = null}) {
        const manager = Main.osdWindowManager;
        const icon = Gio.ThemedIcon.new(iconName);
        // GNOME 50: showAll(icon, label, level, max); até o 49 era show(-1, icon, …).
        if (typeof manager.showAll === 'function')
            manager.showAll(icon, label, level, 1);
        else
            manager.show(-1, icon, label, level, 1);
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
        this.restorePlacement();
        this.restoreAll();
    }
}
