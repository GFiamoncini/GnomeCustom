// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do calendário: feriados nacionais no calendário do menu do relógio.
 *
 * Do WinDock (pedido do usuário, 2026-10-07): o dia de feriado sai em vermelho,
 * e os feriados do mês exibido aparecem por extenso logo abaixo da grade. As
 * tarefas por dia do WinDock ficaram de fora, a pedido.
 *
 * As datas são calculadas em `lib/holidays.js`; quem toca o calendário do Shell
 * é o serviço `calendar`.
 */

import {Module} from '../../core/module.js';
import {holidayOf, monthHolidays} from '../../lib/holidays.js';

const DAY_CLASS = 'gnomecustom-holiday';
const NOTE_CLASS = 'gnomecustom-holiday-note';

/** Marca para o xgettext; a tradução é feita na hora de exibir. */
const N_ = message => message;

/** Os nomes de `lib/holidays.js`, repetidos aqui só para entrarem no `.pot`. */
export const TRANSLATABLE_NAMES = [
    N_("New Year's Day"),
    N_('Tiradentes'),
    N_('Labour Day'),
    N_('Independence Day'),
    N_('Our Lady of Aparecida'),
    N_("All Souls' Day"),
    N_('Republic Day'),
    N_('Black Awareness Day'),
    N_('Christmas'),
    N_('Carnival'),
    N_('Good Friday'),
    N_('Corpus Christi'),
];

/**
 * @param {Array<{days: number[], name: string}>} holidays
 * @param {Function} _ tradução
 * @returns {string} uma linha por feriado: "7 · Independência do Brasil"
 */
export function formatHolidays(holidays, _) {
    return holidays.map(({days, name}) => {
        const when = days.length > 1 ? `${days[0]}–${days.at(-1)}` : String(days[0]);
        return `${when} · ${_(name)}`;
    }).join('\n');
}

export class CalendarModule extends Module {
    static get id() {
        return 'calendar';
    }

    static get title() {
        return 'Calendar';
    }

    static get requires() {
        return ['calendar'];
    }

    enable() {
        const calendar = this.service('calendar');
        const log = this.log;
        this._calendar = calendar;

        const prototype = calendar.calendarPrototype;
        if (!prototype) {
            log.warn('calendário do menu do relógio não encontrado; feriados indisponíveis');
            return;
        }

        const sync = widget => {
            // Uma falha aqui não pode impedir o calendário de aparecer.
            try {
                calendar.markDays(widget, DAY_CLASS, date => holidayOf(date) !== null);
                this._syncNote(widget);
            } catch (e) {
                log.error('falha ao marcar os feriados', e);
            }
        };

        this.patcher.override(prototype, '_rebuildCalendar', original => function (...args) {
            const result = original.apply(this, args);
            sync(this);
            return result;
        }, {api: 'Calendar._rebuildCalendar'});

        calendar.rebuild();
    }

    _syncNote(widget) {
        const selected = this._calendar.selectedDate(widget);
        const holidays = monthHolidays(selected.getFullYear(), selected.getMonth());
        this._calendar.setNote(formatHolidays(holidays, this.ctx.gettext), NOTE_CLASS);
    }

    disable() {
        this._calendar?.restore();
        this._calendar = null;
    }
}
