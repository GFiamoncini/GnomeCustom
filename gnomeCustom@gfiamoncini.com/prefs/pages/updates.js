// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {spinRow, enumRow, infoRow} from '../widgets.js';

export class UpdatesPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * Como nos dispositivos externos, o liga/desliga do módulo fica só na página
     * Geral: aqui ele pareceria uma opção de exibição.
     *
     * @param {object} settings Gio.Settings de `…gnomecustom.updates`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Updates'),
            icon_name: 'software-update-available-symbolic',
        });

        const check = new Adw.PreferencesGroup({title: _('Checking')});
        check.add(spinRow({
            title: _('Check every'),
            subtitle: _('In hours. The card also has a "Check now" button.'),
            settings,
            key: 'interval-hours',
            min: 1,
            max: 48,
            step: 1,
        }));
        this.add(check);

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
            title: _('Only while there is something to update'),
            subtitle: _('The button appears with the first pending update, system or Flatpak, and goes away once everything is installed.'),
        }));
        about.add(infoRow({
            title: _('GNOME Software installs'),
            subtitle: _('"Update" opens GNOME Software on the Updates page; the password, the download and the restart stay with it. Nothing is installed from the top bar.'),
        }));
        about.add(infoRow({
            title: _('Light on the network'),
            subtitle: _('The package lists are downloaded again only when they are older than the repositories allow (6 hours on Fedora).'),
        }));
        this.add(about);
    }
}
