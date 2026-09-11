// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Velocidade das animações do Shell (COMPATIBILITY.md §2).
 *
 * APIs usadas:
 *   // GNOME 49: St.Settings.get().slow_down_factor (leitura e escrita)
 *   // GNOME 49: St.Settings.get().enable_animations, 'notify::enable-animations'
 *
 * No Shell 49, `Environment.adjustAnimationTime` devolve zero quando as animações do
 * sistema estão desligadas — exceto nas marcadas como obrigatórias — e multiplica a
 * duração pelo fator nas demais. Por isso o fator quase não tem efeito com as
 * animações desligadas, e o módulo apenas avisa.
 *
 * Adaptado do Impatience (© 2012 Tim Cuthbertson, GPL-3.0-or-later — reuso
 * permitido, LICENSE-AUDIT.md §4): guardar o fator original, aplicar o
 * configurado e devolver o original ao desligar.
 */

import St from 'gi://St';

import {SignalTracker} from '../../core/signals.js';

export class AnimationService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._settings = St.Settings.get();
        this._signals = new SignalTracker({name: 'svc:animation', logger});
        this._listeners = new Set();
        this._original = null;

        this._signals.connect(this._settings, 'notify::enable-animations', () => {
            for (const listener of this._listeners) {
                try {
                    listener(this.animationsEnabled);
                } catch (e) {
                    this._logger.error('observador de animações falhou', e);
                }
            }
        });
    }

    /** @returns {boolean} as animações do sistema estão ligadas */
    get animationsEnabled() {
        return this._settings.enable_animations;
    }

    /** @returns {number} fator em uso agora */
    get speedFactor() {
        return this._settings.slow_down_factor;
    }

    /**
     * Aplica um fator, guardando o que estava em uso na primeira vez.
     *
     * @param {number} factor maior que zero
     */
    applySpeedFactor(factor) {
        if (this._original === null)
            this._original = this._settings.slow_down_factor;
        this._settings.slow_down_factor = factor;
    }

    /** Devolve o fator que estava em uso antes. Idempotente. */
    restoreSpeedFactor() {
        if (this._original === null)
            return;
        this._settings.slow_down_factor = this._original;
        this._logger.debug(`fator de animação restaurado: ${this._original}`);
        this._original = null;
    }

    /**
     * @param {Function} callback recebe `animationsEnabled`
     * @returns {Function} remove o observador
     */
    onAnimationsChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    destroy() {
        this.restoreSpeedFactor();
        this._signals.destroy();
        this._listeners.clear();
    }
}
