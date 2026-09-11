// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Identidade da distribuição, lida de `/etc/os-release`.
 *
 * O campo `LOGO` do os-release já é o nome de ícone que a distribuição declara
 * para si mesma (no Fedora 43, `fedora-logo-icon`). Usá-lo evita embarcar
 * logotipos no projeto — o que também resolve a questão de licença dos ícones
 * das extensões de referência (LICENSE-AUDIT.md §5).
 */

import Gio from 'gi://Gio';

import '../../core/gio-promises.js';

const OS_RELEASE_PATHS = ['/etc/os-release', '/usr/lib/os-release'];
const FALLBACK_ICON = 'start-here-symbolic';

export class DistroService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._fields = null;
    }

    /**
     * Lê o os-release. Assíncrono para não bloquear o loop principal (§14).
     *
     * @returns {Promise<void>}
     */
    async load() {
        if (this._fields)
            return;

        for (const path of OS_RELEASE_PATHS) {
            const fields = await this._readFile(path);
            if (fields) {
                this._fields = fields;
                this._logger.debug(
                    `distribuição: ${this.prettyName} (logo '${this.logoIconName}')`);
                return;
            }
        }

        this._logger.warn('os-release não pôde ser lido; usando valores genéricos');
        this._fields = {};
    }

    get isLoaded() {
        return this._fields !== null;
    }

    /** @returns {string} ex. 'fedora' */
    get id() {
        return this._fields?.ID ?? '';
    }

    /** @returns {string} ex. 'Fedora Linux 43 (Workstation Edition)' */
    get prettyName() {
        return this._fields?.PRETTY_NAME ?? this._fields?.NAME ?? 'GNU/Linux';
    }

    /** @returns {string} ex. 'Fedora Linux' */
    get name() {
        return this._fields?.NAME ?? this.prettyName;
    }

    /** @returns {string} nome de ícone declarado pela distribuição */
    get logoIconName() {
        return this._fields?.LOGO || FALLBACK_ICON;
    }

    /** @returns {string} ícone monocromático, que acompanha a cor do painel */
    get symbolicIconName() {
        return FALLBACK_ICON;
    }

    async _readFile(path) {
        const file = Gio.File.new_for_path(path);
        try {
            const [contents] = await file.load_contents_async(null);
            return parseOsRelease(new TextDecoder().decode(contents));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                this._logger.debug(`falha ao ler ${path}: ${e.message}`);
            return null;
        }
    }

    destroy() {
        this._fields = null;
    }
}

/**
 * @param {string} text conteúdo de um os-release
 * @returns {Object<string, string>}
 */
export function parseOsRelease(text) {
    const fields = {};
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#'))
            continue;

        const separator = line.indexOf('=');
        if (separator === -1)
            continue;

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))))
            value = value.slice(1, -1);

        fields[key] = value;
    }
    return fields;
}
