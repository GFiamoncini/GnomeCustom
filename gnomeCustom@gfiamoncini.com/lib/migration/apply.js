// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Leitura das extensões originais e gravação da importação, com backup.
 *
 * Roda no processo de preferências. Usa Gio/GLib, mas nada do GNOME Shell.
 *
 * Leitura: os esquemas de cada extensão ficam na pasta dela, fora da fonte
 * padrão do GSettings; a leitura monta uma fonte por extensão e só **lê** (o
 * `Gio.Settings` da extensão original nunca recebe `set_*`).
 *
 * Gravação: antes de qualquer importação, uma foto de todas as chaves do
 * GnomeCustom vai para `migration-backup`; "desfazer" a restaura exatamente,
 * inclusive devolvendo ao padrão as chaves que estavam no padrão.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MIGRATION_FORMAT} from './importers.js';

/** Esquemas do GnomeCustom cobertos pelo backup ('' = base). */
export const OUR_SCHEMAS = Object.freeze([
    '', 'theme', 'panel', 'menu', 'bluetooth', 'media', 'dock',
    'overview', 'animation', 'tiling', 'tiling.keybindings',
]);

/** Chaves do esquema base que nunca entram no backup (estado da própria migração). */
const BACKUP_EXCLUDED = new Set(['migration-backup', 'migration-version']);

/** Diretórios onde uma extensão pode estar instalada. */
function extensionDirs(uuid) {
    const dirs = [GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', uuid])];
    for (const dataDir of GLib.get_system_data_dirs())
        dirs.push(GLib.build_filenamev([dataDir, 'gnome-shell', 'extensions', uuid]));
    return dirs;
}

/**
 * Abre uma extensão original para leitura.
 *
 * @param {object} source item de SOURCES
 * @returns {{installed: boolean, read: Function, file: Function}}
 */
export function openSource(source) {
    const settings = {};
    for (const dir of extensionDirs(source.uuid)) {
        const schemaDir = GLib.build_filenamev([dir, 'schemas']);
        if (!GLib.file_test(GLib.build_filenamev([schemaDir, 'gschemas.compiled']), GLib.FileTest.EXISTS))
            continue;
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            schemaDir, Gio.SettingsSchemaSource.get_default(), false);
        for (const [name, id] of Object.entries(source.schemas)) {
            const schema = schemaSource.lookup(id, false);
            if (schema && !settings[name])
                settings[name] = new Gio.Settings({settings_schema: schema});
        }
        break;
    }

    const read = (key, schemaName = 'main') => {
        const s = settings[schemaName];
        if (!s || !s.settings_schema.has_key(key))
            return undefined;
        return s.get_value(key).recursiveUnpack();
    };

    const file = name => {
        const path = {
            'forge-windows': [GLib.get_user_config_dir(), 'forge', 'config', 'windows.json'],
            'forge-stylesheet': [GLib.get_user_config_dir(), 'forge', 'stylesheet', 'forge', 'stylesheet.css'],
        }[name];
        if (!path)
            return null;
        try {
            const [ok, bytes] = GLib.file_get_contents(GLib.build_filenamev(path));
            return ok ? new TextDecoder().decode(bytes) : null;
        } catch {
            return null;
        }
    };

    return {installed: Object.keys(settings).length > 0, read, file};
}

/**
 * Foto de todas as chaves do GnomeCustom.
 *
 * @param {Function} openOurs (nome do esquema filho) => Gio.Settings
 * @returns {object} {data, schemas: {nome: {chave: {value, userSet}}}}
 */
export function snapshot(openOurs) {
    const schemas = {};
    for (const name of OUR_SCHEMAS) {
        const settings = openOurs(name);
        const keys = {};
        for (const key of settings.settings_schema.list_keys()) {
            if (name === '' && BACKUP_EXCLUDED.has(key))
                continue;
            keys[key] = {
                value: settings.get_value(key).print(true),
                userSet: settings.get_user_value(key) !== null,
            };
        }
        schemas[name] = keys;
    }
    return {date: GLib.DateTime.new_now_local().format_iso8601(), schemas};
}

/**
 * Converte e ajusta um valor ao tipo e ao intervalo da chave de destino.
 *
 * @returns {{variant: ?object, adjusted: boolean, error: ?string}}
 */
export function toVariant(schemaKey, value) {
    const type = schemaKey.get_value_type().dup_string();
    let adjusted = false;
    let v = value;

    if (['u', 'i', 'd'].includes(type)) {
        v = Number(v);
        if (!Number.isFinite(v))
            return {variant: null, adjusted, error: 'não é um número'};
        if (type !== 'd') {
            const rounded = Math.round(v);
            adjusted = rounded !== v;
            v = rounded;
        }
        const [kind, range] = schemaKey.get_range().recursiveUnpack();
        if (kind === 'range') {
            const [min, max] = range;
            const clamped = Math.min(max, Math.max(min, v));
            if (clamped !== v) {
                adjusted = true;
                v = clamped;
            }
        }
    }

    let variant;
    try {
        variant = new GLib.Variant(type, v);
    } catch (e) {
        return {variant: null, adjusted, error: `tipo incompatível (${e.message})`};
    }
    if (!schemaKey.range_check(variant))
        return {variant: null, adjusted, error: `valor não aceito: ${JSON.stringify(v)}`};
    return {variant, adjusted, error: null};
}

/**
 * Grava o resultado de um ou mais importadores.
 *
 * @param {Array<{source: object, result: object}>} imports
 * @param {Function} openOurs (nome do esquema filho) => Gio.Settings
 * @returns {object} relatório: changed, unchanged, adjusted, failed, notes
 */
export function applyImports(imports, openOurs) {
    const base = openOurs('');
    base.set_string('migration-backup', JSON.stringify(snapshot(openOurs)));

    const report = {changed: [], unchanged: 0, adjusted: [], failed: [], notes: []};
    const batches = new Map();

    const batchFor = name => {
        if (!batches.has(name)) {
            const s = openOurs(name);
            // Objeto temporário: `delay()` nunca é desfeito (ver theme/presets/apply.js).
            const batch = new Gio.Settings({settings_schema: s.settings_schema, path: s.path, backend: s.backend});
            batch.delay();
            batches.set(name, batch);
        }
        return batches.get(name);
    };

    for (const {source, result} of imports) {
        for (const note of result.notes)
            report.notes.push({source: source.title, ...note});

        for (const write of result.writes) {
            const settings = batchFor(write.schema);
            const where = `${write.schema ? `${write.schema}/` : ''}${write.key}`;
            if (!settings.settings_schema.has_key(write.key)) {
                report.failed.push({source: source.title, where, reason: 'chave de destino inexistente'});
                continue;
            }

            const {variant, adjusted, error} = toVariant(settings.settings_schema.get_key(write.key), write.value);
            if (!variant) {
                report.failed.push({source: source.title, where, reason: error});
                continue;
            }
            if (adjusted)
                report.adjusted.push({source: source.title, where, value: variant.print(false)});

            if (settings.get_value(write.key).equal(variant)) {
                report.unchanged++;
                continue;
            }
            settings.set_value(write.key, variant);
            report.changed.push({source: source.title, where, from: write.from, value: variant.print(false)});
        }
    }

    for (const batch of batches.values())
        batch.apply();
    base.set_uint('migration-version', MIGRATION_FORMAT);
    return report;
}

/** @returns {?string} data do backup disponível, ou null */
export function backupDate(openOurs) {
    const text = openOurs('').get_string('migration-backup');
    if (!text)
        return null;
    try {
        return JSON.parse(text).date ?? null;
    } catch {
        return null;
    }
}

/**
 * Restaura a foto tirada antes da última importação e a apaga.
 *
 * @returns {number} quantas chaves foram restauradas
 */
export function restoreBackup(openOurs) {
    const base = openOurs('');
    const text = base.get_string('migration-backup');
    if (!text)
        return 0;

    const {schemas} = JSON.parse(text);
    let restored = 0;
    for (const [name, keys] of Object.entries(schemas)) {
        const s = openOurs(name);
        const batch = new Gio.Settings({settings_schema: s.settings_schema, path: s.path, backend: s.backend});
        batch.delay();
        for (const [key, {value, userSet}] of Object.entries(keys)) {
            if (!batch.settings_schema.has_key(key))
                continue;
            if (userSet)
                batch.set_value(key, GLib.Variant.parse(null, value, null, null));
            else
                batch.reset(key);
            restored++;
        }
        batch.apply();
    }
    base.set_string('migration-backup', '');
    return restored;
}
