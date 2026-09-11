// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Acesso centralizado ao GSettings.
 *
 * A instância base corresponde a `org.gnome.shell.extensions.gnomecustom`.
 * Esquemas por área (`.dock`, `.tiling`, …) são obtidos com `child()` e ficam
 * em cache. `Extension.getSettings` é recebido por injeção, de modo que este
 * arquivo sirva também ao processo de preferências e aos testes.
 */

import {SignalTracker} from './signals.js';

export class SettingsManager {
    /**
     * @param {object} options
     * @param {Function} options.getSettings (schemaId?) => Gio.Settings
     * @param {string} options.baseSchemaId
     * @param {object} [options.logger]
     */
    constructor({getSettings, baseSchemaId, logger = null}) {
        this._getSettings = getSettings;
        this._baseSchemaId = baseSchemaId;
        this._logger = logger;
        this._base = getSettings(baseSchemaId);
        this._children = new Map();
        this._signals = new SignalTracker({name: 'settings', logger});
    }

    /** @returns {object} Gio.Settings do esquema base */
    get base() {
        return this._base;
    }

    get baseSchemaId() {
        return this._baseSchemaId;
    }

    /**
     * Esquema de um módulo, ex. `child('dock')` →
     * `org.gnome.shell.extensions.gnomecustom.dock`.
     *
     * @param {string} name
     * @returns {object} Gio.Settings
     */
    child(name) {
        if (this._children.has(name))
            return this._children.get(name);

        const settings = this._getSettings(`${this._baseSchemaId}.${name}`);
        this._children.set(name, settings);
        return settings;
    }

    /** @returns {boolean} o esquema filho existe e pôde ser aberto */
    hasChild(name) {
        try {
            this.child(name);
            return true;
        } catch (e) {
            this._logger?.debug(`esquema filho '${name}' indisponível: ${e.message}`);
            return false;
        }
    }

    /**
     * Observa uma chave do esquema base.
     *
     * @param {string} key
     * @param {Function} callback recebe o valor já lido quando for booleano
     * @param {object} [options]
     * @param {boolean} [options.fireNow]
     * @returns {number} token do SignalTracker interno
     */
    watch(key, callback, {fireNow = false} = {}) {
        return this._signals.connectSetting(
            this._base, key, () => callback(), {fireNow});
    }

    getBoolean(key) {
        return this._base.get_boolean(key);
    }

    getString(key) {
        return this._base.get_string(key);
    }

    getUint(key) {
        return this._base.get_uint(key);
    }

    /** @returns {string} nick do enum, não o índice */
    getEnumNick(key) {
        return this._base.get_string(key);
    }

    destroy() {
        this._signals.destroy();
        this._children.clear();
        this._base = null;
    }
}
