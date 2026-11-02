// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Onde a barra em ilhas se parte, sem GIO (pedido do usuário, 2026-11-02).
 *
 * Cada trecho da barra (esquerda, centro, direita) é uma ilha; a lista
 * `panel/island-breaks` diz em quais botões começa uma ilha nova dentro do
 * trecho. O fundo e a borda da ilha ficam nos próprios botões, e o desenho de
 * cada um sai da posição dele na ilha: sozinho, no começo, no meio ou no fim.
 */

/** Prefixo dos papéis dos nossos botões em `Main.panel.statusArea`. */
const OUR_PREFIX = 'gnomecustom-';

/**
 * Os botões que a página de preferências oferece, da esquerda para a direita
 * numa barra de fábrica. Os nossos usam o id do módulo (o mesmo de
 * `panel/button-order`); os do GNOME, o papel no `statusArea`.
 */
export const KNOWN_ITEMS = Object.freeze([
    'apps-menu', 'dateMenu',
    'sysmon', 'updates', 'removable', 'aiusage', 'weather', 'media', 'bluetooth',
    'keyboard', 'quickSettings',
]);

/**
 * @param {string} role chave em `Main.panel.statusArea`
 * @returns {string} o id usado na lista de quebras
 */
export function itemId(role) {
    return role.startsWith(OUR_PREFIX) ? role.slice(OUR_PREFIX.length) : role;
}

/**
 * A forma de cada botão de um trecho.
 *
 * @param {{id: ?string, visible: boolean}[]} items os filhos do trecho, em ordem
 * @param {string[]} breaks ids em que começa uma ilha nova
 * @returns {Array<?{shape: string, splitBefore: boolean, splitAfter: boolean}>}
 *   null para os escondidos; `shape` é 'solo', 'start', 'middle' ou 'end', e
 *   `splitBefore`/`splitAfter` dizem se há outra ilha do trecho daquele lado
 */
export function islandShapes(items, breaks) {
    const visible = items
        .map((item, index) => ({...item, index}))
        .filter(item => item.visible);

    const groups = [];
    for (const item of visible) {
        if (groups.length === 0 || (item.id && breaks.includes(item.id)))
            groups.push([]);
        groups.at(-1).push(item.index);
    }

    const shapes = items.map(() => null);
    groups.forEach((group, g) => {
        group.forEach((index, i) => {
            const first = i === 0;
            const last = i === group.length - 1;
            shapes[index] = {
                shape: first && last ? 'solo' : first ? 'start' : last ? 'end' : 'middle',
                splitBefore: first && g > 0,
                splitAfter: last && g < groups.length - 1,
            };
        });
    });
    return shapes;
}
