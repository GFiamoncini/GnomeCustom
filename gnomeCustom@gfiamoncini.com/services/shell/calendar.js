// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento do calendário do menu do relógio.
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.panel.statusArea.dateMenu._calendar (Calendar)
 *   // GNOME 49: Calendar.prototype._rebuildCalendar, que recria `_buttons`;
 *   //           cada botão de dia traz a data em `_date`
 *   // GNOME 49: Calendar::selected-date-changed
 */

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ShellCalendarService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._note = null;
        this._marked = new Map();   // classe -> botões marcados
    }

    /** @returns {?object} o calendário do menu do relógio */
    get calendar() {
        return Main.panel.statusArea.dateMenu?._calendar ?? null;
    }

    /** Protótipo cujo `_rebuildCalendar` o módulo intercepta. */
    get calendarPrototype() {
        const calendar = this.calendar;
        return calendar ? Object.getPrototypeOf(calendar) : null;
    }

    /** @returns {Date} o dia selecionado, que decide o mês exibido */
    selectedDate(calendar = this.calendar) {
        return new Date(calendar?._selectedDate ?? Date.now());
    }

    /**
     * Põe `styleClass` nos dias para os quais `test` devolve verdadeiro.
     *
     * @param {object} calendar
     * @param {string} styleClass
     * @param {Function} test Date => boolean
     */
    markDays(calendar, styleClass, test) {
        const marked = [];
        for (const button of calendar._buttons ?? []) {
            if (button._date && test(button._date)) {
                button.add_style_class_name(styleClass);
                marked.push(button);
            } else {
                button.remove_style_class_name(styleClass);
            }
        }
        this._marked.set(styleClass, marked);
    }

    /** Refaz a grade do mês, o que passa de novo pelo que estiver interceptado. */
    rebuild() {
        this.calendar?._rebuildCalendar?.();
    }

    /**
     * Texto logo abaixo da grade do mês; vazio esconde.
     *
     * @param {string} text
     * @param {string} styleClass
     */
    setNote(text, styleClass) {
        const calendar = this.calendar;
        const parent = calendar?.get_parent();
        if (!parent)
            return;

        if (!this._note) {
            this._note = new St.Label({style_class: styleClass, x_align: Clutter.ActorAlign.FILL});
            this._note.clutter_text.line_wrap = true;
            this._note.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            parent.insert_child_above(this._note, calendar);
        }
        this._note.text = text;
        this._note.visible = text !== '';
    }

    /** Tira as marcas e o texto. */
    restore() {
        for (const [styleClass, buttons] of this._marked) {
            for (const button of buttons) {
                try {
                    button.remove_style_class_name(styleClass);
                } catch (e) {
                    this._logger.debug(`dia do calendário já destruído: ${e.message}`);
                }
            }
        }
        this._marked.clear();
        this._note?.destroy();
        this._note = null;
    }

    destroy() {
        this.restore();
    }
}
