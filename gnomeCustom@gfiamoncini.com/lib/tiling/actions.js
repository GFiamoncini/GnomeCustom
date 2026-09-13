// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Catálogo das ações de teclado do tiling.
 *
 * Os nomes das chaves são os do Forge, para que a migração dos atalhos seja
 * copiar valor por valor; os atalhos padrão são os do baseline do usuário
 * (`baseline/dconf-ext-forge.ini`), com uma exceção registrada: "sempre
 * flutuar" nasce sem atalho, porque o usuário o desligou em 2026-09-10.
 *
 * Três ações do Forge ficam sem efeito — pilha, abas e decoração de abas —
 * porque esses modos estão desligados no baseline e não fazem parte da fase 8.
 * Continuam no catálogo para que os atalhos migrados não se percam.
 *
 * Sem dependências do GNOME.
 */

/**
 * @typedef {object} ActionSpec
 * @property {string} key nome da chave no esquema `…tiling.keybindings`
 * @property {string[]} accels atalhos padrão
 * @property {object} action o que fazer
 * @property {string} title rótulo em inglês (marcado com N_)
 */

const N_ = message => message;

/** @type {ActionSpec[]} */
export const TILING_ACTIONS = Object.freeze([
    // foco
    {key: 'window-focus-left', accels: ['<Super>Left'], action: {type: 'focus', direction: 'left'}, title: N_('Focus the window on the left')},
    {key: 'window-focus-right', accels: ['<Super>Right'], action: {type: 'focus', direction: 'right'}, title: N_('Focus the window on the right')},
    {key: 'window-focus-up', accels: ['<Super>Up'], action: {type: 'focus', direction: 'up'}, title: N_('Focus the window above')},
    {key: 'window-focus-down', accels: ['<Super>Down'], action: {type: 'focus', direction: 'down'}, title: N_('Focus the window below')},

    // mover
    {key: 'window-move-left', accels: ['<Shift><Super>Left'], action: {type: 'move', direction: 'left'}, title: N_('Move the window left')},
    {key: 'window-move-right', accels: ['<Shift><Super>Right'], action: {type: 'move', direction: 'right'}, title: N_('Move the window right')},
    {key: 'window-move-up', accels: ['<Shift><Super>Up'], action: {type: 'move', direction: 'up'}, title: N_('Move the window up')},
    {key: 'window-move-down', accels: ['<Shift><Super>Down'], action: {type: 'move', direction: 'down'}, title: N_('Move the window down')},

    // trocar
    {key: 'window-swap-left', accels: ['<Control><Super>h'], action: {type: 'swap', direction: 'left'}, title: N_('Swap with the window on the left')},
    {key: 'window-swap-down', accels: ['<Control><Super>j'], action: {type: 'swap', direction: 'down'}, title: N_('Swap with the window below')},
    {key: 'window-swap-up', accels: ['<Control><Super>k'], action: {type: 'swap', direction: 'up'}, title: N_('Swap with the window above')},
    {key: 'window-swap-right', accels: ['<Control><Super>l'], action: {type: 'swap', direction: 'right'}, title: N_('Swap with the window on the right')},
    {key: 'window-swap-last-active', accels: ['<Super>Return'], action: {type: 'swap-last'}, title: N_('Swap with the previously focused window')},

    // divisão
    {key: 'con-split-horizontal', accels: ['<Super>k'], action: {type: 'split', orientation: 'h'}, title: N_('Split side by side')},
    {key: 'con-split-vertical', accels: ['<Super>v'], action: {type: 'split', orientation: 'v'}, title: N_('Split one above the other')},
    {key: 'con-split-layout-toggle', accels: ['<Super>g'], action: {type: 'layout-toggle'}, title: N_('Toggle the split direction')},

    // flutuar
    {key: 'window-toggle-float', accels: ['<Super>c'], action: {type: 'float-toggle'}, title: N_('Float or tile this window')},
    {key: 'window-toggle-always-float', accels: [], action: {type: 'float-class-toggle'}, title: N_('Always float windows of this application')},

    // redimensionar
    {key: 'window-resize-top-increase', accels: ['<Control><Super>i'], action: {type: 'resize', edge: 'up', sign: 1}, title: N_('Grow the top edge')},
    {key: 'window-resize-top-decrease', accels: ['<Shift><Control><Super>u'], action: {type: 'resize', edge: 'up', sign: -1}, title: N_('Shrink the top edge')},
    {key: 'window-resize-bottom-increase', accels: ['<Control><Super>u'], action: {type: 'resize', edge: 'down', sign: 1}, title: N_('Grow the bottom edge')},
    {key: 'window-resize-bottom-decrease', accels: ['<Shift><Control><Super>i'], action: {type: 'resize', edge: 'down', sign: -1}, title: N_('Shrink the bottom edge')},
    {key: 'window-resize-left-increase', accels: ['<Control><Super>y'], action: {type: 'resize', edge: 'left', sign: 1}, title: N_('Grow the left edge')},
    {key: 'window-resize-left-decrease', accels: ['<Shift><Control><Super>o'], action: {type: 'resize', edge: 'left', sign: -1}, title: N_('Shrink the left edge')},
    {key: 'window-resize-right-increase', accels: ['<Control><Super>o'], action: {type: 'resize', edge: 'right', sign: 1}, title: N_('Grow the right edge')},
    {key: 'window-resize-right-decrease', accels: ['<Shift><Control><Super>y'], action: {type: 'resize', edge: 'right', sign: -1}, title: N_('Shrink the right edge')},

    // snap
    {key: 'window-snap-center', accels: ['<Control><Alt>c'], action: {type: 'snap', side: 'center'}, title: N_('Center the window')},
    {key: 'window-snap-one-third-left', accels: ['<Control><Alt>d'], action: {type: 'snap', side: 'left', fraction: 1 / 3}, title: N_('Snap to the left third')},
    {key: 'window-snap-one-third-right', accels: ['<Control><Alt>g'], action: {type: 'snap', side: 'right', fraction: 1 / 3}, title: N_('Snap to the right third')},
    {key: 'window-snap-two-third-left', accels: ['<Control><Alt>e'], action: {type: 'snap', side: 'left', fraction: 2 / 3}, title: N_('Snap to the left two thirds')},
    {key: 'window-snap-two-third-right', accels: ['<Control><Alt>t'], action: {type: 'snap', side: 'right', fraction: 2 / 3}, title: N_('Snap to the right two thirds')},

    // espaçamento, borda e modo
    {key: 'window-gap-size-increase', accels: ['<Control><Super>plus'], action: {type: 'gap', amount: 1}, title: N_('Increase the gaps')},
    {key: 'window-gap-size-decrease', accels: ['<Control><Super>minus'], action: {type: 'gap', amount: -1}, title: N_('Decrease the gaps')},
    {key: 'focus-border-toggle', accels: ['<Super>x'], action: {type: 'setting-toggle', setting: 'focus-border'}, title: N_('Show or hide the focus border')},
    {key: 'prefs-tiling-toggle', accels: ['<Shift><Super>p'], action: {type: 'setting-toggle', setting: 'tiling-mode'}, title: N_('Turn tiling on or off')},
    {key: 'workspace-active-tile-toggle', accels: ['<Shift><Super>w'], action: {type: 'workspace-toggle'}, title: N_('Turn tiling on or off for this workspace')},

    // modos do Forge fora do escopo desta fase
    {key: 'con-stacked-layout-toggle', accels: ['<Shift><Super>a'], action: {type: 'unsupported', feature: 'stacked'}, title: N_('Stacked layout (not available)')},
    {key: 'con-tabbed-layout-toggle', accels: ['<Shift><Super>t'], action: {type: 'unsupported', feature: 'tabbed'}, title: N_('Tabbed layout (not available)')},
    {key: 'con-tabbed-showtab-decoration-toggle', accels: ['<Control><Alt>y'], action: {type: 'unsupported', feature: 'tabbed'}, title: N_('Tab decorations (not available)')},
]);

/** @returns {?ActionSpec} */
export function findAction(key) {
    return TILING_ACTIONS.find(spec => spec.key === key) ?? null;
}

/**
 * Forma canônica de um atalho, para comparar os nossos com os do sistema:
 * modificadores em ordem fixa e sem diferença de caixa (`<Super>V` é `<super>v`).
 *
 * @param {string} accel
 * @returns {string}
 */
export function normalizeAccel(accel) {
    const modifiers = [...accel.matchAll(/<([^>]+)>/g)]
        .map(m => m[1].toLowerCase().replace(/^primary$/, 'control').replace(/^ctrl$/, 'control'))
        .sort();
    const key = accel.replace(/<[^>]+>/g, '').toLowerCase();
    return `${modifiers.map(m => `<${m}>`).join('')}${key}`;
}

/**
 * Atalhos do tiling que o sistema também usa.
 *
 * @param {Array<{key: string, accels: string[]}>} ours
 * @param {Array<{schema: string, key: string, accels: string[]}>} theirs
 * @returns {Array<{accel: string, ours: string, schema: string, theirs: string}>}
 */
export function findCollisions(ours, theirs) {
    const taken = new Map();
    for (const binding of theirs) {
        for (const accel of binding.accels)
            taken.set(normalizeAccel(accel), binding);
    }

    const collisions = [];
    for (const binding of ours) {
        for (const accel of binding.accels) {
            const other = taken.get(normalizeAccel(accel));
            if (other)
                collisions.push({accel, ours: binding.key, schema: other.schema, theirs: other.key});
        }
    }
    return collisions;
}
