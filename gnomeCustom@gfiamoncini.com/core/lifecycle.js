// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Orquestra o ciclo de vida completo da extensão (ARCHITECTURE.md §5).
 *
 * enable():  compat → logger → settings → migração → serviços → módulos → observadores
 * disable(): observadores → módulos → serviços → logger   (ordem exata inversa)
 *
 * A regra mais importante do projeto: desativar deve restaurar o estado anterior
 * do GNOME. Por isso `disable()` nunca aborta no meio — cada etapa é protegida,
 * de modo que uma falha em uma delas não impeça as seguintes.
 */

import {Logger} from './logger.js';
import {Compatibility} from './compatibility.js';
import {SettingsManager} from './settings.js';
import {ServiceRegistry} from './services.js';
import {Context} from './context.js';
import {ModuleManager} from './module-manager.js';
import {SignalTracker} from './signals.js';

export class Lifecycle {
    /**
     * @param {object} options
     * @param {object} options.extension instância de Extension
     * @param {string} options.shellVersion Config.PACKAGE_VERSION
     * @param {Function} options.createInjectionManager () => InjectionManager
     * @param {Object<string, Function>} options.serviceFactories
     * @param {Array} options.modules classes de módulo, na ordem de ativação
     * @param {object} [options.sink] destino das mensagens; por padrão `console`
     * @param {Function} [options.gettext] função de tradução repassada aos módulos
     */
    constructor({extension, shellVersion, createInjectionManager, serviceFactories, modules,
        sink = console, gettext = message => message}) {
        this._extension = extension;
        this._shellVersion = shellVersion;
        this._createInjectionManager = createInjectionManager;
        this._serviceFactories = serviceFactories;
        this._moduleClasses = modules;
        this._sink = sink;
        this._gettext = gettext;

        this._logger = null;
        this._settings = null;
        this._services = null;
        this._modules = null;
        this._signals = null;
        this._compat = null;
    }

    get logger() {
        return this._logger;
    }

    /** @returns {?object} relatório usado pelo módulo de diagnóstico */
    get status() {
        if (!this._modules)
            return null;
        return {
            version: this._extension.metadata['version-name'] ?? '?',
            shell: this._compat?.describe() ?? '?',
            modules: this._modules.report,
        };
    }

    enable() {
        this._logger = new Logger({prefix: 'GnomeCustom', sink: this._sink});
        this._compat = new Compatibility(this._shellVersion, {logger: this._logger});

        const missing = this._compat.missingRequirements;
        if (missing.length > 0) {
            this._logger.error(
                `ambiente incompatível (${this._compat.describe()}): faltam ${missing.join(', ')}`);
            return;
        }

        this._settings = new SettingsManager({
            getSettings: schemaId => this._extension.getSettings(schemaId),
            baseSchemaId: this._extension.metadata['settings-schema'],
            logger: this._logger,
        });

        this._logger.setLevelRecursive(this._settings.getEnumNick('log-level'));
        this._logger.info(`iniciando ${this._compat.describe()}`);
        if (!this._compat.isTested) {
            this._logger.warn(
                `esta versão do GNOME Shell não foi testada com o GnomeCustom (testadas: 49)`);
        }

        this._services = new ServiceRegistry({
            factories: this._buildServiceFactories(),
            logger: this._logger,
        });

        const context = new Context({
            extension: this._extension,
            logger: this._logger,
            settings: this._settings,
            compat: this._compat,
            services: this._services,
            createInjectionManager: this._createInjectionManager,
            gettext: this._gettext,
        });

        this._modules = new ModuleManager({context, logger: this._logger});
        for (const ModuleClass of this._moduleClasses)
            this._modules.register(ModuleClass);

        this._modules.enableAll();

        this._signals = new SignalTracker({name: 'lifecycle', logger: this._logger});
        this._signals.connectSetting(this._settings.base, 'log-level', () => {
            const nick = this._settings.getEnumNick('log-level');
            this._logger.setLevelRecursive(nick);
            this._logger.info(`nível de log: ${nick}`);
        });

        const enabled = this._modules.enabledIds;
        this._logger.info(enabled.length > 0
            ? `módulos ativos: ${enabled.join(', ')}`
            : 'nenhum módulo ativo');
    }

    disable() {
        const strict = this._settings?.getBoolean('strict-cleanup-check') ?? false;

        this._step('observadores', () => this._signals?.destroy());
        this._step('módulos', () => this._modules?.disableAll());

        if (strict)
            this._checkCleanup();

        this._step('serviços', () => this._services?.destroyAll());
        this._step('configuração', () => this._settings?.destroy());

        this._logger?.info('desativado');

        this._signals = null;
        this._modules = null;
        this._services = null;
        this._settings = null;
        this._compat = null;
        this._logger = null;
    }

    /** Executa uma etapa de `disable()` sem deixar que a falha interrompa as demais. */
    _step(label, fn) {
        try {
            fn();
        } catch (e) {
            this._logger?.error(`falha ao desmontar '${label}'`, e);
        }
    }

    _checkCleanup() {
        const leaks = this._modules?.collectLeaks() ?? [];
        if (leaks.length === 0) {
            this._logger?.info('verificação de limpeza: nada pendente');
            return;
        }
        for (const leak of leaks)
            this._logger?.warn(`verificação de limpeza: ${leak}`);
    }

    /** Junta as fábricas de serviço com as que dependem do próprio núcleo. */
    _buildServiceFactories() {
        return {
            ...this._serviceFactories,
            status: () => ({
                get: () => this.status,
                destroy: () => {},
            }),
        };
    }
}
