// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Ordem dos nossos botões na barra, sem GIO (pedido do usuário, 2026-10-11).
 *
 * Cada módulo escolhe a **seção** (esquerda, centro, direita) na página dele; a
 * ordem **dentro** da seção é uma lista só, `panel/button-order`, com os ids dos
 * módulos da esquerda para a direita. Antes disso todo botão entrava na posição
 * 0 e a ordem era a de ativação ao contrário — e mudava sozinha quando um deles
 * era recriado.
 */

/** A ordem de fábrica: a que a barra tinha antes de a lista existir. */
export const DEFAULT_ORDER = Object.freeze([
    'sysmon', 'updates', 'removable', 'aiusage', 'weather', 'media', 'bluetooth',
]);

/**
 * A lista gravada, sem repetidos nem desconhecidos, e com os que faltam no fim
 * (um módulo que nasceu depois de a lista ser gravada).
 *
 * @param {string[]} saved
 * @param {readonly string[]} [known]
 * @returns {string[]}
 */
export function normalizeOrder(saved, known = DEFAULT_ORDER) {
    const order = [];
    for (const id of saved ?? []) {
        if (known.includes(id) && !order.includes(id))
            order.push(id);
    }
    for (const id of known) {
        if (!order.includes(id))
            order.push(id);
    }
    return order;
}

/**
 * @param {string[]} ids os botões presentes numa seção
 * @param {string[]} order a lista gravada
 * @returns {string[]} da esquerda para a direita
 */
export function sortByOrder(ids, order) {
    const normalized = normalizeOrder(order, [...new Set([...DEFAULT_ORDER, ...ids])]);
    return [...ids].sort((a, b) => normalized.indexOf(a) - normalized.indexOf(b));
}

/**
 * @param {string[]} order
 * @param {string} id
 * @param {number} delta -1 sobe (vai para a esquerda), +1 desce
 * @returns {string[]} a lista nova; a mesma ordem quando não há para onde ir
 */
export function moveItem(order, id, delta) {
    const list = [...order];
    const from = list.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= list.length)
        return list;
    list.splice(from, 1);
    list.splice(to, 0, id);
    return list;
}
