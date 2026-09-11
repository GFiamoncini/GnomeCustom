// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {describeSpeedFactor, MAX_SPEED_FACTOR, MIN_SPEED_FACTOR} from '../../lib/animation.js';
import {spinRow} from '../widgets.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';

export class AnimationPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.animation`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Animation'),
            icon_name: 'media-playback-start-symbolic',
        });

        this._settings = settings;
        this._ = _;
        this._handlers = [];

        const group = new Adw.PreferencesGroup({
            title: _('Animation speed'),
            description: _('Values below 1 make the Shell animations faster; above 1, slower.'),
        });

        this.warningRow = new Adw.ActionRow({
            title: _('Animations are turned off in the system'),
            subtitle: _('The speed only affects the few animations GNOME always shows. Animations can be turned on in the Accessibility settings.'),
        });
        this.warningRow.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
        this.warningRow.add_css_class('warning');
        group.add(this.warningRow);

        this.speedRow = spinRow({
            title: _('Speed factor'),
            settings,
            key: 'speed-factor',
            min: MIN_SPEED_FACTOR,
            max: MAX_SPEED_FACTOR,
            step: 0.05,
            digits: 2,
        });
        group.add(this.speedRow);
        this.add(group);

        this._track(settings, 'changed::speed-factor', () => this._syncSpeedLabel());
        this._syncSpeedLabel();

        // O esquema do GNOME existe em qualquer sessão; a proteção cobre ambientes mínimos.
        try {
            this._interface = new Gio.Settings({schema_id: INTERFACE_SCHEMA});
            this._track(this._interface, 'changed::enable-animations', () => this._syncWarning());
        } catch {
            this._interface = null;
        }
        this._syncWarning();

        this.connect('destroy', () => {
            for (const [object, id] of this._handlers)
                object.disconnect(id);
            this._handlers = [];
        });
    }

    _track(object, signal, callback) {
        this._handlers.push([object, object.connect(signal, callback)]);
    }

    _syncSpeedLabel() {
        const _ = this._;
        const {kind, ratio} = describeSpeedFactor(this._settings.get_double('speed-factor'));
        const times = String(ratio);
        this.speedRow.subtitle = {
            faster: _('%s× faster').replace('%s', times),
            slower: _('%s× slower').replace('%s', times),
            normal: _('Normal speed'),
        }[kind];
    }

    _syncWarning() {
        this.warningRow.visible = this._interface !== null &&
            !this._interface.get_boolean('enable-animations');
    }
}
