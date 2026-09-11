// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {switchRow} from '../widgets.js';

export class OverviewPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.overview`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Overview'),
            icon_name: 'view-grid-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Overview'),
            description: _('Adjustments to the Activities overview. Each one can be turned off on its own.'),
        });

        group.add(switchRow({
            title: _('Always show workspace thumbnails'),
            subtitle: _('Even with a single workspace'),
            settings,
            key: 'always-show-thumbnails',
        }));
        group.add(switchRow({
            title: _('Wallpaper behind the thumbnails'),
            subtitle: _('Instead of a plain grey background'),
            settings,
            key: 'thumbnails-background',
        }));
        group.add(switchRow({
            title: _('Hide the search entry until typing'),
            subtitle: _('It appears as soon as you start typing'),
            settings,
            key: 'hide-search',
        }));
        group.add(switchRow({
            title: _('Show Firefox picture-in-picture windows'),
            subtitle: _('GNOME leaves them out of the overview'),
            settings,
            key: 'show-firefox-pip',
        }));

        this.add(group);
    }
}
