// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {switchRow, spinRow, enumRow} from '../widgets.js';

export class MenuPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.menu`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Logo Menu'),
            icon_name: 'start-here-symbolic',
        });

        this._settings = settings;
        this._ = _;

        this._addAppearanceGroup();
        this._addItemsGroup();
        this._addApplicationsGroup();
    }

    _addAppearanceGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Appearance')});

        group.add(enumRow({
            title: _('Logo'),
            subtitle: _('The distribution logo comes from the system itself, so no images are bundled'),
            settings: this._settings,
            key: 'icon-source',
            options: [
                ['distro', _('Distribution logo')],
                ['symbolic', _('Monochrome icon')],
                ['custom', _('Custom image')],
            ],
        }));
        group.add(spinRow({
            title: _('Size'),
            subtitle: _('In pixels'),
            settings: this._settings,
            key: 'icon-size',
            min: 8,
            max: 48,
        }));
        group.add(this._customIconRow());

        this.add(group);
    }

    _customIconRow() {
        const _ = this._;
        const row = new Adw.EntryRow({
            title: _('Custom image path'),
            text: this._settings.get_string('custom-icon-path'),
            show_apply_button: true,
        });

        row.connect('apply', () =>
            this._settings.set_string('custom-icon-path', row.text.trim()));

        const handler = this._settings.connect('changed::custom-icon-path', () => {
            const value = this._settings.get_string('custom-icon-path');
            if (value !== row.text)
                row.text = value;
        });
        row.connect('destroy', () => this._settings.disconnect(handler));

        const browse = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        browse.connect('clicked', () => this._chooseIcon(row));
        row.add_suffix(browse);

        return row;
    }

    _chooseIcon(row) {
        const filter = new Gtk.FileFilter({name: this._('Images')});
        filter.add_pixbuf_formats();

        const dialog = new Gtk.FileDialog({
            title: this._('Choose a logo image'),
            modal: true,
            default_filter: filter,
        });

        dialog.open(this.get_root(), null, (source, result) => {
            try {
                const file = source.open_finish(result);
                const path = file?.get_path();
                if (path) {
                    this._settings.set_string('custom-icon-path', path);
                    row.text = path;
                }
            } catch {
                // O usuário cancelou: nada a fazer.
            }
        });
    }

    _addItemsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Menu items'),
            description: _('Turn off what you do not use; separators adjust on their own.'),
        });

        const items = [
            ['show-system-details', _('About This System')],
            ['show-app-grid', _('Applications')],
            ['show-activities-item', _('Activities')],
            ['show-software', _('Software')],
            ['show-monitor', _('System Monitor')],
            ['show-terminal', _('Terminal')],
            ['show-extensions', _('Extensions')],
            ['show-settings', _('Settings')],
            ['show-force-quit', _('Force Quit a Window')],
            ['show-lock', _('Lock Screen')],
            ['show-power', _('Suspend, Restart and Power Off')],
        ];

        for (const [key, title] of items)
            group.add(switchRow({title, settings: this._settings, key}));

        this.add(group);
    }

    _addApplicationsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Applications opened by the menu'),
            description: _('Desktop file identifiers. Leave empty to use the system default.'),
        });

        const entries = [
            ['software-app', _('Software centre')],
            ['monitor-app', _('System monitor')],
            ['terminal-app', _('Terminal')],
            ['extensions-app', _('Extensions manager')],
        ];

        for (const [key, title] of entries)
            group.add(this._appRow(key, title));

        this.add(group);
    }

    _appRow(key, title) {
        const row = new Adw.EntryRow({
            title,
            text: this._settings.get_string(key),
            show_apply_button: true,
        });

        row.connect('apply', () => this._settings.set_string(key, row.text.trim()));

        const handler = this._settings.connect(`changed::${key}`, () => {
            const value = this._settings.get_string(key);
            if (value !== row.text)
                row.text = value;
        });
        row.connect('destroy', () => this._settings.disconnect(handler));

        // `Gio.DesktopAppInfo` foi movido para a biblioteca específica de
        // plataforma; usar o nome antigo funciona, mas emite aviso de obsoleto.
        const installed = this._settings.get_string(key);
        if (installed && !GioUnix.DesktopAppInfo.new(installed)) {
            row.add_css_class('warning');
            row.tooltip_text = this._('This application is not installed');
        }

        return row;
    }
}
