// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * "Cartões compactos" (pedido do usuário, 2026-10-11): os nossos cartões com
 * letra, ícones e respiro menores, sem mexer em mais nada da interface.
 *
 * Em vez de uma segunda folha escrita à mão, a versão compacta **sai da
 * `stylesheet.css`**: toda regra de cartão é repetida com as medidas em px
 * multiplicadas, e a raiz de cada cartão ganha um `font-size` em `em`, que as
 * letras de dentro (todas em `em`) herdam. Cartão novo entra sozinho.
 *
 * As regras da **barra** ficam de fora: o respiro dela tem chave própria.
 * Sem GIO: quem lê o arquivo é o módulo de tema.
 */

/** Medidas em px. */
export const COMPACT_SCALE = 0.85;

/** Letra: menos que as medidas, para as legendas (0,75em) continuarem legíveis. */
export const COMPACT_FONT_SCALE = 0.9;

const CARD = /^\.gnomecustom-(media|bt|weather|aiusage|removable|updates|sysmon|expander)\b/;

/** O que desses prefixos mora na barra, e não no cartão. */
const PANEL = /-panel\b|-panel-|\.gnomecustom-media-(thumb|separator|control)/;

const ROOT = /^\.gnomecustom-[a-z]+-card$/;

/**
 * @param {number} px
 * @param {number} [scale]
 * @returns {number} inteiro; o que não era zero não vira zero
 */
export function scalePx(px, scale = COMPACT_SCALE) {
    if (!Number.isFinite(px) || px === 0 || scale === 1)
        return px;
    return Math.sign(px) * Math.max(1, Math.round(Math.abs(px) * scale));
}

/**
 * @param {string} source o texto da `stylesheet.css`
 * @param {object} [options]
 * @param {number} [options.scale]
 * @param {number} [options.fontScale]
 * @returns {string} só as regras de cartão, só com o que muda
 */
export function compactCss(source, {scale = COMPACT_SCALE, fontScale = COMPACT_FONT_SCALE} = {}) {
    const text = String(source ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const shrink = value => value.replace(/(-?\d*\.?\d+)px\b/g, (_m, n) => `${scalePx(Number(n), scale)}px`);

    const rules = [];
    // Propriedades que mudam em algum cartão. Elas são regravadas em **toda**
    // regra de cartão, mude o valor ou não: o `!important` de uma regra geral
    // (`padding-top: 9px`) passaria por cima da exceção mais específica que não
    // muda (`.first { padding-top: 0 }`).
    const touched = new Set();
    for (const [, rawSelector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = rawSelector.split(',').map(s => s.trim().replace(/\s+/g, ' '))
            .filter(s => CARD.test(s) && !PANEL.test(s));
        if (selectors.length === 0)
            continue;

        const root = selectors.some(s => ROOT.test(s));
        const declarations = [];
        for (const declaration of body.split(';')) {
            const colon = declaration.indexOf(':');
            if (colon === -1)
                continue;
            const property = declaration.slice(0, colon).trim();
            const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/, '');
            let scaled = shrink(value);
            if (property === 'font-size' && root)
                scaled = scaled.replace(/(\d*\.?\d+)em\b/, (_m, n) => `${round2(Number(n) * fontScale)}em`);
            if (scaled !== value)
                touched.add(property);
            declarations.push({property, value: scaled, changed: scaled !== value});
        }
        if (root && !declarations.some(d => d.property === 'font-size'))
            declarations.push({property: 'font-size', value: `${round2(fontScale)}em`, changed: true});
        rules.push({selectors, declarations});
    }

    const blocks = [];
    for (const {selectors, declarations} of rules) {
        const lines = declarations.filter(d => d.changed || touched.has(d.property))
            .map(d => `${d.property}: ${d.value} !important;`);
        if (lines.length > 0)
            blocks.push(`${selectors.join(',\n')} {\n    ${lines.join('\n    ')}\n}`);
    }
    return blocks.join('\n\n');
}

function round2(value) {
    return Math.round(value * 100) / 100;
}
