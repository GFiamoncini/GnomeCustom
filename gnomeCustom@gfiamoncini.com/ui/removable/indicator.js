// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de remover dispositivo externo e o card, no desenho do WinDock.
 *
 * Na barra, só o ícone do pen-drive. No card: o título, um aparelho por linha
 * (nome, montagens e tamanho embaixo, e as ações **Abrir** e **Remover** à
 * direita) e o recado da última tentativa no fim.
 *
 * As ações são palavras, e não ícones, pela mesma razão do WinDock: nenhum
 * ícone diz "ejetar" sem ambiguidade nesse tamanho, e com duas ações na mesma
 * linha a diferença entre elas é o que mais precisa ficar clara. A linha em si
 * não é botão: seriam duas ações disputando o mesmo clique.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {describeDevice} from '../../lib/removable.js';

const ICON = 'media-removable-symbolic';

export class RemovableIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onOpenDevice (id) abrir no gerenciador de arquivos
     * @param {Function} options.onEject (id) remover com segurança
     * @param {Function} options.onClosed o card fechou
     */
    constructor({gettext, onOpenDevice, onEject, onClosed}) {
        super(0.5, 'GnomeCustom Removable', false);

        this._ = gettext;
        this._callbacks = {onOpenDevice, onEject, onClosed};

        this.add_child(new St.Icon({icon_name: ICON, style_class: 'system-status-icon'}));
        this.accessible_name = gettext('Remove safely');

        this._buildCard();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._callbacks.onClosed?.();
        });
    }

    /**
     * @param {object[]} devices `Device` de lib/removable.js
     * @param {object} state
     * @param {?string} state.busy id do aparelho saindo agora
     * @param {?{kind: string, text: string}} state.message recado da última tentativa
     */
    update(devices, {busy = null, message = null} = {}) {
        const _ = this._;

        this._list.destroy_all_children();
        // Sem aparelho e com recado ("já pode desconectar"), o recado basta.
        if (devices.length === 0 && !message)
            this._list.add_child(this._label(_('Nothing to remove.'), 'gnomecustom-removable-empty'));
        for (const device of devices)
            this._list.add_child(this._row(device, busy));

        this._message.visible = Boolean(message);
        this._message.text = message?.text ?? '';
        for (const kind of ['ok', 'error'])
            this._message.remove_style_class_name(kind);
        if (message?.kind)
            this._message.add_style_class_name(message.kind);
    }

    _buildCard() {
        const _ = this._;
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-removable-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-removable-card',
        });

        const header = new St.BoxLayout({style_class: 'gnomecustom-removable-header'});
        header.add_child(new St.Icon({
            icon_name: ICON,
            style_class: 'gnomecustom-removable-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: _('Remove safely'),
            style_class: 'gnomecustom-removable-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        card.add_child(header);

        this._list = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-removable-list'});
        card.add_child(this._list);

        this._message = this._label('', 'gnomecustom-removable-message');
        this._message.clutter_text.line_wrap = true;
        this._message.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._message.visible = false;
        card.add_child(this._message);

        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    _row(device, busy) {
        const _ = this._;
        const row = new St.BoxLayout({style_class: 'gnomecustom-removable-row', reactive: true, track_hover: true});

        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(this._label(device.name, 'gnomecustom-removable-name'));
        const detail = describeDevice(device, bytes => GLib.format_size(bytes));
        if (detail)
            text.add_child(this._label(detail, 'gnomecustom-removable-detail'));
        row.add_child(text);

        const idle = busy === null;
        row.add_child(this._action(_('Open'), _('Open in the file manager'), idle, () => {
            this.menu.close();
            this._callbacks.onOpenDevice?.(device.id);
        }));
        row.add_child(this._action(_('Remove'), _('Remove this device safely'), idle,
            () => this._callbacks.onEject?.(device.id)));
        return row;
    }

    _action(text, accessibleName, sensitive, onClick) {
        // Classe própria, e não a pseudo-classe `insensitive`: no ensaio ela não
        // apagava o botão, e durante a remoção os dois precisam parecer desligados.
        const button = new St.Button({
            label: text,
            style_class: sensitive ? 'gnomecustom-removable-action' : 'gnomecustom-removable-action disabled',
            can_focus: true,
            reactive: sensitive,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
        });
        button.connect('clicked', onClick);
        return button;
    }

    _label(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    destroy() {
        this._callbacks = {};
        super.destroy();
    }
}
