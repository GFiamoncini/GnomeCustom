// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {spinRow, enumRow, infoRow} from '../widgets.js';

export class SysmonPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * O liga/desliga do módulo fica só na página Geral, como nos outros botões
     * da barra.
     *
     * @param {object} settings Gio.Settings de `…gnomecustom.sysmon`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('System Monitor'),
            icon_name: 'utilities-system-monitor-symbolic',
        });

        const reading = new Adw.PreferencesGroup({title: _('Reading')});
        reading.add(spinRow({
            title: _('Read every'),
            subtitle: _('In seconds. The graphs keep the last 60 readings.'),
            settings,
            key: 'interval-seconds',
            min: 1,
            max: 10,
            step: 1,
        }));
        this.add(reading);

        const display = new Adw.PreferencesGroup({title: _('Display')});
        display.add(enumRow({
            title: _('Position'),
            settings,
            key: 'panel-position',
            options: [
                ['left', _('Left')],
                ['center', _('Centre')],
                ['right', _('Right')],
            ],
        }));
        this.add(display);

        const about = new Adw.PreferencesGroup({title: _('How it works')});
        about.add(infoRow({
            title: _('Processor and memory in the bar'),
            subtitle: _('The number turns amber from 75% and red from 90%. Memory counts what programs really hold, not the cache.'),
        }));
        about.add(infoRow({
            title: _('The network stays in the card'),
            subtitle: _('Download is the filled graph and upload the thin line, on the same scale.'),
        }));
        this.add(about);
    }
}
