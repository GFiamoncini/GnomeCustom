// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de animação: velocidade das animações do Shell, no lugar do Impatience.
 *
 * O baseline usa fator 0.25 (quatro vezes mais rápidas), mas também tem as
 * animações do sistema desligadas (`enable-animations = false`) — nesse estado o
 * fator só vale para as poucas animações que o GNOME sempre mostra. O módulo aplica
 * o fator do mesmo jeito e registra o aviso; a página de preferências mostra o
 * mesmo aviso ao usuário.
 */

import {Module} from '../../core/module.js';
import {clampSpeedFactor} from '../../lib/animation.js';

export class AnimationModule extends Module {
    static get id() {
        return 'animation';
    }

    static get title() {
        return 'Animation';
    }

    static get requires() {
        return ['animation'];
    }

    enable() {
        this._animation = this.service('animation');
        this._settings = this.settings.child('animation');

        this.signals.connectSetting(this._settings, 'speed-factor', () => this._apply(),
            {fireNow: true});

        this._unsubscribe = this._animation.onAnimationsChanged(() => this._report());
        this._report();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._animation?.restoreSpeedFactor();

        this._animation = null;
        this._settings = null;
    }

    _apply() {
        const factor = clampSpeedFactor(this._settings.get_double('speed-factor'));
        this._animation.applySpeedFactor(factor);
        this.log.debug(`fator de velocidade das animações: ${factor}`);
    }

    _report() {
        if (!this._animation.animationsEnabled) {
            this.log.info(
                'animações desligadas no sistema: o fator só vale para as animações que o GNOME sempre mostra');
        }
    }
}
