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

/**
 * Sistema de janelas em memória, com a interface do adaptador que o
 * `TilingController` espera. Monitores lado a lado; área útil = monitor menos
 * uma barra de 32 px no topo.
 */
export class FakeWindowSystem {
    /**
     * @param {object} [options]
     * @param {Array<{width: number, height: number}>} [options.monitors]
     * @param {number} [options.workspaces]
     */
    constructor({monitors = [{width: 1600, height: 900}], workspaces = 1} = {}) {
        let x = 0;
        this._monitors = monitors.map(size => {
            const monitor = {x, y: 0, ...size};
            x += size.width;
            return monitor;
        });
        this.workspaces = workspaces;
        this.active = 0;
        this.windows = new Map();
        this.focused = null;
        this.pointerAt = [0, 0];
        this.moves = [];
        this.pending = new Map();
        this.deferConfigure = false;
        this.above = new Set();
        this._nextId = 100;
    }

    /** Cria uma janela; `rect` padrão encosta no canto do monitor. */
    add(over = {}) {
        const id = over.id ?? this._nextId++;
        const monitor = over.monitor ?? 0;
        const m = this._monitors[monitor];
        const desc = {
            id, wmClass: 'org.gnome.TextEditor', title: `Janela ${id}`, type: 'normal',
            transient: false, allowsResize: true, minimized: false, fullscreen: false,
            maximized: false, skipTaskbar: false, monitor, workspace: 0, ...over,
        };
        delete desc.rect;
        const rect = over.rect ?? {x: m.x + 10 * this.windows.size, y: 40, width: 400, height: 300};
        this.windows.set(id, {desc, rect: {...rect}});
        return id;
    }

    remove(id) {
        this.windows.delete(id);
        if (this.focused === id)
            this.focused = null;
    }

    set(id, changes) {
        Object.assign(this.windows.get(id).desc, changes);
    }

    // ---------------------------------------------------------- adaptador

    describe(id) {
        const entry = this.windows.get(id);
        return entry ? {...entry.desc} : null;
    }

    list() {
        return [...this.windows.keys()];
    }

    workArea(monitor) {
        const m = this._monitors[monitor];
        return {x: m.x, y: m.y + 32, width: m.width, height: m.height - 32};
    }

    activeWorkspace() {
        return this.active;
    }

    monitors() {
        return this._monitors.length;
    }

    monitorNeighbor(monitor, direction) {
        if (direction === 'left')
            return monitor > 0 ? monitor - 1 : -1;
        if (direction === 'right')
            return monitor < this._monitors.length - 1 ? monitor + 1 : -1;
        return -1;
    }

    monitorAt(x, y) {
        return this._monitors.findIndex(m =>
            x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
    }

    frameRect(id) {
        return {...this.windows.get(id).rect};
    }

    moveResize(id, rect) {
        const entry = this.windows.get(id);
        this.moves.push([id, {...rect}]);
        if (this.deferConfigure) {
            // Cliente Wayland: o retângulo só muda quando `configureAll()` rodar.
            this.pending.set(id, {...rect});
            return;
        }
        entry.rect = {...rect};
        entry.desc.maximized = false;     // como o adaptador real, desmaximiza antes
        // O monitor acompanha o centro da janela, como no Mutter.
        const monitor = this.monitorAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (monitor >= 0)
            entry.desc.monitor = monitor;
    }

    /** Aplica os tamanhos pendentes, como um cliente que acabou de confirmar. */
    configureAll() {
        const pending = [...this.pending.entries()];
        this.pending.clear();
        const defer = this.deferConfigure;
        this.deferConfigure = false;
        for (const [id, rect] of pending) {
            this.moveResize(id, rect);
            this.moves.pop();
        }
        this.deferConfigure = defer;
    }

    activate(id) {
        this.focused = id;
    }

    setAbove(id, above) {
        if (above)
            this.above.add(id);
        else
            this.above.delete(id);
    }

    focusedId() {
        return this.focused;
    }

    pointer() {
        return [...this.pointerAt];
    }
}
