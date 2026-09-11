// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Rastreador de sinais e fontes do loop principal.
 *
 * A extensão roda dentro do processo do GNOME Shell: um sinal esquecido ou um
 * temporizador vivo depois de `disable()` degrada a sessão inteira. Todo
 * `connect` e todo `timeout_add` do projeto passa por aqui, para que
 * `destroy()` seja capaz de desfazer tudo sem lista manual.
 */

import GLib from 'gi://GLib';

export class SignalTracker {
    /**
     * @param {object} [options]
     * @param {string} [options.name] rótulo usado nas mensagens de diagnóstico
     * @param {object} [options.logger]
     */
    constructor({name = 'anon', logger = null} = {}) {
        this._name = name;
        this._logger = logger;
        this._signals = new Map();   // token -> {object, id, signal}
        this._sources = new Map();   // token -> {id, label}
        this._nextToken = 1;
    }

    get name() {
        return this._name;
    }

    /** @returns {{signals: number, sources: number}} */
    get pending() {
        return {signals: this._signals.size, sources: this._sources.size};
    }

    get isClean() {
        return this._signals.size === 0 && this._sources.size === 0;
    }

    /**
     * @param {object} object emissor com `connect`/`disconnect`
     * @param {string} signal
     * @param {Function} callback
     * @returns {number} token para `disconnect()`
     */
    connect(object, signal, callback) {
        if (!object)
            throw new Error(`SignalTracker(${this._name}): objeto nulo em connect('${signal}')`);

        const id = object.connect(signal, callback);
        const token = this._nextToken++;
        this._signals.set(token, {object, id, signal});
        return token;
    }

    /**
     * Atalho para `Gio.Settings`: conecta `changed::<key>` e opcionalmente
     * dispara o callback uma vez, para o estado inicial.
     *
     * @param {object} settings
     * @param {string} key
     * @param {Function} callback
     * @param {object} [options]
     * @param {boolean} [options.fireNow]
     * @returns {number}
     */
    connectSetting(settings, key, callback, {fireNow = false} = {}) {
        const token = this.connect(settings, `changed::${key}`, callback);
        if (fireNow)
            callback(settings, key);
        return token;
    }

    /** @param {number} token */
    disconnect(token) {
        const entry = this._signals.get(token);
        if (!entry)
            return false;

        this._signals.delete(token);
        try {
            entry.object.disconnect(entry.id);
        } catch (e) {
            this._logger?.debug(`sinal '${entry.signal}' já removido: ${e.message}`);
        }
        return true;
    }

    /**
     * `GLib.timeout_add` rastreado. O callback é envolvido para que a fonte
     * saia do registro quando ela própria terminar.
     *
     * @param {number} intervalMs
     * @param {Function} callback deve devolver GLib.SOURCE_CONTINUE ou _REMOVE
     * @param {object} [options]
     * @param {number} [options.priority]
     * @param {string} [options.label]
     * @returns {number} token
     */
    addTimeout(intervalMs, callback, {priority = GLib.PRIORITY_DEFAULT, label = 'timeout'} = {}) {
        const token = this._nextToken++;
        const id = GLib.timeout_add(priority, intervalMs, () => {
            const keep = callback();
            if (keep !== GLib.SOURCE_CONTINUE)
                this._sources.delete(token);
            return keep;
        });
        this._sources.set(token, {id, label});
        return token;
    }

    /**
     * `GLib.idle_add` rastreado, para trabalho adiado sem bloquear o loop.
     *
     * @param {Function} callback
     * @param {object} [options]
     * @param {string} [options.label]
     * @returns {number} token
     */
    addIdle(callback, {label = 'idle'} = {}) {
        const token = this._nextToken++;
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const keep = callback();
            if (keep !== GLib.SOURCE_CONTINUE)
                this._sources.delete(token);
            return keep;
        });
        this._sources.set(token, {id, label});
        return token;
    }

    /** @param {number} token */
    removeSource(token) {
        const entry = this._sources.get(token);
        if (!entry)
            return false;

        this._sources.delete(token);
        try {
            GLib.Source.remove(entry.id);
        } catch (e) {
            this._logger?.debug(`fonte '${entry.label}' já encerrada: ${e.message}`);
        }
        return true;
    }

    /** Desconecta tudo. Idempotente. */
    destroy() {
        for (const token of [...this._signals.keys()])
            this.disconnect(token);
        for (const token of [...this._sources.keys()])
            this.removeSource(token);
    }
}
