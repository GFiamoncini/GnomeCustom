// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Logger com níveis. Sem dependência do GNOME Shell — o mesmo código serve ao
 * processo do Shell, ao processo de preferências e aos testes.
 */

export const LogLevel = Object.freeze({
    SILENT: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
});

const NICKS = ['silent', 'error', 'warn', 'info', 'debug'];

/** @param {string|number} value nick ('debug') ou valor numérico */
export function toLogLevel(value) {
    if (typeof value === 'number')
        return Math.min(LogLevel.DEBUG, Math.max(LogLevel.SILENT, value | 0));

    const index = NICKS.indexOf(String(value));
    return index === -1 ? LogLevel.WARN : index;
}

export function logLevelNick(level) {
    return NICKS[toLogLevel(level)];
}

export class Logger {
    /**
     * @param {object} [options]
     * @param {string} [options.prefix] rótulo entre colchetes
     * @param {string|number} [options.level]
     * @param {object} [options.sink] destino; por padrão `console`
     */
    constructor({prefix = 'GnomeCustom', level = LogLevel.WARN, sink = console} = {}) {
        this._prefix = prefix;
        this._level = toLogLevel(level);
        this._sink = sink;
    }

    get level() {
        return this._level;
    }

    get prefix() {
        return this._prefix;
    }

    setLevel(value) {
        this._level = toLogLevel(value);
    }

    /** Logger derivado, com o mesmo nível e destino, para um escopo. */
    child(scope) {
        const child = new Logger({
            prefix: `${this._prefix}/${scope}`,
            level: this._level,
            sink: this._sink,
        });
        this._children ??= [];
        this._children.push(child);
        return child;
    }

    /** Propaga o nível para este logger e todos os derivados. */
    setLevelRecursive(value) {
        this.setLevel(value);
        for (const child of this._children ?? [])
            child.setLevelRecursive(value);
    }

    error(message, error = null) {
        if (this._level < LogLevel.ERROR)
            return;
        if (error)
            this._sink.error(`${this._tag()} ${message}: ${error.message ?? error}\n${error.stack ?? ''}`);
        else
            this._sink.error(`${this._tag()} ${message}`);
    }

    warn(message) {
        if (this._level >= LogLevel.WARN)
            this._sink.warn(`${this._tag()} ${message}`);
    }

    info(message) {
        if (this._level >= LogLevel.INFO)
            this._sink.log(`${this._tag()} ${message}`);
    }

    debug(message) {
        if (this._level >= LogLevel.DEBUG)
            this._sink.log(`${this._tag()} ${message}`);
    }

    _tag() {
        return `[${this._prefix}]`;
    }
}
