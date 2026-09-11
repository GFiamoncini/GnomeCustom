// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de Bluetooth da barra superior e o card com os dispositivos conectados.
 *
 * Mesmo formato do card de mídia (`ui/media/indicator.js`). Na barra, o ícone de
 * cada dispositivo conectado com a bateria ao lado; no card, uma linha por
 * dispositivo com nome, porcentagem e barra. Clicar na linha conecta ou
 * desconecta — quem é desconectado pelo card continua na lista, esmaecido, até o
 * card fechar, para dar para desfazer.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4).
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isLowBattery} from '../../lib/bluetooth.js';

const FALLBACK_ICON = 'bluetooth-active-symbolic';

export class BluetoothIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onToggle (path, connect) => void
     * @param {Function} options.onClosed chamado quando o card fecha
     */
    constructor({gettext, onToggle, onClosed}) {
        super(0.5, 'GnomeCustom Bluetooth', false);

        this._ = gettext;
        this._onToggle = onToggle;
        this._onClosed = onClosed;

        this._panelBox = new St.BoxLayout({style_class: 'gnomecustom-bt-panel'});
        this.add_child(this._panelBox);
        this._buildCard();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._onClosed?.();
        });
    }

    /**
     * @param {object} state
     * @param {object[]} state.devices lista já filtrada e ordenada
     * @param {number} state.threshold limite de bateria baixa; 0 desliga
     * @param {Set<string>} state.pending caminhos com conexão em andamento
     */
    update({devices, threshold, pending}) {
        this._panelBox.destroy_all_children();
        this._list.destroy_all_children();

        for (const device of devices) {
            const low = device.connected && isLowBattery(device.battery, threshold);
            if (device.connected)
                this._panelBox.add_child(this._panelItem(device, low));
            this._list.add_child(this._row(device, low, pending.has(device.path)));
        }
    }

    _buildCard() {
        this.menu.box.add_style_class_name('gnomecustom-bt-menu');

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-bt-item',
        });

        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-bt-card',
        });
        card.add_child(new St.Label({
            text: 'Bluetooth',
            style_class: 'gnomecustom-bt-header',
            x_expand: true,
        }));

        this._list = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-bt-list'});
        card.add_child(this._list);

        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    _panelItem(device, low) {
        const box = new St.BoxLayout({style_class: 'gnomecustom-bt-panel-item'});
        if (low)
            box.add_style_class_name('low');

        box.add_child(new St.Icon({
            icon_name: device.icon,
            fallback_icon_name: FALLBACK_ICON,
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (device.battery !== null) {
            box.add_child(new St.Label({
                text: `${device.battery}%`,
                style_class: 'gnomecustom-bt-panel-value',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        return box;
    }

    _row(device, low, busy) {
        const row = new St.Button({
            style_class: 'gnomecustom-bt-row',
            can_focus: true,
            x_expand: true,
            reactive: !busy,
        });
        if (low)
            row.add_style_class_name('low');
        if (!device.connected)
            row.add_style_class_name('disconnected');

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-bt-row-box',
        });

        const top = new St.BoxLayout({style_class: 'gnomecustom-bt-row-top'});
        top.add_child(new St.Icon({
            icon_name: device.icon,
            fallback_icon_name: FALLBACK_ICON,
            style_class: 'gnomecustom-bt-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const name = new St.Label({
            text: device.name,
            style_class: 'gnomecustom-bt-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        top.add_child(name);

        if (device.connected && device.battery !== null) {
            top.add_child(new St.Label({
                text: `${device.battery}%`,
                style_class: 'gnomecustom-bt-value',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        box.add_child(top);

        const note = this._note(device, busy);
        if (note)
            box.add_child(new St.Label({text: note, style_class: 'gnomecustom-bt-note'}));
        else
            box.add_child(this._batteryBar(device.battery));

        row.set_child(box);
        row.connect('clicked', () => this._onToggle?.(device.path, !device.connected));
        return row;
    }

    _note(device, busy) {
        const _ = this._;
        if (busy)
            return device.connected ? _('Disconnecting…') : _('Connecting…');
        if (!device.connected)
            return _('Disconnected — click to connect');
        if (device.battery === null)
            return _('No battery information');
        return null;
    }

    _batteryBar(percentage) {
        // Caixa horizontal, como na barra de mídia: o BinLayout centralizaria o
        // preenchimento de largura fixa.
        const track = new St.BoxLayout({style_class: 'gnomecustom-bt-track', x_expand: true});
        const fill = new St.Widget({style_class: 'gnomecustom-bt-fill', y_expand: true});
        track.add_child(fill);
        track.connect('notify::width', () => {
            fill.width = Math.round(track.width * percentage / 100);
        });
        return track;
    }

    destroy() {
        this._onToggle = null;
        this._onClosed = null;
        super.destroy();
    }
}
