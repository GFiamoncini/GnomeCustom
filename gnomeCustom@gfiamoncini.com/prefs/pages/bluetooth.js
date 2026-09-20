// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {spinRow, enumRow, switchRow} from '../widgets.js';

export class BluetoothPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.bluetooth`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Bluetooth'),
            icon_name: 'bluetooth-active-symbolic',
        });

        const panel = new Adw.PreferencesGroup({
            title: _('Top bar'),
            description: _('Each connected device appears with its battery. The card lists paired devices and turns the radio on or off; clicking a device connects or disconnects it, and the ✕ hides it from the card.'),
        });
        panel.add(enumRow({
            title: _('Position'),
            settings,
            key: 'panel-position',
            options: [
                ['left', _('Left')],
                ['center', _('Centre')],
                ['right', _('Right')],
            ],
        }));
        panel.add(switchRow({
            title: _('Hide when nothing is connected'),
            subtitle: _('When off, the Bluetooth icon stays in the top bar'),
            settings,
            key: 'hide-when-disconnected',
        }));
        this.add(panel);

        const battery = new Adw.PreferencesGroup({title: _('Battery')});
        battery.add(spinRow({
            title: _('Low battery at or below'),
            subtitle: _('In percent; the device turns red. 0 turns the warning off'),
            settings,
            key: 'low-battery-threshold',
            min: 0,
            max: 100,
            step: 5,
        }));
        this.add(battery);
    }
}
