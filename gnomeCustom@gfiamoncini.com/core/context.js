// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Contexto compartilhado por todo o núcleo, e o contexto com escopo entregue a
 * cada módulo.
 */

import {SignalTracker} from './signals.js';
import {Patcher} from './patcher.js';

/** Contexto exclusivo de um módulo. Criado e destruído pelo ModuleManager. */
export class ModuleContext {
    constructor({id, logger, signals, patcher, settings, services, compat, extension, gettext}) {
        this.id = id;
        this.logger = logger;
        this.signals = signals;
        this.patcher = patcher;
        this.settings = settings;
        this.services = services;
        this.compat = compat;
        this.extension = extension;
        /** Função de tradução; recebida por parâmetro, como nas prefs (AD-12). */
        this.gettext = gettext;
    }

    get isClean() {
        return this.signals.isClean && this.patcher.isClean;
    }

    /** Descreve o que sobrou, para a verificação de limpeza. */
    describeLeaks() {
        const {signals, sources} = this.signals.pending;
        const patches = this.patcher.pending;
        if (signals === 0 && sources === 0 && patches === 0)
            return null;
        return `${this.id}: ${signals} sinal(is), ${sources} fonte(s), ${patches} patch(es)`;
    }

    destroy() {
        this.patcher.destroy();
        this.signals.destroy();
    }
}

export class Context {
    /**
     * @param {object} options
     * @param {object} options.extension instância de Extension
     * @param {object} options.logger
     * @param {object} options.settings SettingsManager
     * @param {object} options.compat Compatibility
     * @param {object} options.services ServiceRegistry
     * @param {Function} options.createInjectionManager () => InjectionManager
     * @param {Function} [options.gettext] função de tradução
     */
    constructor({extension, logger, settings, compat, services, createInjectionManager,
        gettext = message => message}) {
        this.extension = extension;
        this.logger = logger;
        this.settings = settings;
        this.compat = compat;
        this.services = services;
        this.gettext = gettext;
        this._createInjectionManager = createInjectionManager;
    }

    /** @param {string} id @returns {ModuleContext} */
    forModule(id) {
        const logger = this.logger.child(id);
        return new ModuleContext({
            id,
            logger,
            signals: new SignalTracker({name: id, logger}),
            patcher: new Patcher({
                injectionManager: this._createInjectionManager(),
                logger,
                scope: id,
            }),
            settings: this.settings,
            services: this.services,
            compat: this.compat,
            extension: this.extension,
            gettext: this.gettext,
        });
    }
}
