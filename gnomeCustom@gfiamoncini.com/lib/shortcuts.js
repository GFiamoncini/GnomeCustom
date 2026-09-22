// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras sobre atalhos de teclado, sem dependências do GNOME.
 *
 * Usadas pelo tiling (aviso de colisão no log) e pelo editor de atalhos das
 * preferências, que precisa decidir se uma combinação capturada serve.
 */

/** Esquemas de atalhos do sistema conferidos contra os nossos. */
export const SYSTEM_KEYBINDING_SCHEMAS = Object.freeze([
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
]);

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
 * Atalhos nossos que outro lugar também usa. Entradas vazias (o GNOME grava
 * `['']` para "sem atalho") não colidem com nada.
 *
 * @param {Array<{key: string, accels: string[]}>} ours
 * @param {Array<{schema: string, key: string, accels: string[]}>} theirs
 * @returns {Array<{accel: string, ours: string, schema: string, theirs: string}>}
 */
export function findCollisions(ours, theirs) {
    const taken = new Map();
    for (const binding of theirs) {
        for (const accel of binding.accels) {
            if (accel)
                taken.set(normalizeAccel(accel), binding);
        }
    }

    const collisions = [];
    for (const binding of ours) {
        for (const accel of binding.accels) {
            const other = accel ? taken.get(normalizeAccel(accel)) : null;
            if (other)
                collisions.push({accel, ours: binding.key, schema: other.schema, theirs: other.key});
        }
    }
    return collisions;
}

const MODIFIER_KEY = /^(Shift|Control|Alt|Super|Meta|Hyper)_[LR]$|^(ISO_Level[35]_Shift|ISO_Next_Group|Caps_Lock|Num_Lock|Mode_switch)$/;

/**
 * @param {string} keyName nome do keyval (ex. 'Super_L', 'p')
 * @returns {boolean} a tecla é só um modificador — a captura continua esperando
 */
export function isModifierKeyName(keyName) {
    return MODIFIER_KEY.test(keyName);
}

/**
 * Se uma combinação capturada pode virar atalho global.
 *
 * Uma tecla comum sem modificador (ou só com Shift) roubaria a digitação do
 * sistema inteiro; ela precisa de Ctrl, Alt ou Super. Teclas de função e as
 * teclas de mídia (`XF86…`) valem sozinhas.
 *
 * @param {string} keyName nome do keyval
 * @param {boolean} hasModifier há modificador além do Shift
 * @returns {boolean}
 */
export function acceptShortcut(keyName, hasModifier) {
    if (!keyName || isModifierKeyName(keyName))
        return false;
    if (hasModifier)
        return true;
    return /^F([1-9]|[12]\d|3[0-5])$/.test(keyName) || /^XF86/.test(keyName);
}
