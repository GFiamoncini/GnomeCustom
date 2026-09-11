// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Registro e ciclo de vida dos módulos.
 *
 * Responsabilidades:
 *  - ativar na ordem de registro e desativar na ordem inversa;
 *  - isolar falhas: exceção em um módulo não impede os outros (AD-9);
 *  - ligar/desligar a quente quando a chave do módulo muda;
 *  - dar a cada módulo escopo próprio de sinais e patches, destruído no fim.
 */

import {SignalTracker} from './signals.js';

/** @enum {string} */
export const ModuleState = Object.freeze({
    REGISTERED: 'registered',
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    FAILED: 'failed',
    UNSUPPORTED: 'unsupported',
});

export class ModuleManager {
    /**
     * @param {object} options
     * @param {object} options.context Context
     * @param {object} [options.logger]
     */
    constructor({context, logger = null}) {
        this._context = context;
        this._logger = logger ?? context.logger;
        this._entries = new Map();   // id -> {Class, instance, moduleContext, state, error}
        this._signals = new SignalTracker({name: 'module-manager', logger: this._logger});
        this._running = false;
    }

    /**
     * @param {typeof import('./module.js').Module} ModuleClass
     */
    register(ModuleClass) {
        const id = ModuleClass.id;
        if (this._entries.has(id))
            throw new Error(`Módulo '${id}' registrado duas vezes`);

        this._entries.set(id, {
            Class: ModuleClass,
            instance: null,
            moduleContext: null,
            state: ModuleState.REGISTERED,
            error: null,
        });
        this._logger.debug(`módulo registrado: ${id}`);
    }

    get ids() {
        return [...this._entries.keys()];
    }

    /** @returns {Array<{id: string, state: string, error: ?string}>} */
    get report() {
        return [...this._entries.entries()].map(([id, entry]) => ({
            id,
            state: entry.state,
            error: entry.error?.message ?? null,
        }));
    }

    get enabledIds() {
        return [...this._entries.entries()]
            .filter(([, entry]) => entry.state === ModuleState.ENABLED)
            .map(([id]) => id);
    }

    /** Ativa os módulos cuja chave está ligada e passa a observar as chaves. */
    enableAll() {
        this._running = true;
        for (const [id, entry] of this._entries) {
            const key = entry.Class.settingsKey;
            this._signals.connectSetting(this._context.settings.base, key, () =>
                this._onToggle(id));

            if (this._context.settings.getBoolean(key))
                this._enable(id);
            else
                entry.state = ModuleState.DISABLED;
        }
    }

    /** Desativa tudo, na ordem inversa do registro. */
    disableAll() {
        this._running = false;
        this._signals.destroy();
        for (const id of [...this._entries.keys()].reverse())
            this._disable(id);
    }

    /** @returns {string[]} descrições do que não foi limpo */
    collectLeaks() {
        const leaks = [];
        for (const entry of this._entries.values()) {
            const leak = entry.moduleContext?.describeLeaks();
            if (leak)
                leaks.push(leak);
        }
        return leaks;
    }

    _onToggle(id) {
        if (!this._running)
            return;

        const entry = this._entries.get(id);
        const wanted = this._context.settings.getBoolean(entry.Class.settingsKey);
        const isOn = entry.state === ModuleState.ENABLED;

        if (wanted && !isOn)
            this._enable(id);
        else if (!wanted && isOn)
            this._disable(id);
    }

    _enable(id) {
        const entry = this._entries.get(id);
        const {Class} = entry;

        const missing = Class.requires.filter(name => !this._context.services.has(name));
        if (missing.length > 0) {
            entry.state = ModuleState.UNSUPPORTED;
            entry.error = new Error(`serviços ausentes: ${missing.join(', ')}`);
            this._logger.error(`módulo '${id}' não pode ser ativado`, entry.error);
            return false;
        }

        const moduleContext = this._context.forModule(id);
        entry.moduleContext = moduleContext;

        try {
            entry.instance = new Class(moduleContext);
            entry.instance.enable();
            entry.state = ModuleState.ENABLED;
            entry.error = null;
            this._logger.info(`módulo ativado: ${id}`);
            return true;
        } catch (e) {
            entry.state = ModuleState.FAILED;
            entry.error = e;
            this._logger.error(`falha ao ativar o módulo '${id}'`, e);
            this._rollback(entry);
            return false;
        }
    }

    _disable(id) {
        const entry = this._entries.get(id);
        if (entry.state !== ModuleState.ENABLED && !entry.instance)
            return;

        try {
            entry.instance?.disable();
        } catch (e) {
            this._logger.error(`falha ao desativar o módulo '${id}'`, e);
        }
        this._rollback(entry);
        entry.state = ModuleState.DISABLED;
        this._logger.info(`módulo desativado: ${id}`);
    }

    /** Descarta instância e escopo, mesmo que enable/disable tenham falhado. */
    _rollback(entry) {
        try {
            entry.instance?.destroy();
        } catch (e) {
            this._logger.error('falha em destroy() do módulo', e);
        }
        entry.moduleContext?.destroy();
        entry.instance = null;
    }
}
