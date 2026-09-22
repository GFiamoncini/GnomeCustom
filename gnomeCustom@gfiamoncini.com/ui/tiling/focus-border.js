// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Borda desenhada em volta da janela focada.
 *
 * Um único `St.Bin` no grupo de janelas, reposicionado logo acima do ator da
 * janela focada — o mesmo lugar em que o Forge coloca a dele, para ficar por
 * cima da janela e por baixo das que estão à frente. Acompanha a janela enquanto
 * ela se move ou muda de tamanho.
 *
 * Cor, espessura e cantos vêm dos tokens `tiling` do Theme Engine; a posição, de
 * `borderRect` (fora do quadro, ocupando o gap).
 */

import St from 'gi://St';

import {SignalTracker} from '../../core/signals.js';
import {borderRadius, borderRect} from '../../lib/tiling/geometry.js';

export class FocusBorder {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._signals = new SignalTracker({name: 'focus-border', logger});
        this._actor = new St.Bin({
            style_class: 'gnomecustom-tiling-border',
            reactive: false,
            visible: false,
        });
        global.window_group.add_child(this._actor);

        this._window = null;
        this._followTokens = [];
        this._width = 3;
        this._gap = 0;
        this._color = 'transparent';
        this._radius = 0;
    }

    /** @param {{border: string, width: number, radius: number}} tokens */
    setStyle({border, width, radius}) {
        this._width = width;
        this._color = border;
        this._radius = radius;
        this._sync();
    }

    /**
     * Mostra a borda numa janela e passa a acompanhá-la.
     *
     * @param {object} window Meta.Window
     * @param {number} gap espaçamento efetivo da chave da janela
     */
    show(window, gap) {
        if (this._window !== window) {
            this._unfollow();
            this._window = window;
            const update = () => this._sync();
            this._followTokens = [
                this._signals.connect(window, 'position-changed', update),
                this._signals.connect(window, 'size-changed', update),
            ];
        }
        this._gap = gap;
        this._actor.visible = this._width > 0;
        this._sync();
    }

    hide() {
        this._unfollow();
        this._window = null;
        this._actor.visible = false;
    }

    _sync() {
        if (!this._window || !this._actor.visible)
            return;

        const windowActor = this._window.get_compositor_private();
        if (!windowActor) {
            this.hide();
            return;
        }

        const rect = borderRect(this._window.get_frame_rect(), this._width, this._gap);
        this._actor.set_position(rect.x, rect.y);
        this._actor.set_size(rect.width, rect.height);
        // O raio depende de quanto a borda ficou fora do quadro (varia com o gap).
        this._actor.style = `border: ${this._width}px solid ${this._color}; ` +
            `border-radius: ${borderRadius(this._radius, rect.outset)}px;`;

        // Logo acima da janela: por cima dela, por baixo das que estão à frente.
        if (windowActor.get_parent() === global.window_group)
            global.window_group.set_child_above_sibling(this._actor, windowActor);
    }

    _unfollow() {
        for (const token of this._followTokens)
            this._signals.disconnect(token);
        this._followTokens = [];
    }

    destroy() {
        this._signals.destroy();
        this._actor.destroy();
        this._actor = null;
        this._window = null;
    }
}
