// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Catálogo dos módulos, para a interface de preferências.
 *
 * Dados puros, sem imports: usado pelo processo de preferências, que não pode
 * carregar as classes de módulo (elas dependem de APIs do Shell).
 *
 * `implemented` é a única coisa que precisa mudar quando um módulo entra: vire
 * a bandeira aqui e registre a classe em `MODULES`, no `extension.js`.
 * O teste `tests/run.js` verifica que as duas listas não divergem.
 */

/**
 * @typedef {object} ModuleInfo
 * @property {string} id
 * @property {string} key chave booleana no esquema base
 * @property {string} title rótulo em inglês (fonte para tradução)
 * @property {string} summary descrição curta em inglês
 * @property {number} phase fase do ROADMAP em que o módulo é entregue
 * @property {boolean} implemented
 */

/** Ordem idêntica à de ativação em `extension.js`. */
/** @type {ModuleInfo[]} */
export const MODULES_INFO = Object.freeze([
    {
        id: 'theme',
        key: 'theme-enabled',
        title: 'Theme',
        summary: 'Panel, menu, dock and OSD styling',
        phase: 2,
        implemented: true,
    },
    {
        id: 'panel',
        key: 'panel-enabled',
        title: 'Panel',
        summary: 'Application menu and top bar tweaks',
        phase: 2,
        implemented: true,
    },
    {
        id: 'menu',
        key: 'menu-enabled',
        title: 'Logo Menu',
        summary: 'System menu with the distribution logo',
        phase: 2,
        implemented: true,
    },
    {
        id: 'bluetooth',
        key: 'bluetooth-enabled',
        title: 'Bluetooth Battery',
        summary: 'Connected devices and their battery, with a card',
        phase: 3,
        implemented: true,
    },
    {
        id: 'volume',
        key: 'volume-enabled',
        title: 'Volume OSD',
        summary: 'Numeric volume value in the OSD',
        phase: 3,
        implemented: true,
    },
    {
        id: 'media',
        key: 'media-enabled',
        title: 'Media Controls',
        summary: 'Now playing in the top bar, with a card',
        phase: 3,
        implemented: true,
    },
    {
        id: 'dock',
        key: 'dock-enabled',
        title: 'Dock',
        summary: 'Fixed dock on the primary monitor',
        phase: 4,
        implemented: true,
    },
    {
        id: 'overview',
        key: 'overview-enabled',
        title: 'Overview',
        summary: 'Workspace thumbnails, hidden search and picture-in-picture windows',
        phase: 5,
        implemented: true,
    },
    {
        id: 'animation',
        key: 'animation-enabled',
        title: 'Animation',
        summary: 'Shell animation speed',
        phase: 6,
        implemented: true,
    },
    {
        id: 'tiling',
        key: 'tiling-enabled',
        title: 'Tiling',
        summary: 'Tree-based window tiling',
        phase: 8,
        implemented: true,
    },
    {
        id: 'diagnostics',
        key: 'diagnostics-enabled',
        title: 'Diagnostics',
        summary: 'Warns about extensions that duplicate an active module',
        phase: 1,
        implemented: true,
    },
]);

export function implementedModules() {
    return MODULES_INFO.filter(info => info.implemented);
}

export function pendingModules() {
    return MODULES_INFO.filter(info => !info.implemented);
}
