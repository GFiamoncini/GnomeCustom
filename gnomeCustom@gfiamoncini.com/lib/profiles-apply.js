// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Leitura e gravação de perfis num `Gio.Settings` real (preferências e testes).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {PROFILE_MODULES, matchProfile} from './profiles.js';
import {findPreset, matchPreset} from '../theme/presets/presets.js';
import {applyPreset, readPresetValues} from '../theme/presets/apply.js';

/**
 * @param {Function} openSettings (esquema filho, '' = base) => Gio.Settings
 * @returns {string} id do perfil em uso, ou 'custom'
 */
export function currentProfile(openSettings) {
    const base = openSettings('');
    const modules = Object.fromEntries(PROFILE_MODULES.map(id => [id, base.get_boolean(`${id}-enabled`)]));
    return matchProfile({
        modules,
        themePreset: matchPreset(readPresetValues(openSettings('theme'))),
        read: (schema, key) => openSettings(schema).get_value(key).recursiveUnpack(),
    });
}

/**
 * Aplica um perfil. Módulos, tema e ajustes chegam cada um em um lote, pelo
 * mesmo motivo dos presets: o Shell vê uma rajada só por esquema.
 *
 * @param {Function} openSettings
 * @param {object} profile item de PROFILES
 */
export function applyProfile(openSettings, profile) {
    const batch = settings => {
        // Temporário: `delay()` nunca é desfeito (ver theme/presets/apply.js).
        const b = new Gio.Settings({
            settings_schema: settings.settings_schema,
            path: settings.path,
            backend: settings.backend,
        });
        b.delay();
        return b;
    };

    const base = batch(openSettings(''));
    for (const id of PROFILE_MODULES)
        base.set_boolean(`${id}-enabled`, profile.modules[id]);

    // Tema e ajustes primeiro, módulos por último: um módulo que acabou de
    // ligar já nasce com a configuração do perfil.
    if (profile.themePreset)
        applyPreset(openSettings('theme'), findPreset(profile.themePreset));

    for (const [schemaName, keys] of Object.entries(profile.values)) {
        const b = batch(openSettings(schemaName));
        for (const [key, value] of Object.entries(keys)) {
            const type = b.settings_schema.get_key(key).get_value_type().dup_string();
            b.set_value(key, new GLib.Variant(type, value));
        }
        b.apply();
    }

    base.apply();
}
