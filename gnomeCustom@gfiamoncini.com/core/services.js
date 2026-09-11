// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Registro de serviços com criação tardia.
 *
 * As fábricas são fornecidas por `extension.js` (o único lugar que importa
 * módulos internos do Shell). Um serviço só é construído quando o primeiro
 * módulo que o exige é ativado — logo, desabilitar módulos também evita o custo
 * dos serviços correspondentes.
 *
 * Cada fábrica é chamada com `{name, logger}`, de modo que um serviço nunca
 * precise alcançar o núcleo para obter seu próprio logger.
 */

export class ServiceRegistry {
    /**
     * @param {object} options
     * @param {Object<string, Function>} options.factories nome => ({name, logger}) => serviço
     * @param {object} [options.logger]
     */
    constructor({factories = {}, logger = null} = {}) {
        this._factories = factories;
        this._logger = logger;
        this._instances = new Map();
    }

    get names() {
        return Object.keys(this._factories);
    }

    get activeNames() {
        return [...this._instances.keys()];
    }

    has(name) {
        return Object.hasOwn(this._factories, name);
    }

    /**
     * @param {string} name
     * @returns {object} o serviço, criado na primeira chamada
     */
    get(name) {
        if (this._instances.has(name))
            return this._instances.get(name);

        const factory = this._factories[name];
        if (!factory)
            throw new Error(`Serviço desconhecido: '${name}'`);

        const instance = factory({
            name,
            logger: this._logger?.child(`svc:${name}`) ?? null,
        });
        this._instances.set(name, instance);
        this._logger?.debug(`serviço criado: ${name}`);
        return instance;
    }

    /** Destrói os serviços criados, na ordem inversa da criação. */
    destroyAll() {
        for (const name of [...this._instances.keys()].reverse()) {
            const instance = this._instances.get(name);
            this._instances.delete(name);
            try {
                instance.destroy?.();
                this._logger?.debug(`serviço destruído: ${name}`);
            } catch (e) {
                this._logger?.error(`falha ao destruir o serviço '${name}'`, e);
            }
        }
    }
}
