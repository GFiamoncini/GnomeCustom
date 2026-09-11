// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dublês das dependências que vêm do GNOME Shell.
 *
 * Existem porque `core/` foi escrito sem imports do Shell: o núcleo inteiro,
 * inclusive o ciclo de vida completo, pode ser exercitado fora do Shell.
 */

/** Emissor de sinais no estilo GObject, o suficiente para o SignalTracker. */
export class FakeEmitter {
    constructor() {
        this._handlers = new Map();
        this._nextId = 1;
        this.connectCount = 0;
        this.disconnectCount = 0;
    }

    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, callback});
        this.connectCount++;
        return id;
    }

    disconnect(id) {
        if (!this._handlers.delete(id))
            throw new Error(`handler ${id} inexistente`);
        this.disconnectCount++;
    }

    emit(signal, ...args) {
        for (const {signal: name, callback} of [...this._handlers.values()]) {
            if (name === signal)
                callback(this, ...args);
        }
    }

    get handlerCount() {
        return this._handlers.size;
    }
}

/** Gio.Settings em memória, com emissão de `changed::<key>`. */
export class FakeSettings extends FakeEmitter {
    /** @param {object} values valores iniciais por chave */
    constructor(values = {}) {
        super();
        this._values = {...values};
    }

    get_boolean(key) {
        return Boolean(this._values[key]);
    }

    get_string(key) {
        return String(this._values[key] ?? '');
    }

    get_uint(key) {
        return Number(this._values[key] ?? 0);
    }

    get_double(key) {
        return Number(this._values[key] ?? 0);
    }

    set(key, value) {
        this._values[key] = value;
        this.emit(`changed::${key}`, key);
    }

    has(key) {
        return Object.hasOwn(this._values, key);
    }
}

/**
 * InjectionManager com a mesma superfície usada pelo Patcher. Os originais são
 * guardados por protótipo e nome, como no real: o mesmo método pode ser
 * substituído em classes diferentes ao mesmo tempo.
 */
export class FakeInjectionManager {
    constructor() {
        this._saved = new Map();   // prototype -> Map(name -> original)
        this.overrideCount = 0;
        this.restoreCount = 0;
    }

    overrideMethod(prototype, name, createOverride) {
        const byName = this._saved.get(prototype) ?? new Map();
        const original = prototype[name];
        if (!byName.has(name))
            byName.set(name, original);
        this._saved.set(prototype, byName);
        prototype[name] = createOverride(original);
        this.overrideCount++;
    }

    restoreMethod(prototype, name) {
        const byName = this._saved.get(prototype);
        if (!byName?.has(name))
            throw new Error(`nada salvo para '${name}'`);
        prototype[name] = byName.get(name);
        byName.delete(name);
        if (byName.size === 0)
            this._saved.delete(prototype);
        this.restoreCount++;
    }

    get pending() {
        let count = 0;
        for (const byName of this._saved.values())
            count += byName.size;
        return count;
    }
}

/** Extension mínima: metadata + getSettings. */
export class FakeExtension {
    /**
     * @param {object} options
     * @param {object} options.values valores do esquema base
     * @param {object} [options.metadata]
     */
    constructor({values, metadata = {}}) {
        this.uuid = 'gnomeCustom@test';
        this.metadata = {
            'settings-schema': 'org.gnome.shell.extensions.gnomecustom',
            'version-name': '0.1.0-test',
            'shell-version': ['49'],
            ...metadata,
        };
        this.base = new FakeSettings(values);
        this.children = new Map();
    }

    getSettings(schemaId) {
        if (schemaId === this.metadata['settings-schema'])
            return this.base;

        if (!this.children.has(schemaId))
            this.children.set(schemaId, new FakeSettings({}));
        return this.children.get(schemaId);
    }
}

/** Coletor de mensagens, no lugar do `console`. */
export class FakeSink {
    constructor() {
        this.lines = [];
    }

    log(message) {
        this.lines.push(['log', message]);
    }

    warn(message) {
        this.lines.push(['warn', message]);
    }

    error(message) {
        this.lines.push(['error', message]);
    }

    count(kind) {
        return this.lines.filter(([k]) => k === kind).length;
    }

    get text() {
        return this.lines.map(([, m]) => m).join('\n');
    }
}
