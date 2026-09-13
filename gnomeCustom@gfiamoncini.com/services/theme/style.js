// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Tokens de estilo em vigor, para quem não pode ser estilizado só por CSS.
 *
 * O caso concreto é o dock: o fundo dele é estilo próprio do ator (porque a
 * opacidade é configuração do dock), e estilo próprio vence qualquer folha.
 * Então o módulo de tema *publica* os tokens aqui e o dock *lê* daqui.
 *
 * Isso preserva a regra fundamental do projeto (§6): o dock não pergunta se o
 * módulo de tema existe ou está ligado. Ele consulta um valor que pode ser
 * `null` — e com `null` usa a própria cor padrão, funcionando por inteiro.
 *
 * Sem dependências do GNOME Shell.
 */

export class StyleService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._tokens = null;
        this._listeners = new Set();
    }

    /** @returns {?object} tokens em vigor, ou null quando ninguém publicou */
    get tokens() {
        return this._tokens;
    }

    /**
     * @param {?object} tokens saída de `buildTokens()`, ou null para retirar
     */
    publish(tokens) {
        this._tokens = tokens ?? null;
        for (const listener of this._listeners) {
            try {
                listener(this._tokens);
            } catch (e) {
                this._logger?.error('observador de estilo falhou', e);
            }
        }
    }

    /** Retira os tokens: os consumidores voltam aos próprios padrões. */
    clear() {
        if (this._tokens !== null)
            this.publish(null);
    }

    /**
     * @param {Function} callback recebe os tokens (ou null)
     * @returns {Function} remove o observador
     */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    destroy() {
        this._listeners.clear();
        this._tokens = null;
    }
}
