// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Extensões que o GnomeCustom substitui, e o módulo que assume cada função.
 *
 * Dados puros, sem dependências: o mesmo arquivo é usado pelo processo do Shell
 * (módulo de diagnóstico) e pelo processo de preferências.
 *
 * Fonte: BASELINE-CONFIG.md §2 — as 11 extensões habitadas na máquina de
 * referência em 2026-09-09.
 */

/**
 * @typedef {object} KnownExtension
 * @property {string} uuid
 * @property {string} name
 * @property {string} module id do módulo do GnomeCustom que cobre a função
 * @property {string} feature descrição curta da função disputada
 */

/** @type {KnownExtension[]} */
export const KNOWN_EXTENSIONS = Object.freeze([
    {
        uuid: 'apps-menu@gnome-shell-extensions.gcampax.github.com',
        name: 'Apps Menu',
        module: 'panel',
        feature: 'menu de aplicações no painel',
    },
    {
        uuid: 'logomenu@aryan_k',
        name: 'Logo Menu',
        module: 'menu',
        feature: 'menu de sistema com logotipo da distribuição',
    },
    {
        uuid: 'bluetooth-battery@michalw.github.com',
        name: 'Bluetooth battery indicator',
        module: 'bluetooth',
        feature: 'bateria de dispositivos Bluetooth',
    },
    {
        uuid: 'osd-volume-number@deminder',
        name: 'OSD Volume Number',
        module: 'volume',
        feature: 'valor numérico no OSD de volume',
    },
    {
        uuid: 'spotify-controls@Sonath21',
        name: 'Spotify Controls + Track Info',
        module: 'media',
        feature: 'controles de mídia no painel',
    },
    {
        uuid: 'dash-to-dock@micxgx.gmail.com',
        name: 'Dash to Dock',
        module: 'dock',
        feature: 'dock',
    },
    {
        uuid: 'gnome-ui-tune@itstime.tech',
        name: 'Gnome 4x UI Improvements',
        module: 'overview',
        feature: 'ajustes da tela de visão geral',
    },
    {
        uuid: 'impatience@gfxmonk.net',
        name: 'Impatience',
        module: 'animation',
        feature: 'velocidade das animações',
    },
    {
        uuid: 'forge@jmmaranan.com',
        name: 'Forge',
        module: 'tiling',
        feature: 'gerenciamento de janelas em mosaico',
    },
    {
        uuid: 'openbar@neuromorph',
        name: 'Open Bar',
        module: 'theme',
        feature: 'tematização do painel e menus',
    },
    {
        uuid: 'user-theme@gnome-shell-extensions.gcampax.github.com',
        name: 'User Themes',
        module: 'theme',
        feature: 'tema de Shell do usuário',
    },
]);

/**
 * @param {string} moduleId
 * @returns {KnownExtension[]} extensões que disputam esse módulo
 */
export function extensionsForModule(moduleId) {
    return KNOWN_EXTENSIONS.filter(entry => entry.module === moduleId);
}
