// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Presets do Theme Engine.
 *
 * Um preset é só um conjunto completo de valores para as chaves de estilo do
 * esquema `…gnomecustom.theme`. Aplicar um preset = gravar esses valores; o
 * módulo de tema já reage a cada chave, então não há caminho especial.
 *
 * Deliberadamente **não existe** uma chave "preset atual". O preset em uso é
 * *derivado* dos valores (`matchPreset`): se o usuário mexer em qualquer chave,
 * a interface mostra "Personalizado" sem que nada precise ser sincronizado — e
 * não há estado que possa ficar dessincronizado.
 *
 * Ficam de fora, de propósito:
 *  - `shell-theme`: o tema de Shell instalado é escolha independente da paleta;
 *  - `palette`: é cache regenerado a partir do papel de parede, não preferência.
 *
 * Sem dependências: usado pelo processo do Shell, pelas preferências e pelos testes.
 */

/** Chaves que um preset define por completo, na ordem em que são gravadas. */
export const PRESET_KEYS = Object.freeze([
    'panel-style', 'panel-height', 'panel-margin-top', 'panel-margin-bottom',
    'panel-margin-sides', 'panel-radius', 'panel-border-width',
    'panel-border-alpha', 'panel-background-alpha', 'accent-color',
    'background-color', 'foreground-color', 'palette-from-wallpaper',
    'palette-slot', 'fitts-widgets', 'style-menus', 'style-osd', 'style-dock',
    'menu-radius', 'menu-background-alpha', 'dock-radius',
    'tiling-border-color', 'tiling-border-width', 'tiling-border-radius',
]);

/**
 * Marca uma string para extração pelo xgettext sem traduzi-la aqui.
 *
 * Este arquivo não conhece o domínio de tradução (roda em três processos); quem
 * exibe o texto chama `_()` sobre ele. O `Makefile` passa `--keyword=N_`.
 */
const N_ = message => message;

/** Identificador exibido quando os valores não casam com nenhum preset. */
export const CUSTOM_PRESET = 'custom';

/** Tolerância na comparação de números reais vindos do GSettings. */
const EPSILON = 1e-6;

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} title rótulo em inglês, marcado com N_ para tradução
 * @property {string} summary idem
 * @property {Object<string, *>} values valor de cada chave de PRESET_KEYS
 */

/** @type {Preset[]} */
export const PRESETS = Object.freeze([
    {
        // Exatamente os defaults do esquema, que por sua vez são o baseline do
        // usuário (Open Bar flutuante com a paleta do papel de parede). Um teste
        // garante que os três não divergem.
        id: 'default',
        title: N_('Wallpaper'),
        summary: N_('Floating bar coloured from the wallpaper; menus, OSD and dock left to the shell theme'),
        values: {
            'panel-style': 'floating',
            'panel-height': 29,
            'panel-margin-top': 1.5,
            'panel-margin-bottom': 2.1,
            'panel-margin-sides': 4.5,
            'panel-radius': 15,
            'panel-border-width': 2,
            'panel-border-alpha': 0.5,
            'panel-background-alpha': 0.9,
            'accent-color': '#1C71D8',
            'background-color': '',
            'foreground-color': '',
            'palette-from-wallpaper': true,
            'palette-slot': 0,
            'fitts-widgets': true,
            'style-menus': false,
            'style-osd': false,
            'style-dock': false,
            'menu-radius': 12,
            'menu-background-alpha': 0.95,
            'dock-radius': 12,
            'tiling-border-color': '#9A9996',
            'tiling-border-width': 3,
            'tiling-border-radius': 14,
        },
    },
    {
        // Devolve tudo ao tema de Shell: nenhuma cor, nenhuma geometria nossa.
        id: 'adwaita',
        title: N_('Adwaita'),
        summary: N_('Hands every surface back to the shell theme'),
        values: {
            'panel-style': 'none',
            'panel-height': 29,
            'panel-margin-top': 0,
            'panel-margin-bottom': 0,
            'panel-margin-sides': 0,
            'panel-radius': 0,
            'panel-border-width': 0,
            'panel-border-alpha': 0.5,
            'panel-background-alpha': 1,
            'accent-color': '#3584E4',
            'background-color': '',
            'foreground-color': '',
            'palette-from-wallpaper': false,
            'palette-slot': 0,
            'fitts-widgets': false,
            'style-menus': false,
            'style-osd': false,
            'style-dock': false,
            'menu-radius': 12,
            'menu-background-alpha': 0.95,
            'dock-radius': 12,
            'tiling-border-color': '',
            'tiling-border-width': 3,
            'tiling-border-radius': 12,
        },
    },
    {
        id: 'dark',
        title: N_('Dark'),
        summary: N_('Solid dark bar attached to the edge, with menus, OSD and dock to match'),
        values: {
            'panel-style': 'attached',
            'panel-height': 30,
            'panel-margin-top': 0,
            'panel-margin-bottom': 0,
            'panel-margin-sides': 0,
            'panel-radius': 0,
            'panel-border-width': 0,
            'panel-border-alpha': 0.5,
            'panel-background-alpha': 1,
            'accent-color': '#3584E4',
            'background-color': '#1E1E1E',
            'foreground-color': '',
            'palette-from-wallpaper': false,
            'palette-slot': 0,
            'fitts-widgets': true,
            'style-menus': true,
            'style-osd': true,
            'style-dock': true,
            'menu-radius': 12,
            'menu-background-alpha': 0.97,
            'dock-radius': 12,
            'tiling-border-color': '',
            'tiling-border-width': 3,
            'tiling-border-radius': 12,
        },
    },
    {
        id: 'minimal',
        title: N_('Minimal'),
        summary: N_('Thin translucent bar, square corners, no borders'),
        values: {
            'panel-style': 'attached',
            'panel-height': 26,
            'panel-margin-top': 0,
            'panel-margin-bottom': 0,
            'panel-margin-sides': 0,
            'panel-radius': 0,
            'panel-border-width': 0,
            'panel-border-alpha': 0,
            'panel-background-alpha': 0.6,
            'accent-color': '#9A9996',
            'background-color': '#000000',
            'foreground-color': '',
            'palette-from-wallpaper': false,
            'palette-slot': 0,
            'fitts-widgets': true,
            'style-menus': true,
            'style-osd': true,
            'style-dock': true,
            'menu-radius': 6,
            'menu-background-alpha': 0.92,
            'dock-radius': 6,
            'tiling-border-color': '',
            'tiling-border-width': 2,
            'tiling-border-radius': 6,
        },
    },
    {
        id: 'fedora',
        title: N_('Fedora'),
        summary: N_('Floating bar in Fedora blue with a light-blue accent'),
        values: {
            'panel-style': 'floating',
            'panel-height': 30,
            'panel-margin-top': 3,
            'panel-margin-bottom': 3,
            'panel-margin-sides': 9,
            'panel-radius': 12,
            'panel-border-width': 1,
            'panel-border-alpha': 0.4,
            'panel-background-alpha': 0.95,
            'accent-color': '#51A2DA',
            'background-color': '#294172',
            'foreground-color': '',
            'palette-from-wallpaper': false,
            'palette-slot': 0,
            'fitts-widgets': true,
            'style-menus': true,
            'style-osd': true,
            'style-dock': true,
            'menu-radius': 14,
            'menu-background-alpha': 0.96,
            'dock-radius': 14,
            'tiling-border-color': '',
            'tiling-border-width': 3,
            'tiling-border-radius': 14,
        },
    },
]);

/**
 * @param {string} id
 * @returns {?Preset}
 */
export function findPreset(id) {
    return PRESETS.find(preset => preset.id === id) ?? null;
}

/**
 * Qual preset corresponde exatamente aos valores atuais.
 *
 * @param {Object<string, *>} values valor atual de cada chave de PRESET_KEYS
 * @returns {string} id do preset, ou CUSTOM_PRESET
 */
export function matchPreset(values) {
    for (const preset of PRESETS) {
        if (PRESET_KEYS.every(key => sameValue(values[key], preset.values[key])))
            return preset.id;
    }
    return CUSTOM_PRESET;
}

function sameValue(a, b) {
    if (typeof a === 'number' && typeof b === 'number')
        return Math.abs(a - b) < EPSILON;
    // Cores são comparadas sem diferenciar maiúsculas: '#1c71d8' é '#1C71D8'.
    if (typeof a === 'string' && typeof b === 'string')
        return a.toLowerCase() === b.toLowerCase();
    return a === b;
}
