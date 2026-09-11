// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras da velocidade das animações, sem dependências.
 *
 * O fator multiplica a duração das animações do Shell (`St.Settings.slow_down_factor`):
 * abaixo de 1 elas ficam mais rápidas, acima de 1 mais lentas.
 */

/** O St recusa fator zero ou negativo; o teto evita animações de vários segundos. */
export const MIN_SPEED_FACTOR = 0.05;
export const MAX_SPEED_FACTOR = 4;

/**
 * @param {number} value
 * @returns {number} fator dentro da faixa; 1 quando o valor não serve
 */
export function clampSpeedFactor(value) {
    const factor = Number(value);
    if (!Number.isFinite(factor) || factor <= 0)
        return 1;
    return Math.min(MAX_SPEED_FACTOR, Math.max(MIN_SPEED_FACTOR, factor));
}

/**
 * @param {number} factor
 * @returns {{kind: string, ratio: number}} 'faster' | 'slower' | 'normal', e quantas vezes
 */
export function describeSpeedFactor(factor) {
    const clamped = clampSpeedFactor(factor);
    if (Math.abs(clamped - 1) < 1e-9)
        return {kind: 'normal', ratio: 1};

    const ratio = clamped < 1 ? 1 / clamped : clamped;
    return {
        kind: clamped < 1 ? 'faster' : 'slower',
        ratio: Math.round(ratio * 100) / 100,
    };
}
