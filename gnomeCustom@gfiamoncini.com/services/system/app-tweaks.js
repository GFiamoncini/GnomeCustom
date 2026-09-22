// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Receita do tema para apps Electron que ignoram o tema GTK.
 *
 * Um tema de Shell pode trazer uma pasta `apps/` com:
 *  - `vscode.json`   — configurações do VS Code (chave → valor), postas num bloco
 *                      marcado do `settings.json` (`lib/app-tweaks.js`);
 *  - `obsidian.json` — `{"app": {...}, "appearance": {...}}`: valores para o
 *                      `obsidian.json` (ex. moldura nativa) e para o
 *                      `.obsidian/appearance.json` de cada cofre;
 *  - `obsidian.css`  — snippet ligado em cada cofre.
 *
 * Só mexe em apps já instalados e configurados (nenhum arquivo é criado onde não
 * havia app). Antes da primeira mudança em cada arquivo, uma cópia fica ao lado
 * (`.gnomecustom-backup`); os valores trocados ficam em `app-tweaks-state` para
 * serem devolvidos ao desligar a opção ou trocar para um tema sem receita. O app
 * lê a mudança quando é aberto de novo.
 *
 * Só Gio/GLib; nenhuma API do Shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    OBSIDIAN_SNIPPET, applyValues, obsidianSnippet, obsidianVaults, restoreValues,
    vscodeApply, vscodeRemove,
} from '../../lib/app-tweaks.js';

const BACKUP_SUFFIX = '.gnomecustom-backup';
const STATE_KEY = 'app-tweaks-state';

const file = (...parts) => Gio.File.new_for_path(GLib.build_filenamev(parts));

/** settings.json do VS Code e derivados, nativos e Flatpak. */
function defaultVscodeFiles() {
    const config = GLib.get_user_config_dir();
    const home = GLib.get_home_dir();
    return [
        file(config, 'Code', 'User', 'settings.json'),
        file(config, 'Code - OSS', 'User', 'settings.json'),
        file(config, 'VSCodium', 'User', 'settings.json'),
        file(home, '.var', 'app', 'com.visualstudio.code', 'config', 'Code', 'User', 'settings.json'),
        file(home, '.var', 'app', 'com.vscodium.codium', 'config', 'VSCodium', 'User', 'settings.json'),
    ];
}

/** obsidian.json, nativo e Flatpak. */
function defaultObsidianConfigs() {
    return [
        file(GLib.get_user_config_dir(), 'obsidian', 'obsidian.json'),
        file(GLib.get_home_dir(), '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
    ];
}

function readText(target) {
    try {
        return new TextDecoder().decode(target.load_contents(null)[1]);
    } catch {
        return null;
    }
}

function readJson(target) {
    const text = readText(target);
    if (text === null)
        return null;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;   // existe, mas não é JSON válido: não mexer
    }
}

export class AppTweaks {
    /**
     * @param {object} options
     * @param {object} options.logger
     * @param {Function} [options.vscodeFiles] () => Gio.File[] (testes)
     * @param {Function} [options.obsidianConfigs] () => Gio.File[] (testes)
     */
    constructor({logger, vscodeFiles = defaultVscodeFiles, obsidianConfigs = defaultObsidianConfigs}) {
        this._logger = logger;
        this._vscodeFiles = vscodeFiles;
        this._obsidianConfigs = obsidianConfigs;
    }

    /**
     * @param {?object} themeDir Gio.File da pasta do tema
     * @param {object} settings Gio.Settings `…gnomecustom.theme`
     */
    apply(themeDir, settings) {
        const apps = themeDir?.get_child('apps');
        if (!apps?.query_exists(null)) {
            this.revert(settings);
            return;
        }
        const state = this._readState(settings);

        const vscode = readJson(apps.get_child('vscode.json'));
        if (vscode)
            this._applyVscode(vscode);
        else
            this._revertVscode();

        const obsidian = readJson(apps.get_child('obsidian.json'));
        const snippet = readText(apps.get_child('obsidian.css'));
        if (obsidian || snippet !== null)
            this._applyObsidian(obsidian ?? {}, snippet, state);
        else
            this._revertObsidian(state);

        this._writeState(settings, state);
    }

    /** @param {object} settings */
    revert(settings) {
        const state = this._readState(settings);
        this._revertVscode();
        this._revertObsidian(state);
        this._writeState(settings, state);
    }

    // ---------------------------------------------------------------- VS Code

    _applyVscode(entries) {
        for (const target of this._vscodeFiles()) {
            const text = readText(target);
            if (text === null)
                continue;
            const {text: next, applied, skipped} = vscodeApply(text, entries);
            if (skipped.length > 0)
                this._logger.warn(`VS Code: ${skipped.join(', ')} já definido(s) pelo usuário em ${target.get_path()}; ficam como estão`);
            if (next !== text) {
                this._write(target, next);
                this._logger.info(`VS Code: tema aplicado em ${target.get_path()} (${applied.join(', ')})`);
            }
        }
    }

    _revertVscode() {
        for (const target of this._vscodeFiles()) {
            const text = readText(target);
            if (text === null)
                continue;
            const next = vscodeRemove(text);
            if (next !== text) {
                this._write(target, next);
                this._logger.info(`VS Code: tema retirado de ${target.get_path()}`);
            }
        }
    }

    // --------------------------------------------------------------- Obsidian

    _applyObsidian(recipe, snippet, state) {
        state.obsidian ??= {};
        for (const config of this._obsidianConfigs()) {
            const data = readJson(config);
            if (!data)
                continue;
            if (recipe.app)
                this._applyJson(config, data, recipe.app, state.obsidian, JSON.stringify);

            for (const path of obsidianVaults(data)) {
                const dir = Gio.File.new_for_path(path).get_child('.obsidian');
                if (!dir.query_exists(null))
                    continue;
                if (snippet !== null) {
                    const snippets = dir.get_child('snippets');
                    try {
                        snippets.make_directory_with_parents(null);
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                            throw e;
                    }
                    this._write(snippets.get_child(`${OBSIDIAN_SNIPPET}.css`), snippet, {backup: false});
                }
                const appearance = dir.get_child('appearance.json');
                let current = readJson(appearance);
                if (current === undefined)
                    continue;
                current ??= {};
                const withSnippet = snippet !== null ? obsidianSnippet(current, true) : current;
                this._applyJson(appearance, withSnippet, recipe.appearance ?? {}, state.obsidian,
                    value => JSON.stringify(value, null, 2), current);
            }
        }
    }

    /**
     * Grava `values` no arquivo e anota os anteriores em `store[path]`.
     *
     * @param {object} target Gio.File
     * @param {object} data conteúdo (já com outras mudanças, se houver)
     * @param {object} values
     * @param {object} store estado por arquivo
     * @param {Function} serialize
     * @param {object} [original] conteúdo lido, para saber se mudou algo
     */
    _applyJson(target, data, values, store, serialize, original = data) {
        const path = target.get_path();
        const entry = store[path] ?? {values: {}, previous: {}};
        const {data: next, previous} = applyValues(data, values, entry.previous);
        store[path] = {values: {...entry.values, ...values}, previous};
        if (JSON.stringify(next) !== JSON.stringify(original)) {
            this._write(target, `${serialize(next)}\n`);
            this._logger.info(`Obsidian: tema aplicado em ${path}`);
        }
    }

    _revertObsidian(state) {
        for (const [path, {values, previous}] of Object.entries(state.obsidian ?? {})) {
            const target = Gio.File.new_for_path(path);
            const data = readJson(target);
            if (!data)
                continue;
            let next = restoreValues(data, values, previous);
            const isAppearance = target.get_basename() === 'appearance.json';
            if (isAppearance) {
                next = obsidianSnippet(next, false);
                const snippet = target.get_parent().get_child('snippets').get_child(`${OBSIDIAN_SNIPPET}.css`);
                try {
                    snippet.delete(null);
                } catch {}
            }
            if (JSON.stringify(next) !== JSON.stringify(data)) {
                this._write(target, `${isAppearance ? JSON.stringify(next, null, 2) : JSON.stringify(next)}\n`);
                this._logger.info(`Obsidian: tema retirado de ${path}`);
            }
        }
        state.obsidian = {};
    }

    // ------------------------------------------------------------------ comum

    _write(target, text, {backup = true} = {}) {
        if (backup && target.query_exists(null)) {
            const copy = Gio.File.new_for_path(target.get_path() + BACKUP_SUFFIX);
            if (!copy.query_exists(null))
                target.copy(copy, Gio.FileCopyFlags.NONE, null, null);
        }
        target.replace_contents(new TextEncoder().encode(text), null, false,
            Gio.FileCreateFlags.NONE, null);
    }

    _readState(settings) {
        try {
            return JSON.parse(settings.get_string(STATE_KEY) || '{}');
        } catch {
            return {};
        }
    }

    _writeState(settings, state) {
        const empty = Object.keys(state.obsidian ?? {}).length === 0;
        settings.set_string(STATE_KEY, empty ? '' : JSON.stringify(state));
    }
}
