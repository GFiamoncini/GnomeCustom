// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Aritmética de cor para o Theme Engine. Sem dependências.
 *
 * Cores circulam internamente como `[r, g, b]` com componentes 0–255 inteiros.
 * As funções de contraste seguem a definição de luminância relativa da WCAG 2.1,
 * que é o que permite escolher automaticamente texto claro ou escuro sobre a
 * cor extraída do papel de parede.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** @param {number} value @returns {number} inteiro em 0–255 */
export function clampByte(value) {
    return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * @param {string} text '#rgb', '#rrggbb' ou sem '#'
 * @returns {?number[]} [r, g, b] ou null quando não reconhecido
 */
export function parseHex(text) {
    const match = HEX_RE.exec(String(text ?? '').trim());
    if (!match)
        return null;

    let hex = match[1];
    if (hex.length === 3)
        hex = [...hex].map(c => c + c).join('');

    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
    ];
}

/** @param {number[]} rgb @returns {string} '#rrggbb' */
export function toHex([r, g, b]) {
    const part = value => clampByte(value).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * @param {number[]} rgb
 * @param {number} alpha 0–1
 * @returns {string} valor CSS aceito pelo St
 */
export function rgba([r, g, b], alpha) {
    const a = Math.min(1, Math.max(0, alpha));
    return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${round(a, 3)})`;
}

/**
 * Luminância relativa WCAG.
 *
 * @param {number[]} rgb
 * @returns {number} 0 (preto) a 1 (branco)
 */
export function relativeLuminance([r, g, b]) {
    const channel = value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} razão de contraste, 1 a 21
 */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [light, dark] = la >= lb ? [la, lb] : [lb, la];
    return (light + 0.05) / (dark + 0.05);
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/**
 * Texto legível sobre um fundo: escolhe o extremo de maior contraste.
 *
 * @param {number[]} background
 * @returns {number[]} branco ou preto
 */
export function bestForeground(background) {
    return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK)
        ? WHITE
        : BLACK;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} amount 0 devolve `a`, 1 devolve `b`
 * @returns {number[]}
 */
export function mix(a, b, amount) {
    const t = Math.min(1, Math.max(0, amount));
    return [0, 1, 2].map(i => clampByte(a[i] + (b[i] - a[i]) * t));
}

/** @param {number[]} rgb @param {number} amount 0–1 */
export function lighten(rgb, amount) {
    return mix(rgb, WHITE, amount);
}

/** @param {number[]} rgb @param {number} amount 0–1 */
export function darken(rgb, amount) {
    return mix(rgb, BLACK, amount);
}

/**
 * Clareia cores escuras e escurece cores claras, para gerar um tom vizinho que
 * continue visível sobre o mesmo fundo.
 *
 * @param {number[]} rgb
 * @param {number} amount 0–1
 * @returns {number[]}
 */
export function shiftAwayFromBackground(rgb, amount) {
    return relativeLuminance(rgb) < 0.5 ? lighten(rgb, amount) : darken(rgb, amount);
}

/**
 * Escurece um fundo até que o texto dado sobre ele atinja o contraste mínimo.
 * Usado quando a cor do texto é fixa e o fundo vem de uma imagem qualquer.
 *
 * @param {number[]} background
 * @param {number[]} foreground
 * @param {number} [minRatio] 4.5 é o mínimo AA da WCAG para texto normal
 * @returns {number[]}
 */
export function darkenForContrast(background, foreground, minRatio = 4.5) {
    let color = [...background];
    for (let step = 0; step < 20 && contrastRatio(color, foreground) < minRatio; step++)
        color = darken(color, 0.1);
    return color;
}

/** @returns {boolean} a cor é escura o suficiente para pedir texto claro */
export function isDark(rgb) {
    return relativeLuminance(rgb) < 0.4;
}

function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
