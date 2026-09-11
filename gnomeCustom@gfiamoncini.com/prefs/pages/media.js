// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {MPRIS_PREFIX, playerIdFromBusName, toggleAllowed} from '../../lib/mpris.js';
import {switchRow, spinRow, enumRow, escapeMarkup} from '../widgets.js';

export class MediaPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.media`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Media'),
            icon_name: 'audio-x-generic-symbolic',
        });

        this._settings = settings;
        this._ = _;
        this._playerRows = new Map();   // id -> Adw.SwitchRow
        this._destroyed = false;

        this._addPlayersGroup();
        this._addPanelGroup();
        this._addCardGroup();

        this.connect('destroy', () => {
            this._destroyed = true;
            if (this._allowedHandler) {
                this._settings.disconnect(this._allowedHandler);
                this._allowedHandler = null;
            }
        });
    }

    _addPlayersGroup() {
        const _ = this._;
        this._playersGroup = new Adw.PreferencesGroup({
            title: _('Players'),
            description: _('Only the applications turned on here appear in the top bar. Players open right now are listed automatically; when several play at once, the first one turned on wins.'),
        });

        for (const id of this._settings.get_strv('allowed-players'))
            this._ensurePlayerRow(id, null);

        this._allowedHandler = this._settings.connect('changed::allowed-players',
            () => this._syncPlayerRows());

        this._discoverPlayers();
        this.add(this._playersGroup);
    }

    /**
     * Uma linha por player; a mesma linha é reaproveitada quando o nome amigável
     * chega depois.
     */
    _ensurePlayerRow(id, identity) {
        let row = this._playerRows.get(id);
        if (row) {
            if (identity)
                row.title = escapeMarkup(identity);
            return row;
        }

        row = new Adw.SwitchRow({
            title: escapeMarkup(identity ?? id),
            subtitle: escapeMarkup(id),
            active: this._settings.get_strv('allowed-players').includes(id),
        });
        row.connect('notify::active', () => {
            const current = this._settings.get_strv('allowed-players');
            const next = toggleAllowed(current, id, row.active);
            if (next.join('\n') !== current.join('\n'))
                this._settings.set_strv('allowed-players', next);
        });

        this._playerRows.set(id, row);
        this._playersGroup.add(row);
        return row;
    }

    _syncPlayerRows() {
        const allowed = this._settings.get_strv('allowed-players');
        for (const id of allowed)
            this._ensurePlayerRow(id, null);
        for (const [id, row] of this._playerRows) {
            const active = allowed.includes(id);
            if (row.active !== active)
                row.active = active;
        }
    }

    /** Lista os players abertos agora, com o nome que cada um declara. */
    _discoverPlayers() {
        const bus = Gio.DBus.session;
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                let names;
                try {
                    [names] = connection.call_finish(result).deepUnpack();
                } catch {
                    return;   // Sem barramento: ficam só os players já salvos.
                }

                for (const name of names) {
                    const id = name.startsWith(MPRIS_PREFIX) ? playerIdFromBusName(name) : null;
                    if (id)
                        this._fetchIdentity(bus, name, id);
                }
            });
    }

    _fetchIdentity(bus, name, id) {
        bus.call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'Identity']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NO_AUTO_START, 2000, null,
            (connection, result) => {
                let identity = null;
                try {
                    identity = connection.call_finish(result).recursiveUnpack()[0];
                } catch {
                    // Player sem Identity: a linha mostra o id.
                }
                if (!this._destroyed)
                    this._ensurePlayerRow(id, identity);
            });
    }

    _addPanelGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Top bar')});

        group.add(enumRow({
            title: _('Position'),
            settings: this._settings,
            key: 'panel-position',
            options: [
                ['left', _('Left')],
                ['center', _('Centre')],
                ['right', _('Right')],
            ],
        }));
        group.add(spinRow({
            title: _('Maximum width of the track name'),
            subtitle: _('In pixels; longer names end with an ellipsis'),
            settings: this._settings,
            key: 'panel-max-width',
            min: 80,
            max: 600,
            step: 10,
        }));

        this.add(group);
    }

    _addCardGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Card'),
            description: _('Opens with a click on the track name. It shows the cover, the track and the artist, without playback controls.'),
        });

        group.add(switchRow({
            title: _('Show elapsed time'),
            settings: this._settings,
            key: 'show-progress',
        }));
        group.add(switchRow({
            title: _('Background from the album cover'),
            subtitle: _('When off, the card follows the shell theme'),
            settings: this._settings,
            key: 'ambient-background',
        }));

        this.add(group);
    }
}
