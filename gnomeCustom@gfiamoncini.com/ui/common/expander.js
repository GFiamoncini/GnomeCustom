// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A seta do rodapé dos cartões: compacto (o essencial) ou detalhado (o resto).
 *
 * Do WinDock: os cartões nascem compactos e a seta abre o que falta (pedido do
 * usuário, 2026-10-07). O cartão da cota de IA já era assim; este é o mesmo
 * botão, para os outros.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {scaled} from './card-scale.js';

export class Expander {
    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onToggle chamado no clique; quem guarda o estado é o módulo
     */
    constructor({gettext, onToggle}) {
        this._ = gettext;
        this._icon = new St.Icon({icon_name: 'pan-down-symbolic', icon_size: scaled(14)});
        this.button = new St.Button({
            style_class: 'gnomecustom-expander',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._icon,
        });
        this.button.connect('clicked', () => onToggle?.());
        this.set(false);
    }

    /** @param {boolean} expanded */
    set(expanded) {
        const _ = this._;
        this._icon.icon_name = expanded ? 'pan-up-symbolic' : 'pan-down-symbolic';
        this.button.accessible_name = expanded ? _('Show only the essentials') : _('Show the details');
    }
}
