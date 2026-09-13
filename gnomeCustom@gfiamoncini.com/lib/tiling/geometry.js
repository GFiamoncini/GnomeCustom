// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Geometria das ações que não passam pela árvore: snap e janela flutuante.
 *
 * Proporções do Forge, que é o baseline: snap de 1/3 e 2/3 da área útil com o
 * espaçamento aplicado; "centro" mantém o tamanho; ao flutuar, a janela vai para
 * o centro com 65% × 75% da área útil.
 *
 * Sem dependências do GNOME.
 */

import {inset} from './layout.js';

/** Largura e altura, em fração da área útil, de uma janela que passa a flutuar. */
export const FLOAT_SIZE = Object.freeze({width: 0.65, height: 0.75});

/**
 * @param {import('./layout.js').Rect} area
 * @param {'left'|'right'} side
 * @param {number} fraction ex. 1/3
 * @param {number} [gap]
 * @returns {import('./layout.js').Rect}
 */
export function snapRect(area, side, fraction, gap = 0) {
    if (side !== 'left' && side !== 'right')
        throw new Error(`lado de snap inválido: '${side}'`);

    const width = Math.round(area.width * fraction);
    const x = side === 'left' ? area.x : area.x + area.width - width;
    return inset({x, y: area.y, width, height: area.height}, gap);
}

/**
 * Centraliza um retângulo na área, mantendo o tamanho (limitado à área).
 *
 * @returns {import('./layout.js').Rect}
 */
export function centerRect(area, rect) {
    const width = Math.min(rect.width, area.width);
    const height = Math.min(rect.height, area.height);
    return {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        width,
        height,
    };
}

/** @returns {import('./layout.js').Rect} onde uma janela que passa a flutuar vai parar */
export function floatRect(area) {
    return centerRect(area, {
        width: Math.round(area.width * FLOAT_SIZE.width),
        height: Math.round(area.height * FLOAT_SIZE.height),
    });
}

/** @returns {boolean} o ponto está dentro do retângulo */
export function containsPoint(rect, x, y) {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** @returns {boolean} dois retângulos iguais, com tolerância de pixels */
export function sameRect(a, b, tolerance = 0) {
    if (!a || !b)
        return false;
    return Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance;
}

// Meta.GrabOp no Mutter 17 (valores conferidos no typelib): as bordas de um
// redimensionamento vêm como bits somados à operação.
const GRAB_KEYBOARD = 0x100;
const GRAB_KEYBOARD_RESIZING_UNKNOWN = 0x301;
const GRAB_MOVING_OPS = new Set([0x1, 0x401, 0x101]);   // moving, unconstrained, keyboard
const GRAB_EDGE_BITS = [[0x8000, 'up'], [0x4000, 'down'], [0x1000, 'left'], [0x2000, 'right']];

/**
 * Decodifica um `Meta.GrabOp`.
 *
 * @param {number} op
 * @returns {{moving: boolean, resizing: boolean, keyboard: boolean, edges: string[]}}
 */
export function grabEdges(op) {
    const value = Number(op) | 0;
    const edges = GRAB_EDGE_BITS.filter(([bit]) => value & bit).map(([, edge]) => edge);
    const resizing = edges.length > 0 || value === GRAB_KEYBOARD_RESIZING_UNKNOWN;
    return {
        moving: !resizing && GRAB_MOVING_OPS.has(value),
        resizing,
        keyboard: Boolean(value & GRAB_KEYBOARD),
        edges,
    };
}

/**
 * Deslocamento de cada borda entre dois retângulos, com o sinal de "crescer".
 *
 * @returns {Object<string, number>} ex. `{right: 40}` quando a borda direita avançou 40px
 */
export function edgeDeltas(before, after, edges) {
    const deltas = {};
    for (const edge of edges) {
        let delta = 0;
        if (edge === 'left')
            delta = before.x - after.x;
        else if (edge === 'right')
            delta = (after.x + after.width) - (before.x + before.width);
        else if (edge === 'up')
            delta = before.y - after.y;
        else if (edge === 'down')
            delta = (after.y + after.height) - (before.y + before.height);
        if (delta !== 0)
            deltas[edge] = delta;
    }
    return deltas;
}

/**
 * Onde desenhar a borda de foco: por fora do quadro da janela, ocupando o
 * espaço do gap — como no Forge. Sem espaço (gap zero), fica por dentro do quadro.
 *
 * @param {import('./layout.js').Rect} frame
 * @param {number} width espessura da borda
 * @param {number} gap espaçamento efetivo da chave
 * @returns {import('./layout.js').Rect}
 */
export function borderRect(frame, width, gap) {
    const outset = gap > 0 ? Math.min(width, gap * 2) : 0;
    return {
        x: frame.x - outset,
        y: frame.y - outset,
        width: frame.width + outset * 2,
        height: frame.height + outset * 2,
    };
}

/**
 * A candidata mais próxima numa direção, pelos centros dos retângulos.
 *
 * Usado para focar a partir de janelas que não estão na árvore (flutuantes) e
 * para escolher a janela de chegada em outro monitor. Candidatas "atrás" da
 * direção são ignoradas; entre as da frente, pesa mais o desvio perpendicular,
 * para que "direita" não pule para uma janela bem mais abaixo.
 *
 * @param {import('./layout.js').Rect} from
 * @param {Array<{id: number, rect: import('./layout.js').Rect}>} candidates
 * @param {string} direction
 * @returns {?number}
 */
export function nearestInDirection(from, candidates, direction) {
    const cx = from.x + from.width / 2;
    const cy = from.y + from.height / 2;

    let best = null;
    let bestScore = Infinity;
    for (const {id, rect} of candidates) {
        const dx = rect.x + rect.width / 2 - cx;
        const dy = rect.y + rect.height / 2 - cy;

        let along;
        let across;
        if (direction === 'left') {
            along = -dx;
            across = dy;
        } else if (direction === 'right') {
            along = dx;
            across = dy;
        } else if (direction === 'up') {
            along = -dy;
            across = dx;
        } else if (direction === 'down') {
            along = dy;
            across = dx;
        } else {
            throw new Error(`direção inválida: '${direction}'`);
        }

        if (along <= 0)
            continue;
        const score = along + Math.abs(across) * 2;
        if (score < bestScore) {
            bestScore = score;
            best = id;
        }
    }
    return best;
}
