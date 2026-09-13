// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Leitura e gravação de presets num `Gio.Settings` real.
 *
 * Separado de `presets.js` porque precisa de `GLib.Variant`; ainda assim não
 * depende do GNOME Shell, então serve às preferências e aos testes.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {PRESET_KEYS} from './presets.js';

/**
 * @param {object} settings Gio.Settings de `…gnomecustom.theme`
 * @returns {Object<string, *>} valor atual de cada chave de preset
 */
export function readPresetValues(settings) {
    const values = {};
    for (const key of PRESET_KEYS)
        values[key] = settings.get_value(key).recursiveUnpack();
    return values;
}

/**
 * Grava todos os valores de um preset de uma vez.
 *
 * O lote é feito com `delay()`/`apply()`, para que as 24 chaves cheguem juntas:
 * quem observa (o módulo de tema) vê uma única rajada e regera a folha uma vez,
 * em vez de passar por estados intermediários — como a barra flutuante com as
 * margens do preset anterior.
 *
 * O lote roda num objeto **temporário** apontando para o mesmo esquema, caminho
 * e backend. `delay()` não é desfeito por `apply()`: o objeto fica em modo de
 * atraso para sempre. Se fosse o objeto de quem chama (a janela de preferências),
 * toda edição feita depois de escolher um preset ficaria pendente e nunca seria
 * gravada.
 *
 * @param {object} settings Gio.Settings de `…gnomecustom.theme`
 * @param {object} preset um item de PRESETS
 */
export function applyPreset(settings, preset) {
    const schema = settings.settings_schema;
    const batch = new Gio.Settings({
        settings_schema: schema,
        path: settings.path,
        backend: settings.backend,
    });

    batch.delay();
    try {
        for (const key of PRESET_KEYS) {
            // O tipo vem do esquema: 'd' para 1.5, 'u' para 29, 's' para enum…
            const type = schema.get_key(key).get_value_type().dup_string();
            batch.set_value(key, new GLib.Variant(type, preset.values[key]));
        }
        batch.apply();
    } catch (e) {
        batch.revert();
        throw e;
    }
}
