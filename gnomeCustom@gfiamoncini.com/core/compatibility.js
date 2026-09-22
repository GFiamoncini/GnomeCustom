// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detecção de versão do Shell e sinalizadores de capacidade.
 *
 * Regra do projeto (COMPATIBILITY.md): módulos nunca comparam número de versão.
 * Eles perguntam por capacidade — `compat.supports('x')` — para que uma mudança
 * de API do GNOME seja tratada em um único lugar.
 */

/** Versões efetivamente testadas. Não declarar o que não foi testado. */
export const TESTED_MAJORS = Object.freeze([49, 50]);

/**
 * Capacidades conhecidas e a faixa de versões em que existem.
 * `since` inclusivo, `until` exclusivo (null = sem limite conhecido).
 */
const FEATURES = Object.freeze({
    /** `InjectionManager` exportado por extensions/extension.js (GNOME 45+). */
    'injection-manager': {since: 45, until: null},
    /** `Main.extensionManager` com lookup/getUuids e 'extension-state-changed'. */
    'extension-manager': {since: 40, until: null},
    /** Preferências em processo separado com Adw (GNOME 42+). */
    'adw-prefs': {since: 42, until: null},
});

export class Compatibility {
    /**
     * @param {string} versionString valor de Config.PACKAGE_VERSION, ex. '49.9'
     * @param {object} [options]
     * @param {object} [options.logger]
     */
    constructor(versionString, {logger = null} = {}) {
        this._raw = String(versionString ?? '');
        this._logger = logger;

        const parts = this._raw.split('.');
        this._major = Number.parseInt(parts[0], 10);
        this._minor = Number.parseInt(parts[1] ?? '0', 10);

        if (!Number.isFinite(this._major)) {
            this._major = 0;
            this._minor = 0;
        }
        if (!Number.isFinite(this._minor))
            this._minor = 0;
    }

    get version() {
        return this._raw;
    }

    get major() {
        return this._major;
    }

    get minor() {
        return this._minor;
    }

    /** @returns {boolean} versão >= major.minor */
    atLeast(major, minor = 0) {
        if (this._major !== major)
            return this._major > major;
        return this._minor >= minor;
    }

    /** @returns {boolean} a versão em execução foi realmente testada */
    get isTested() {
        return TESTED_MAJORS.includes(this._major);
    }

    /** @param {string} feature chave de FEATURES */
    supports(feature) {
        const range = FEATURES[feature];
        if (!range) {
            this._logger?.warn(`capacidade desconhecida consultada: '${feature}'`);
            return false;
        }
        if (this._major < range.since)
            return false;
        return range.until === null || this._major < range.until;
    }

    /** Capacidades exigidas para a extensão sequer carregar. */
    get missingRequirements() {
        return ['injection-manager', 'extension-manager']
            .filter(feature => !this.supports(feature));
    }

    describe() {
        const tested = this.isTested ? 'testada' : 'NÃO testada';
        return `GNOME Shell ${this._raw} (major ${this._major}, ${tested})`;
    }
}
