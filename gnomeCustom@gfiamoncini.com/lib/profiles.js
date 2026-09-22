// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Perfis: quais módulos ficam ligados, qual preset de tema, e alguns ajustes.
 *
 * Mesmo desenho dos presets de tema (theme/presets/): dados puros, aplicados
 * gravando valores, e o perfil em uso é **derivado** dos valores — mexer em
 * qualquer coisa coberta por um perfil faz a interface mostrar "Personalizado".
 *
 * O perfil só define o que declara. Chaves fora dele (tamanho do dock, regras de
 * janela…) não contam para a correspondência nem são tocadas ao aplicar.
 *
 * O perfil "Desktop" é o baseline do usuário: todos os módulos ligados, com o
 * tema do papel de parede — a troca completa das 11 extensões originais.
 *
 * Sem dependências: usado pelas preferências e pelos testes.
 */

import {PRESETS} from '../theme/presets/presets.js';

const N_ = message => message;

/** Chaves `*-enabled` que um perfil controla (o diagnóstico fica de fora). */
export const PROFILE_MODULES = Object.freeze([
    'theme', 'panel', 'menu', 'bluetooth', 'volume', 'media',
    'dock', 'overview', 'animation', 'tiling',
]);

export const CUSTOM_PROFILE = 'custom';

const all = on => Object.fromEntries(PROFILE_MODULES.map(id => [id, on]));

/**
 * @typedef {object} Profile
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {Object<string, boolean>} modules
 * @property {?string} themePreset id de PRESETS, ou null para não mexer no tema
 * @property {Object<string, Object<string, *>>} values esquema filho → chave → valor
 */

/** @type {Profile[]} */
export const PROFILES = Object.freeze([
    {
        id: 'off',
        title: N_('Nothing on'),
        summary: N_('Every module off; the original extensions stay in charge'),
        modules: all(false),
        themePreset: null,
        values: {},
    },
    {
        id: 'desktop',
        title: N_('Desktop'),
        summary: N_('Everything on, reproducing the 11 original extensions (your baseline)'),
        modules: all(true),
        themePreset: 'default',
        values: {
            animation: {'speed-factor': 0.25},
            tiling: {'tiling-mode': true, 'auto-split': false},
        },
    },
    {
        id: 'developer',
        title: N_('Developer'),
        summary: N_('Tiling first: automatic splits, no dock, dark theme'),
        modules: {...all(true), dock: false, media: false},
        themePreset: 'dark',
        values: {
            animation: {'speed-factor': 0.25},
            tiling: {'tiling-mode': true, 'auto-split': true},
        },
    },
    {
        id: 'laptop',
        title: N_('Laptop'),
        summary: N_('More room on a small screen: thin bar, no dock, tiling on'),
        modules: {...all(true), dock: false},
        themePreset: 'minimal',
        values: {
            animation: {'speed-factor': 0.5},
            tiling: {'tiling-mode': true, 'auto-split': false},
        },
    },
    {
        id: 'minimal',
        title: N_('Minimal'),
        summary: N_('Only the bar, the logo menu and the volume number'),
        modules: {...all(false), theme: true, panel: true, menu: true, volume: true},
        themePreset: 'minimal',
        values: {},
    },
    {
        id: 'gaming',
        title: N_('Gaming'),
        summary: N_('Nothing moving windows around: no tiling or dock; media and Bluetooth battery on'),
        modules: {...all(true), dock: false, tiling: false, animation: false},
        themePreset: 'dark',
        values: {},
    },
]);

/** @returns {?Profile} */
export function findProfile(id) {
    return PROFILES.find(profile => profile.id === id) ?? null;
}

/**
 * Perfil que corresponde ao estado atual.
 *
 * @param {object} state
 * @param {Object<string, boolean>} state.modules módulo → ligado
 * @param {string} state.themePreset resultado de `matchPreset` do tema
 * @param {Function} state.read (esquema filho, chave) => valor
 * @returns {string} id do perfil, ou CUSTOM_PROFILE
 */
export function matchProfile({modules, themePreset, read}) {
    for (const profile of PROFILES) {
        if (!PROFILE_MODULES.every(id => Boolean(modules[id]) === profile.modules[id]))
            continue;
        if (profile.themePreset && profile.themePreset !== themePreset)
            continue;
        const valuesMatch = Object.entries(profile.values).every(([schema, keys]) =>
            Object.entries(keys).every(([key, value]) => sameValue(read(schema, key), value)));
        if (valuesMatch)
            return profile.id;
    }
    return CUSTOM_PROFILE;
}

/** Extensões originais que um perfil substituiria e que estão ativas. */
export function conflictsFor(profile, knownExtensions, isEnabled) {
    return knownExtensions.filter(entry =>
        profile.modules[entry.module] === true && isEnabled(entry.uuid));
}

/** Presets citados pelos perfis existem? (usado nos testes) */
export function unknownPresets() {
    const ids = new Set(PRESETS.map(preset => preset.id));
    return PROFILES.filter(p => p.themePreset && !ids.has(p.themePreset)).map(p => p.id);
}

function sameValue(a, b) {
    if (typeof a === 'number' && typeof b === 'number')
        return Math.abs(a - b) < 1e-6;
    return JSON.stringify(a) === JSON.stringify(b);
}
