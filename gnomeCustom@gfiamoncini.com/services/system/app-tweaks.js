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
 *  - `obsidian.css`  — snippet ligado em cada cofre;
 *  - `github-desktop.json` — valores para o `.title-bar-config` do GitHub Desktop
 *                      (ex. `{"titleBarStyle": "native"}`). As cores dele não têm
 *                      como ser trocadas: só há os temas Claro/Escuro do próprio app.
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

/** Pastas de dados do GitHub Desktop (versão Linux da shiftkey), nativa e Flatpak. */
function defaultGithubDesktopDirs() {
    return [
        file(GLib.get_user_config_dir(), 'GitHub Desktop'),
        file(GLib.get_home_dir(), '.var', 'app', 'io.github.shiftey.Desktop', 'config', 'GitHub Desktop'),
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
     * @param {Function} [options.githubDesktopDirs] () => Gio.File[] (testes)
     */
    constructor({
        logger, vscodeFiles = defaultVscodeFiles, obsidianConfigs = defaultObsidianConfigs,
        githubDesktopDirs = defaultGithubDesktopDirs,
    }) {
        this._logger = logger;
        this._vscodeFiles = vscodeFiles;
        this._obsidianConfigs = obsidianConfigs;
        this._githubDesktopDirs = githubDesktopDirs;
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
            this._revertFiles(state, 'obsidian');

        const github = readJson(apps.get_child('github-desktop.json'));
        if (github)
            this._applyGithubDesktop(github, state);
        else
            this._revertFiles(state, 'github-desktop');

        this._writeState(settings, state);
    }

    /** @param {object} settings */
    revert(settings) {
        const state = this._readState(settings);
        this._revertVscode();
        this._revertFiles(state);
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
        for (const config of this._obsidianConfigs()) {
            const data = readJson(config);
            if (!data)
                continue;
            if (recipe.app)
                this._applyJson(config, data, recipe.app, state, 'obsidian', JSON.stringify);

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
                this._applyJson(appearance, withSnippet, recipe.appearance ?? {}, state, 'obsidian',
                    value => JSON.stringify(value, null, 2), current);
            }
        }
    }

    // --------------------------------------------------------- GitHub Desktop

    _applyGithubDesktop(values, state) {
        for (const dir of this._githubDesktopDirs()) {
            if (!dir.query_exists(null))
                continue;
            // Sem o arquivo, o app usa o padrão dele; a receita o cria com os valores.
            const config = dir.get_child('.title-bar-config');
            const data = readJson(config);
            if (data === undefined)
                continue;
            this._applyJson(config, data ?? {}, values, state, 'github-desktop', JSON.stringify,
                data ?? null);
        }
    }

    // ------------------------------------------------------ arquivos JSON

    /**
     * Grava `values` no arquivo e anota os anteriores em `state.files[path]`.
     *
     * @param {object} target Gio.File
     * @param {object} data conteúdo (já com outras mudanças, se houver)
     * @param {object} values
     * @param {object} state
     * @param {string} app dono do arquivo, para desfazer só os dele
     * @param {Function} serialize
     * @param {?object} [original] conteúdo lido, para saber se mudou algo
     */
    _applyJson(target, data, values, state, app, serialize, original = data) {
        const path = target.get_path();
        state.files ??= {};
        const entry = state.files[path] ?? {app, values: {}, previous: {}};
        const {data: next, previous} = applyValues(data, values, entry.previous);
        state.files[path] = {app, values: {...entry.values, ...values}, previous};
        if (JSON.stringify(next) !== JSON.stringify(original)) {
            this._write(target, `${serialize(next)}\n`);
            this._logger.info(`${app}: tema aplicado em ${path}`);
        }
    }

    /**
     * Devolve os arquivos anotados.
     *
     * @param {object} state
     * @param {string} [app] só os deste app; sem ele, todos
     */
    _revertFiles(state, app) {
        for (const [path, entry] of Object.entries(state.files ?? {})) {
            if (app && entry.app !== app)
                continue;
            delete state.files[path];
            const target = Gio.File.new_for_path(path);
            const data = readJson(target);
            if (!data)
                continue;
            let next = restoreValues(data, entry.values, entry.previous);
            const isAppearance = entry.app === 'obsidian' && target.get_basename() === 'appearance.json';
            if (isAppearance) {
                next = obsidianSnippet(next, false);
                const snippet = target.get_parent().get_child('snippets').get_child(`${OBSIDIAN_SNIPPET}.css`);
                try {
                    snippet.delete(null);
                } catch {}
            }
            if (JSON.stringify(next) !== JSON.stringify(data)) {
                this._write(target, `${isAppearance ? JSON.stringify(next, null, 2) : JSON.stringify(next)}\n`);
                this._logger.info(`${entry.app}: tema retirado de ${path}`);
            }
        }
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
        let state;
        try {
            state = JSON.parse(settings.get_string(STATE_KEY) || '{}');
        } catch {
            return {files: {}};
        }
        // Estado gravado antes do GitHub Desktop (2026-09-22): só havia o Obsidian.
        const files = {...state.files};
        for (const [path, entry] of Object.entries(state.obsidian ?? {}))
            files[path] ??= {app: 'obsidian', ...entry};
        return {files};
    }

    _writeState(settings, state) {
        const empty = Object.keys(state.files ?? {}).length === 0;
        settings.set_string(STATE_KEY, empty ? '' : JSON.stringify(state));
    }
}
