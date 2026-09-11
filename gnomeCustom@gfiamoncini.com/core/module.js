// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Classe base de todos os módulos.
 *
 * Invariantes (ARCHITECTURE.md §4):
 *  1. `disable()` desfaz tudo o que `enable()` fez;
 *  2. nenhum módulo consulta a existência de outro — só a própria chave;
 *  3. exceção em um módulo não derruba os demais (garantido pelo ModuleManager);
 *  4. nada de I/O síncrono.
 *
 * O `ModuleContext` recebido no construtor já vem com escopo próprio: logger
 * derivado, `SignalTracker` e `Patcher` exclusivos. O ModuleManager destrói
 * esses três após `disable()`, então um módulo que use apenas
 * `this.signals`/`this.patcher` não vaza por construção.
 */

export class Module {
    /** Identificador curto, usado em log, ordem de ativação e diagnóstico. */
    static get id() {
        throw new Error('Módulo sem id');
    }

    /** Chave booleana no esquema base que liga/desliga o módulo. */
    static get settingsKey() {
        return `${this.id}-enabled`;
    }

    /** Serviços exigidos; o ModuleManager falha cedo se algum não existir. */
    static get requires() {
        return [];
    }

    /** Nome exibido nas preferências. */
    static get title() {
        return this.id;
    }

    /** @param {object} context ModuleContext */
    constructor(context) {
        this.ctx = context;
        this.log = context.logger;
        this.signals = context.signals;
        this.patcher = context.patcher;
        this.settings = context.settings;
        this.compat = context.compat;
    }

    /** @param {string} name nome de um serviço declarado em `requires` */
    service(name) {
        if (!this.constructor.requires.includes(name)) {
            throw new Error(
                `Módulo '${this.constructor.id}' pediu o serviço '${name}' sem declará-lo em requires`);
        }
        return this.ctx.services.get(name);
    }

    enable() {}

    disable() {}

    destroy() {}
}
