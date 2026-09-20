// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {switchRow, spinRow, enumRow, infoRow, escapeMarkup} from '../widgets.js';

export class PanelPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.panel`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Panel'),
            icon_name: 'view-continuous-symbolic',
        });

        const group = new Adw.PreferencesGroup({title: _('Applications menu')});

        group.add(switchRow({
            title: _('Show the applications menu'),
            subtitle: _('Applications by category, from the button in the top bar'),
            settings,
            key: 'apps-menu',
        }));
        group.add(enumRow({
            title: _('Layout'),
            settings,
            key: 'apps-menu-layout',
            options: [
                ['accordion', _('One column, collapsed categories')],
                ['columns', _('Categories on the left, applications on the right')],
            ],
        }));
        group.add(spinRow({
            title: _('Icon size'),
            settings,
            key: 'apps-menu-icon-size',
            min: 16,
            max: 64,
        }));
        group.add(infoRow({
            title: _('Keyboard shortcut'),
            subtitle: escapeMarkup(
                settings.get_strv('apps-menu-shortcut').join(', ')) || _('none'),
        }));

        this.add(group);

        const activities = new Adw.PreferencesGroup({title: _('Activities')});
        activities.add(switchRow({
            title: _('Show the Activities button'),
            subtitle: _('The logo menu can open the overview instead'),
            settings,
            key: 'show-activities',
        }));
        this.add(activities);
    }
}
