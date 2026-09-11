// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Camada única de modificação de APIs internas do GNOME Shell.
 *
 * Decisão arquitetural AD-3: `InjectionManager` é o **único** mecanismo de patch
 * permitido no projeto. Atribuição crua em protótipo (`Proto.method = ...`) e
 * `Object.defineProperty` sobre objetos do Shell são proibidos — é o padrão que
 * torna as extensões de referência frágeis a cada versão do GNOME.
 *
 * O `InjectionManager` é recebido por injeção de dependência, e não importado
 * aqui, para manter `core/` livre de dependências do Shell e testável.
 */

export class Patcher {
    /**
     * @param {object} options
     * @param {object} options.injectionManager instância de InjectionManager
     * @param {object} [options.logger]
     * @param {string} [options.scope] rótulo do dono destes patches
     */
    constructor({injectionManager, logger = null, scope = 'anon'}) {
        if (!injectionManager)
            throw new Error('Patcher exige um InjectionManager');

        this._injections = injectionManager;
        this._logger = logger;
        this._scope = scope;
        this._patches = [];   // {prototype, method, api}
    }

    get scope() {
        return this._scope;
    }

    get pending() {
        return this._patches.length;
    }

    get isClean() {
        return this._patches.length === 0;
    }

    /** Rótulos das APIs modificadas, para o relatório de diagnóstico. */
    get patchedApis() {
        return this._patches.map(p => p.api);
    }

    /**
     * @param {object} prototype protótipo alvo
     * @param {string} method nome do método
     * @param {Function} createOverride recebe o método original e devolve o substituto
     * @param {object} [options]
     * @param {string} [options.api] rótulo legível, ex. 'OsdWindow._sync'
     */
    override(prototype, method, createOverride, {api = null} = {}) {
        if (!prototype || typeof prototype !== 'object')
            throw new Error(`Patcher(${this._scope}): protótipo inválido para '${method}'`);
        if (typeof prototype[method] !== 'function')
            throw new Error(`Patcher(${this._scope}): '${method}' não é um método do alvo`);

        const label = api ?? `${prototype.constructor?.name ?? '?'}.${method}`;
        this._injections.overrideMethod(prototype, method, createOverride);
        this._patches.push({prototype, method, api: label});
        this._logger?.debug(`patch aplicado: ${label}`);
        return label;
    }

    /** Reverte um patch específico. */
    restore(prototype, method) {
        const index = this._patches.findIndex(
            p => p.prototype === prototype && p.method === method);
        if (index === -1)
            return false;

        const [patch] = this._patches.splice(index, 1);
        this._injections.restoreMethod(prototype, method);
        this._logger?.debug(`patch revertido: ${patch.api}`);
        return true;
    }

    /** Reverte todos os patches deste escopo. Idempotente. */
    revertAll() {
        if (this._patches.length === 0)
            return;

        for (const patch of [...this._patches].reverse()) {
            try {
                this._injections.restoreMethod(patch.prototype, patch.method);
            } catch (e) {
                this._logger?.error(`falha ao reverter ${patch.api}`, e);
            }
        }
        this._logger?.debug(`${this._patches.length} patch(es) revertido(s)`);
        this._patches.length = 0;
    }

    destroy() {
        this.revertAll();
    }
}
