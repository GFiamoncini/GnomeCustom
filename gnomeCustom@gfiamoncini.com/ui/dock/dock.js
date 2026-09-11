// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Contêiner do dock: a largura inteira do monitor, colado no rodapé, com o dash
 * centralizado. O contêiner não reage a cliques — só os ícones recebem eventos.
 *
 * A altura é a do dash (que cresce com o tamanho do ícone); a cada mudança o
 * contêiner se reposiciona para continuar encostado na borda de baixo.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export class Dock extends St.Widget {
    static {
        GObject.registerClass(this);
    }

    /** @param {object} options @param {object} options.dash DockDash do serviço `dash` */
    constructor({dash}) {
        super({
            name: 'gnomecustomDock',
            style_class: 'gnomecustom-dock',
            layout_manager: new Clutter.BinLayout(),
        });

        this.dash = dash;
        this.dash.x_align = Clutter.ActorAlign.CENTER;
        this.dash.y_align = Clutter.ActorAlign.END;
        this.add_child(this.dash);

        this._monitor = null;
        this.connect('notify::height', () => this._syncPosition());
    }

    /**
     * @param {{x: number, y: number, width: number, height: number}} monitor
     * @param {number} lengthFraction fração da largura do monitor para os ícones
     */
    place(monitor, lengthFraction) {
        this._monitor = monitor;
        this.set_width(monitor.width);
        this.dash.setMaxSize(Math.floor(monitor.width * lengthFraction), monitor.height);
        this._syncPosition();
    }

    _syncPosition() {
        if (!this._monitor)
            return;
        this.set_position(this._monitor.x,
            this._monitor.y + this._monitor.height - this.height);
    }
}
