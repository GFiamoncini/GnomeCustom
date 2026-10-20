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
 *
 * Enquanto um menu da janela está aberto, a borda some: os popovers do GTK 4 são
 * superfícies à parte que o Mutter só prende ao monitor, e por isso passam por
 * cima da borda quando o botão fica perto da beirada da janela.
 */

import Meta from 'gi://Meta';
import St from 'gi://St';

import {SignalTracker} from '../../core/signals.js';
import {borderRadius, borderRect} from '../../lib/tiling/geometry.js';

// Janelas de menu: popovers do GTK 4 (xdg_popup) e menus de apps X11.
const MENU_TYPES = new Set([
    Meta.WindowType.DROPDOWN_MENU,
    Meta.WindowType.POPUP_MENU,
    Meta.WindowType.MENU,
    Meta.WindowType.COMBO,
]);

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
        this._menus = new Set();

        this._signals.connect(global.display, 'window-created',
            (_display, window) => this._trackMenu(window));
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
        this._actor.visible = this._width > 0 && this._menus.size === 0;
        this._sync();
    }

    hide() {
        this._unfollow();
        this._window = null;
        this._actor.visible = false;
    }

    /** Esconde a borda enquanto um menu da janela focada estiver aberto. */
    _trackMenu(window) {
        if (!this._window || !MENU_TYPES.has(window.get_window_type()))
            return;
        // Menus de outras janelas não interessam; sem dono conhecido, vale o foco.
        const owner = window.get_transient_for();
        if (owner && !this._ownedBy(owner))
            return;

        this._menus.add(window);
        this._actor.visible = false;
        const token = this._signals.connect(window, 'unmanaged', () => {
            this._signals.disconnect(token);
            this._menus.delete(window);
            if (this._menus.size === 0 && this._window)
                this.show(this._window, this._gap);
        });
    }

    /** A janela é a focada ou um menu dela (submenus apontam para o menu-pai). */
    _ownedBy(window) {
        for (let w = window; w; w = w.get_transient_for()) {
            if (w === this._window || this._menus.has(w))
                return true;
        }
        return false;
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
