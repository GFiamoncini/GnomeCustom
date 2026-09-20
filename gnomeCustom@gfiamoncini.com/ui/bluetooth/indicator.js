// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de Bluetooth da barra superior e o card com os dispositivos.
 *
 * Card no desenho do WinDock (app do próprio usuário, pedido de 2026-09-16):
 * cabeçalho com o interruptor do rádio; uma linha por dispositivo pareado, com
 * ponto verde (conectado) ou vazado (pareado), nome, bateria e o estado escrito;
 * ✕ ao passar o mouse esconde o dispositivo do card, sem despareá-lo; no rodapé,
 * as configurações de Bluetooth e, havendo escondidos, o link que os devolve.
 * As cores são as do tema do Shell, como o OSD e o menu rápido (pedido do
 * usuário, 2026-09-17).
 *
 * Na barra, o ícone de cada dispositivo conectado com a bateria; sem nenhum,
 * o ícone do Bluetooth.
 *
 * O ✕ é irmão do botão da linha, e não filho: um clique nele nunca pode chegar ao
 * botão que conecta e desconecta.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4).
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {deviceStatus, isLowBattery} from '../../lib/bluetooth.js';

const FALLBACK_ICON = 'bluetooth-active-symbolic';

export class BluetoothIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onToggle (path, connect) => void
     * @param {Function} options.onPower (powered) => void
     * @param {Function} options.onHide (address) => void
     * @param {Function} options.onShowHidden () => void
     * @param {Function} options.onSettings () => void
     */
    constructor({gettext, onToggle, onPower, onHide, onShowHidden, onSettings}) {
        super(0.5, 'GnomeCustom Bluetooth', false);

        this._ = gettext;
        this._callbacks = {onToggle, onPower, onHide, onShowHidden, onSettings};

        this._panelBox = new St.BoxLayout({style_class: 'gnomecustom-bt-panel'});
        this.add_child(this._panelBox);
        this._buildCard();
    }

    /**
     * @param {object} state
     * @param {object[]} state.devices pareados visíveis, já ordenados
     * @param {?boolean} state.powered rádio ligado; null sem adaptador
     * @param {boolean} [state.powerBusy] o rádio está mudando de estado
     * @param {number} [state.hiddenCount] dispositivos escondidos
     * @param {number} state.threshold limite de bateria baixa; 0 desliga
     * @param {Set<string>} state.pending caminhos com conexão em andamento
     */
    update({devices, powered, powerBusy = false, hiddenCount = 0, threshold, pending}) {
        const _ = this._;

        this._panelBox.destroy_all_children();
        const connected = devices.filter(device => device.connected);
        for (const device of connected)
            this._panelBox.add_child(this._panelItem(device, isLowBattery(device.battery, threshold)));
        if (connected.length === 0) {
            this._panelBox.add_child(new St.Icon({
                icon_name: powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this._switch.state = Boolean(powered);
        this._switchButton.reactive = powered !== null && !powerBusy;
        this._switchButton.opacity = this._switchButton.reactive ? 255 : 100;

        this._list.destroy_all_children();
        if (!powered) {
            this._list.add_child(this._message(powered === null
                ? _('No Bluetooth adapter')
                : _('Bluetooth is off')));
        } else if (devices.length === 0) {
            this._list.add_child(this._message(_('No paired devices')));
        } else {
            for (const device of devices) {
                this._list.add_child(this._row(device,
                    isLowBattery(device.battery, threshold), pending.has(device.path)));
            }
        }

        this._showHidden.visible = hiddenCount > 0;
        this._showHidden.label = _('Show hidden devices (%d)').replace('%d', String(hiddenCount));
    }

    _buildCard() {
        const _ = this._;
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

        // Cabeçalho: o que é, e o rádio à direita.
        const header = new St.BoxLayout({style_class: 'gnomecustom-bt-header'});
        header.add_child(new St.Icon({
            icon_name: 'bluetooth-active-symbolic',
            style_class: 'gnomecustom-bt-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: 'Bluetooth',
            style_class: 'gnomecustom-bt-heading',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._switch = new PopupMenu.Switch(false);
        this._switchButton = new St.Button({
            style_class: 'gnomecustom-bt-switch',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Turn Bluetooth on or off'),
            child: this._switch,
        });
        this._switchButton.connect('clicked', () =>
            this._callbacks.onPower?.(!this._switch.state));
        header.add_child(this._switchButton);

        this._list = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-bt-list'});

        const footer = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-bt-footer'});
        this._showHidden = this._link('', () => this._callbacks.onShowHidden?.());
        footer.add_child(this._showHidden);
        footer.add_child(this._link(_('Bluetooth settings'), () => {
            this.menu.close();
            this._callbacks.onSettings?.();
        }));

        card.add_child(header);
        card.add_child(this._list);
        card.add_child(footer);
        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    _link(text, onClick) {
        const button = new St.Button({
            label: text,
            style_class: 'gnomecustom-bt-link',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', onClick);
        return button;
    }

    _message(text) {
        return new St.Label({text, style_class: 'gnomecustom-bt-message'});
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
        const _ = this._;
        const row = new St.BoxLayout({
            style_class: 'gnomecustom-bt-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });

        const main = new St.Button({
            style_class: 'gnomecustom-bt-row-button',
            can_focus: true,
            x_expand: true,
            reactive: !busy,
        });
        const box = new St.BoxLayout({style_class: 'gnomecustom-bt-row-box', x_expand: true});

        const dot = new St.Widget({
            style_class: 'gnomecustom-bt-dot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (device.connected)
            dot.add_style_class_name('connected');
        box.add_child(dot);

        const name = new St.Label({
            text: device.name,
            style_class: 'gnomecustom-bt-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(name);

        if (device.connected && device.battery !== null) {
            const battery = new St.Label({
                text: `${device.battery}%`,
                style_class: 'gnomecustom-bt-battery',
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (low)
                battery.add_style_class_name('low');
            box.add_child(battery);
        }

        const status = deviceStatus(device, busy);
        box.add_child(new St.Label({
            text: {
                connected: _('connected'),
                paired: _('paired'),
                connecting: _('connecting…'),
                disconnecting: _('disconnecting…'),
            }[status],
            style_class: `gnomecustom-bt-status ${status}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        main.set_child(box);
        main.connect('clicked', () => this._callbacks.onToggle?.(device.path, !device.connected));

        const hide = new St.Button({
            style_class: 'gnomecustom-bt-hide',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
            accessible_name: _('Hide this device from the card'),
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
        });
        hide.connect('clicked', () => this._callbacks.onHide?.(device.address));
        const syncHide = () => {
            hide.opacity = row.hover || hide.has_key_focus() ? 255 : 0;
        };
        row.connect('notify::hover', syncHide);
        hide.connect('key-focus-in', syncHide);
        hide.connect('key-focus-out', syncHide);

        row.add_child(main);
        row.add_child(hide);
        return row;
    }

    destroy() {
        this._callbacks = {};
        super.destroy();
    }
}
