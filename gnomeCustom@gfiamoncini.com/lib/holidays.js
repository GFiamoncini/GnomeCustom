// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Feriados nacionais brasileiros, calculados e não listados: os móveis saem da
 * data da Páscoa, então qualquer ano folheado no calendário sai certo.
 *
 * A lista e as escolhas são as do WinDock (app do próprio usuário): Carnaval
 * (segunda e terça) e Corpus Christi entram, embora sejam ponto facultativo,
 * porque é assim que todo calendário de parede os pinta; a quarta-feira de
 * cinzas fica de fora, porque é dia útil.
 *
 * Os nomes saem em inglês, como identificadores para a tradução. Sem
 * dependências do GNOME.
 */

/** Dia e mês fixos. */
const FIXED = Object.freeze([
    [1, 1, "New Year's Day"],
    [4, 21, 'Tiradentes'],
    [5, 1, 'Labour Day'],
    [9, 7, 'Independence Day'],
    [10, 12, 'Our Lady of Aparecida'],
    [11, 2, "All Souls' Day"],
    [11, 15, 'Republic Day'],
    [11, 20, 'Black Awareness Day'],
    [12, 25, 'Christmas'],
]);

/** Dias contados a partir do domingo de Páscoa. */
const MOVABLE = Object.freeze([
    [-48, 'Carnival'],
    [-47, 'Carnival'],
    [-2, 'Good Friday'],
    [60, 'Corpus Christi'],
]);

/** Todos os nomes, para quem precisa marcá-los para tradução. */
export const HOLIDAY_NAMES = Object.freeze(
    [...new Set([...FIXED.map(entry => entry[2]), ...MOVABLE.map(entry => entry[1])])]);

/**
 * Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário gregoriano).
 *
 * @param {number} year
 * @returns {{month: number, day: number}} mês de 1 a 12
 */
export function easter(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    return {month: Math.floor(n / 31), day: n % 31 + 1};
}

const cache = new Map();

/**
 * @param {number} year
 * @returns {Map<string, string>} 'mês-dia' (mês de 1 a 12) → nome
 */
export function holidaysOfYear(year) {
    let holidays = cache.get(year);
    if (holidays)
        return holidays;

    holidays = new Map();
    for (const [month, day, name] of FIXED)
        holidays.set(`${month}-${day}`, name);

    const {month, day} = easter(year);
    for (const [offset, name] of MOVABLE) {
        // Meio-dia: somar dias à meia-noite tropeça na virada do horário de verão.
        const date = new Date(year, month - 1, day + offset, 12);
        const key = `${date.getMonth() + 1}-${date.getDate()}`;
        if (!holidays.has(key))
            holidays.set(key, name);
    }

    cache.set(year, holidays);
    return holidays;
}

/**
 * @param {Date} date
 * @returns {?string} nome do feriado, ou null em dia comum
 */
export function holidayOf(date) {
    return holidaysOfYear(date.getFullYear()).get(`${date.getMonth() + 1}-${date.getDate()}`) ?? null;
}

/**
 * Os feriados de um mês, em ordem; dias seguidos com o mesmo nome (o Carnaval)
 * viram uma entrada só.
 *
 * @param {number} year
 * @param {number} month de 0 a 11, como em `Date`
 * @returns {Array<{days: number[], name: string}>}
 */
export function monthHolidays(year, month) {
    const found = [];
    for (const [key, name] of holidaysOfYear(year)) {
        const [m, d] = key.split('-').map(Number);
        if (m === month + 1)
            found.push({day: d, name});
    }
    found.sort((a, b) => a.day - b.day);

    const out = [];
    for (const {day, name} of found) {
        const last = out.at(-1);
        if (last && last.name === name && last.days.at(-1) === day - 1)
            last.days.push(day);
        else
            out.push({days: [day], name});
    }
    return out;
}
