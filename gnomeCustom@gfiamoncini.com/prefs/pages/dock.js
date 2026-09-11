// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {spinRow} from '../widgets.js';

export class DockPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.dock`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Dock'),
            icon_name: 'user-bookmarks-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Dock'),
            description: _('Always at the bottom of the primary monitor, with favourites and open applications. Maximised windows stop above it.'),
        });

        group.add(spinRow({
            title: _('Maximum icon size'),
            subtitle: _('In pixels; icons shrink when there are too many to fit'),
            settings,
            key: 'icon-size',
            min: 16,
            max: 64,
        }));
        group.add(spinRow({
            title: _('Maximum length'),
            subtitle: _('Fraction of the monitor width'),
            settings,
            key: 'length-fraction',
            min: 0.2,
            max: 1,
            step: 0.05,
            digits: 2,
        }));
        group.add(spinRow({
            title: _('Background opacity'),
            subtitle: _('0 is fully transparent'),
            settings,
            key: 'background-opacity',
            min: 0,
            max: 1,
            step: 0.05,
            digits: 2,
        }));

        this.add(group);
    }
}
