// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A escala dos cartões para o que **não** passa pelo CSS: o `icon_size` posto
 * por propriedade e as larguras calculadas em JS (as barras da cota de IA).
 * O resto dos "cartões compactos" é folha de estilo — ver `lib/compact-cards.js`.
 *
 * Quem grava é o módulo de tema, antes de os outros módulos montarem os cartões.
 * Peça já montada só muda no próximo redesenho do cartão.
 */

import {scalePx} from '../../lib/compact-cards.js';

let current = 1;

/** @param {number} scale 1 = tamanho normal */
export function setCardScale(scale) {
    current = Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * @param {number} px
 * @returns {number}
 */
export function scaled(px) {
    return scalePx(px, current);
}
