// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {switchRow, enumRow, infoRow} from '../widgets.js';

export class RemovablePage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * O liga/desliga do módulo fica só na página Geral: aqui ele parecia uma
     * opção de exibição, e desligá-lo escondia o ícone até com o pen-drive
     * conectado (relato do usuário em 2026-09-28).
     *
     * @param {object} settings Gio.Settings de `…gnomecustom.removable`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Removable Devices'),
            icon_name: 'media-removable-symbolic',
        });

        const display = new Adw.PreferencesGroup({title: _('Display')});
        display.add(switchRow({
            title: _('Only while something is connected'),
            subtitle: _('The button appears with the first device and goes away with the last one'),
            settings,
            key: 'hide-when-empty',
        }));
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
            title: _('One line per device'),
            subtitle: _('An external drive with two partitions shows up once, with both next to it: the whole device is what leaves the computer. Internal disks never show up.'),
        }));
        about.add(infoRow({
            title: _('Removal is asked, never forced'),
            subtitle: _('The same path as the Files app. If a program still uses the device, GNOME says which one and lets you decide.'),
        }));
        this.add(about);
    }
}
