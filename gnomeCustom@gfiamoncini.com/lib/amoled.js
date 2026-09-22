// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Variante "preto AMOLED" de um tema de Shell.
 *
 * Temas escuros pintam as superfícies com cinzas (o Orchis usa #212121–#3c3c3c),
 * que numa tela OLED não apagam os pixels. Em vez de editar o tema instalado —
 * que uma atualização desfaria — o CSS dele é reescrito numa cópia: os cinzas
 * escuros descem até o preto, preservando a ordem entre eles (um card continua um
 * passo acima do fundo), e todo o resto fica como está (textos claros, cores de
 * destaque, véus translúcidos brancos de hover). Pedido do usuário, 2026-09-17.
 *
 * Sem dependências do GNOME.
 */

/** Cinzas até este valor viram preto puro: o fundo das superfícies. */
export const BLACK_POINT = 0x24;

/** A partir deste valor nada muda (cinzas médios e textos). */
const LIMIT = 0x80;

/** Diferença máxima entre canais para uma cor contar como cinza. */
const NEUTRAL_TOLERANCE = 12;

/**
 * Novo valor de um canal de cinza: 0 até o ponto de preto, depois uma rampa
 * que reencontra o valor original no limite, sem degraus.
 *
 * @param {number} value 0–255
 * @returns {number}
 */
export function darkenChannel(value) {
    if (value >= LIMIT)
        return value;
    if (value <= BLACK_POINT)
        return 0;
    return Math.round((value - BLACK_POINT) * LIMIT / (LIMIT - BLACK_POINT));
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {?number[]} a cor escurecida, ou null quando não é um cinza escuro
 */
function darkenGray(r, g, b) {
    if (Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL_TOLERANCE || Math.max(r, g, b) >= LIMIT)
        return null;
    // Um único deslocamento para os três canais mantém o leve tom de cinzas quase neutros.
    const shift = Math.max(r, g, b) - darkenChannel(Math.max(r, g, b));
    return [r, g, b].map(channel => Math.max(0, channel - shift));
}

/**
 * Marca que um tema põe no próprio CSS quando já foi desenhado para o preto (ex. o
 * Dracula-AMOLED de `themes/`): escurecer de novo apagaria os cinzas que ele usa
 * de propósito para separar botões e hovers do fundo.
 */
export const AMOLED_READY_MARK = 'gnomecustom: amoled-ready';

/**
 * @param {string} css
 * @returns {boolean} o tema já é preto AMOLED e não deve ser convertido
 */
export function isAmoledReady(css) {
    return css.includes(AMOLED_READY_MARK);
}

const hex2 = value => value.toString(16).padStart(2, '0');

/**
 * Reescreve as cores de um CSS de tema.
 *
 * @param {string} css
 * @param {object} [options]
 * @param {string} [options.baseUri] onde o tema original está (ex. 'file:///…/gnome-shell/');
 *     os `url()` relativos passam a apontar para lá, já que a cópia mora noutro lugar
 * @returns {string}
 */
export function amoledCss(css, {baseUri = ''} = {}) {
    let out = css.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (match, digits) => {
        const full = digits.length === 3 ? [...digits].map(d => d + d).join('') : digits;
        const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
        const dark = darkenGray(r, g, b);
        return dark ? `#${dark.map(hex2).join('')}` : match;
    });

    out = out.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)/g,
        (match, r, g, b, alpha) => {
            const dark = darkenGray(Number(r), Number(g), Number(b));
            if (!dark)
                return match;
            return alpha
                ? `rgba(${dark.join(', ')}${alpha.replace(/\s+$/, '')})`
                : `rgb(${dark.join(', ')})`;
        });

    if (baseUri) {
        const base = baseUri.endsWith('/') ? baseUri : `${baseUri}/`;
        out = out.replace(/url\(\s*(["']?)(?![a-z]+:|\/)([^"')]+)\1\s*\)/g,
            (_match, quote, path) => `url(${quote}${base}${path}${quote})`);
        out = out.replace(/@import\s+(["'])(?![a-z]+:|\/)([^"']+)\1/g,
            (_match, quote, path) => `@import ${quote}${base}${path}${quote}`);
    }

    return out;
}
