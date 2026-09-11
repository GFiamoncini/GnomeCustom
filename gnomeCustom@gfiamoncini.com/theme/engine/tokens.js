// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Modelo de estilo: transforma configuração crua em *tokens* prontos para uso.
 *
 * Todo consumidor de estilo (painel, dock, menus, OSD, bordas do tiling) pede
 * tokens a este módulo em vez de escrever CSS próprio ou reler o GSettings.
 * Assim existe um único lugar que decide, por exemplo, qual é a cor de texto do
 * painel — e uma única regra de precedência:
 *
 *   cor explícita na configuração  →  cor da paleta do papel de parede  →  nada
 *   (e, quando não há nada, o tema de Shell do usuário permanece no controle)
 *
 * Sem dependências do GNOME: recebe um objeto simples e devolve outro.
 */

import {
    parseHex, toHex, rgba, bestForeground, isDark,
    shiftAwayFromBackground, mix, contrastRatio,
} from './color.js';

/** Contraste mínimo exigido entre texto e fundo do painel (WCAG 2.1 AA). */
const MIN_CONTRAST = 4.5;

/** Quanto o texto é puxado na direção do fundo, quando sobra contraste. */
const FOREGROUND_SOFTENING = 0.1;

/** Valores equivalentes aos defaults do esquema `…gnomecustom.theme`. */
export const DEFAULT_CONFIG = Object.freeze({
    panelStyle: 'floating',
    panelHeight: 29,
    marginTop: 1.5,
    marginBottom: 2.1,
    marginSides: 4.5,
    radius: 15,
    borderWidth: 2,
    borderAlpha: 0.5,
    backgroundAlpha: 0.9,
    accentColor: '#1C71D8',
    backgroundColor: '',
    foregroundColor: '',
    paletteFromWallpaper: true,
    palette: [],
    paletteSlot: 0,
    fittsWidgets: true,
});

/**
 * @param {object} config valores de configuração (ver DEFAULT_CONFIG)
 * @returns {object} tokens de estilo
 */
export function buildTokens(config = {}) {
    const cfg = {...DEFAULT_CONFIG, ...config};

    const accent = parseHex(cfg.accentColor) ?? parseHex(DEFAULT_CONFIG.accentColor);
    const background = resolveBackground(cfg);
    const foreground = resolveForeground(cfg, background);

    const enabled = cfg.panelStyle !== 'none';
    const floating = cfg.panelStyle === 'floating';

    return {
        enabled,
        accent: {
            rgb: accent,
            hex: toHex(accent),
            /** Tom vizinho, para estados de hover sobre a própria cor. */
            hover: toHex(shiftAwayFromBackground(accent, 0.15)),
        },
        panel: {
            style: cfg.panelStyle,
            floating,
            height: Math.round(cfg.panelHeight),
            margin: floating
                ? {
                    top: round(cfg.marginTop),
                    bottom: round(cfg.marginBottom),
                    sides: round(cfg.marginSides),
                }
                : {top: 0, bottom: 0, sides: 0},
            radius: floating ? round(cfg.radius) : 0,
            borderWidth: round(cfg.borderWidth),
            /** null quando nenhuma cor foi resolvida: o tema do usuário decide. */
            background: background ? rgba(background, cfg.backgroundAlpha) : null,
            backgroundHex: background ? toHex(background) : null,
            border: background
                ? rgba(shiftAwayFromBackground(background, 0.35), cfg.borderAlpha)
                : null,
            foreground: foreground ? toHex(foreground) : null,
            /** Fundo dos botões sob o ponteiro. */
            buttonHover: foreground ? rgba(foreground, 0.12) : null,
            /** Fundo dos botões de menu aberto. */
            buttonActive: rgba(accent, 0.85),
            buttonActiveForeground: toHex(bestForeground(accent)),
            isDark: background ? isDark(background) : null,
            fitts: Boolean(cfg.fittsWidgets),
        },
    };
}

/**
 * Fundo do painel: cor explícita, senão a fatia escolhida da paleta.
 *
 * @returns {?number[]}
 */
function resolveBackground(cfg) {
    const explicit = parseHex(cfg.backgroundColor);
    if (explicit)
        return explicit;

    if (!cfg.paletteFromWallpaper)
        return null;

    const palette = Array.isArray(cfg.palette) ? cfg.palette : [];
    if (palette.length === 0)
        return null;

    const slot = Math.min(Math.max(0, cfg.paletteSlot | 0), palette.length - 1);
    return parseHex(palette[slot]);
}

/**
 * Texto do painel: cor explícita, senão o extremo de maior contraste com o
 * fundo resolvido. Sem fundo resolvido não há o que garantir, então devolve
 * null e o tema do usuário continua no comando.
 *
 * @returns {?number[]}
 */
function resolveForeground(cfg, background) {
    const explicit = parseHex(cfg.foregroundColor);
    if (explicit)
        return explicit;

    if (!background)
        return null;

    const pure = bestForeground(background);

    // Um passo na direção do fundo tira o aspecto de preto ou branco puro, mas
    // só quando sobra contraste para isso: em fundos de luminância média o
    // amaciamento derrubaria o texto abaixo do mínimo legível.
    const softened = mix(pure, background, FOREGROUND_SOFTENING);
    return contrastRatio(background, softened) >= MIN_CONTRAST ? softened : pure;
}

function round(value) {
    return Math.round(Number(value) * 100) / 100;
}
