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
 * Todas as superfícies (barra, menus, OSD, dock) partem da **mesma** cor base.
 * Menus e OSD ficam um passo mais afastados dela, para ganhar profundidade sobre
 * a barra, mas nunca inventam uma segunda cor — é isso que faz um preset parecer
 * uma coisa só em vez de quatro temas colados.
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

/** Quanto menus e OSD se afastam da cor da barra. */
const SURFACE_SHIFT = 0.08;

/**
 * Chave do esquema `…gnomecustom.theme` → nome no objeto de configuração.
 *
 * É a lista única: o módulo de tema lê o GSettings por ela, observa mudanças
 * por ela, e os presets são validados contra ela. Acrescentar uma chave de
 * estilo começa aqui.
 */
export const SETTINGS_KEYS = Object.freeze({
    'panel-style': 'panelStyle',
    'panel-height': 'panelHeight',
    'panel-margin-top': 'marginTop',
    'panel-margin-bottom': 'marginBottom',
    'panel-margin-sides': 'marginSides',
    'panel-radius': 'radius',
    'panel-border-width': 'borderWidth',
    'panel-border-alpha': 'borderAlpha',
    'panel-background-alpha': 'backgroundAlpha',
    'accent-color': 'accentColor',
    'background-color': 'backgroundColor',
    'foreground-color': 'foregroundColor',
    'palette-from-wallpaper': 'paletteFromWallpaper',
    'palette': 'palette',
    'palette-slot': 'paletteSlot',
    'fitts-widgets': 'fittsWidgets',
    'style-menus': 'styleMenus',
    'style-osd': 'styleOsd',
    'style-dock': 'styleDock',
    'menu-radius': 'menuRadius',
    'menu-background-alpha': 'menuBackgroundAlpha',
    'dock-radius': 'dockRadius',
    'tiling-border-color': 'tilingBorderColor',
    'tiling-border-width': 'tilingBorderWidth',
    'tiling-border-radius': 'tilingBorderRadius',
});

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
    styleMenus: false,
    styleOsd: false,
    styleDock: false,
    menuRadius: 12,
    menuBackgroundAlpha: 0.95,
    dockRadius: 12,
    tilingBorderColor: '#9A9996',
    tilingBorderWidth: 3,
    tilingBorderRadius: 14,
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

    const panelEnabled = cfg.panelStyle !== 'none';
    const floating = cfg.panelStyle === 'floating';

    const menu = buildMenuTokens(cfg, background, accent);
    const osd = buildOsdTokens(cfg, background, accent);
    const dock = buildDockTokens(cfg, background, accent);

    return {
        /** Há alguma superfície a estilizar; falso significa CSS vazio. */
        enabled: panelEnabled || menu.enabled || osd.enabled || dock.enabled,
        accent: {
            rgb: accent,
            hex: toHex(accent),
            /** Tom vizinho, para estados de hover sobre a própria cor. */
            hover: toHex(shiftAwayFromBackground(accent, 0.15)),
        },
        panel: {
            enabled: panelEnabled,
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
        menu,
        osd,
        dock,
        tiling: buildTilingTokens(cfg, accent),
    };
}

/**
 * Cor das superfícies elevadas (menus, OSD): a base, um passo afastada.
 *
 * @returns {?number[]}
 */
function surfaceColor(background) {
    return background ? shiftAwayFromBackground(background, SURFACE_SHIFT) : null;
}

/**
 * Menus pop-up. Sem fundo resolvido, só a geometria é assumida — a mesma regra
 * da barra (AD-14).
 */
function buildMenuTokens(cfg, background, accent) {
    const enabled = Boolean(cfg.styleMenus);
    const surface = enabled ? surfaceColor(background) : null;
    const text = surface ? readableOn(surface) : null;

    return {
        enabled,
        radius: round(cfg.menuRadius),
        /** Cantos dos itens: acompanham os do menu, com folga para o padding. */
        itemRadius: Math.max(0, Math.round(cfg.menuRadius) - 4),
        background: surface ? rgba(surface, cfg.menuBackgroundAlpha) : null,
        border: surface ? rgba(shiftAwayFromBackground(surface, 0.2), 0.35) : null,
        foreground: text ? toHex(text) : null,
        hover: text ? rgba(text, 0.1) : null,
        active: surface ? rgba(accent, 0.85) : null,
        activeForeground: surface ? toHex(bestForeground(accent)) : null,
        separator: text ? rgba(text, 0.15) : null,
        subMenu: surface ? rgba(shiftAwayFromBackground(surface, 0.06), 1) : null,
    };
}

/** Janelas de OSD (volume, brilho). A barra de nível usa o destaque. */
function buildOsdTokens(cfg, background, accent) {
    const enabled = Boolean(cfg.styleOsd);
    const surface = enabled ? surfaceColor(background) : null;
    const text = surface ? readableOn(surface) : null;

    return {
        enabled,
        radius: round(cfg.menuRadius),
        background: surface ? rgba(surface, cfg.menuBackgroundAlpha) : null,
        border: surface ? rgba(shiftAwayFromBackground(surface, 0.2), 0.35) : null,
        foreground: text ? toHex(text) : null,
        levelTrack: text ? rgba(text, 0.15) : null,
        levelFill: surface ? toHex(accent) : null,
    };
}

/**
 * Dock. O fundo sai como RGB puro, porque a opacidade continua sendo uma
 * decisão do módulo do dock (a chave `background-opacity` dele); o dock aplica
 * o fundo como estilo próprio, que o CSS gerado não conseguiria sobrepor.
 */
function buildDockTokens(cfg, background, accent) {
    const enabled = Boolean(cfg.styleDock);
    const colored = enabled && Boolean(background);

    const text = colored ? readableOn(background) : null;

    return {
        enabled,
        radius: round(cfg.dockRadius),
        backgroundRgb: colored ? [...background] : null,
        dot: colored ? rgba(accent, 0.7) : null,
        dotFocused: colored ? toHex(accent) : null,
        // O tema do GNOME pinta um disco cinza atrás de cada ícone do Dash
        // (#38383b no modo escuro). Sobre um fundo colorido ele destoa, então com
        // cor resolvida os ícones flutuam sobre o fundo do dock e o realce sai da
        // mesma base.
        tileHover: text ? rgba(text, 0.15) : null,
        tileActive: colored ? rgba(accent, 0.35) : null,
    };
}

/**
 * Borda da janela focada no tiling. Consumida pelo módulo da Fase 8; ficar aqui
 * garante que ela siga o mesmo destaque quando um preset pede.
 */
function buildTilingTokens(cfg, accent) {
    const border = parseHex(cfg.tilingBorderColor) ?? accent;
    return {
        border: toHex(border),
        followsAccent: !parseHex(cfg.tilingBorderColor),
        width: Math.max(0, Math.round(cfg.tilingBorderWidth)),
        radius: Math.max(0, Math.round(cfg.tilingBorderRadius)),
    };
}

/** Texto legível sobre uma cor, com o mesmo amaciamento seguro da barra. */
function readableOn(color) {
    const pure = bestForeground(color);
    const softened = mix(pure, color, FOREGROUND_SOFTENING);
    return contrastRatio(color, softened) >= MIN_CONTRAST ? softened : pure;
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

    // Um passo na direção do fundo tira o aspecto de preto ou branco puro, mas
    // só quando sobra contraste para isso: em fundos de luminância média o
    // amaciamento derrubaria o texto abaixo do mínimo legível.
    return readableOn(background);
}

function round(value) {
    return Math.round(Number(value) * 100) / 100;
}
