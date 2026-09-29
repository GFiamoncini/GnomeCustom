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

/**
 * Marca strings para o xgettext; quem exibe chama `_()` sobre elas.
 * (Faltava: até a Fase 9 os nomes dos módulos apareciam em inglês.)
 */
const N_ = message => message;

/** Ordem idêntica à de ativação em `extension.js`. */
/** @type {ModuleInfo[]} */
export const MODULES_INFO = Object.freeze([
    {
        id: 'theme',
        key: 'theme-enabled',
        title: N_('Theme'),
        summary: N_('Panel, menu, dock and OSD styling'),
        phase: 2,
        implemented: true,
    },
    {
        id: 'panel',
        key: 'panel-enabled',
        title: N_('Panel'),
        summary: N_('Application menu and top bar tweaks'),
        phase: 2,
        implemented: true,
    },
    {
        id: 'menu',
        key: 'menu-enabled',
        title: N_('Logo Menu'),
        summary: N_('System menu with the distribution logo'),
        phase: 2,
        implemented: true,
    },
    {
        id: 'bluetooth',
        key: 'bluetooth-enabled',
        title: N_('Bluetooth Battery'),
        summary: N_('Connected devices and their battery, with a card'),
        phase: 3,
        implemented: true,
    },
    {
        id: 'volume',
        key: 'volume-enabled',
        title: N_('Volume OSD'),
        summary: N_('Numeric volume value in the OSD'),
        phase: 3,
        implemented: true,
    },
    {
        id: 'media',
        key: 'media-enabled',
        title: N_('Media Controls'),
        summary: N_('Now playing in the top bar, with a card'),
        phase: 3,
        implemented: true,
    },
    {
        id: 'weather',
        key: 'weather-enabled',
        title: N_('Weather'),
        summary: N_('Weather and forecast for your city, from Open-Meteo'),
        phase: 10,
        implemented: true,
    },
    {
        id: 'aiusage',
        key: 'aiusage-enabled',
        title: N_('AI Usage'),
        summary: N_('How much of your Claude plan was used, with a card'),
        phase: 10,
        implemented: true,
    },
    {
        id: 'removable',
        key: 'removable-enabled',
        title: N_('Removable Devices'),
        summary: N_('Safely remove USB sticks and external drives, from the top bar'),
        phase: 10,
        implemented: true,
    },
    {
        id: 'updates',
        key: 'updates-enabled',
        title: N_('Updates'),
        summary: N_('Pending system and Flatpak updates, from the top bar'),
        phase: 10,
        implemented: true,
    },
    {
        id: 'dock',
        key: 'dock-enabled',
        title: N_('Dock'),
        summary: N_('Fixed dock on the primary monitor'),
        phase: 4,
        implemented: true,
    },
    {
        id: 'overview',
        key: 'overview-enabled',
        title: N_('Overview'),
        summary: N_('Workspace thumbnails, hidden search and picture-in-picture windows'),
        phase: 5,
        implemented: true,
    },
    {
        id: 'animation',
        key: 'animation-enabled',
        title: N_('Animation'),
        summary: N_('Shell animation speed'),
        phase: 6,
        implemented: true,
    },
    {
        id: 'tiling',
        key: 'tiling-enabled',
        title: N_('Tiling'),
        summary: N_('Tree-based window tiling'),
        phase: 8,
        implemented: true,
    },
    {
        id: 'diagnostics',
        key: 'diagnostics-enabled',
        title: N_('Diagnostics'),
        summary: N_('Warns about extensions that duplicate an active module'),
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
