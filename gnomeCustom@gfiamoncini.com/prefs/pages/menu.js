// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {LOGOS, logosDirectory} from '../../lib/logos.js';
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
            settings: this._settings,
            key: 'icon-source',
            options: [
                ['gallery', _('Logo gallery')],
                ['distro', _('Icon of the system theme')],
                ['symbolic', _('Generic monochrome icon')],
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
        this._addGalleryGroup();
    }

    /**
     * Galeria de logotipos (os do Logo Menu, em `assets/logos/`). Escolher um
     * logotipo também passa a origem para "galeria".
     */
    _addGalleryGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Logo gallery'),
            description: _('The same logos as the Logo Menu extension. Monochrome follows the text colour of the top bar.'),
        });

        group.add(switchRow({
            title: _('Monochrome'),
            settings: this._settings,
            key: 'gallery-monochrome',
        }));

        this._gallery = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            homogeneous: true,
            max_children_per_line: 8,
            min_children_per_line: 3,
            row_spacing: 6,
            column_spacing: 6,
            margin_top: 12,
            css_classes: ['card'],
        });
        this._galleryIds = [];
        this._fillGallery();

        this._gallery.connect('child-activated', (_box, child) => {
            const id = this._galleryIds[child.get_index()];
            if (this._settings.get_string('gallery-logo') !== id)
                this._settings.set_string('gallery-logo', id);
            if (this._settings.get_string('icon-source') !== 'gallery')
                this._settings.set_string('icon-source', 'gallery');
        });

        const handlers = [
            this._settings.connect('changed::gallery-monochrome', () => this._fillGallery()),
            this._settings.connect('changed::gallery-logo', () => this._selectCurrentLogo()),
        ];
        this._gallery.connect('destroy', () => handlers.forEach(id => this._settings.disconnect(id)));

        group.add(this._gallery);
        this.add(group);
    }

    _fillGallery() {
        const _ = this._;
        const monochrome = this._settings.get_boolean('gallery-monochrome');
        const dir = logosDirectory();

        this._gallery.remove_all();
        this._galleryIds = [];

        const entries = [
            {id: '', title: _('From the distribution'), icon: new Gio.ThemedIcon({name: 'emblem-system-symbolic'})},
            ...LOGOS.map(logo => {
                const file = (monochrome ? logo.symbolic : logo.colored) ?? logo.symbolic ?? logo.colored;
                return {id: logo.id, title: logo.title,
                    icon: new Gio.FileIcon({file: Gio.File.new_for_path(`${dir}${file}`)})};
            }),
        ];

        for (const {id, title, icon} of entries) {
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 4,
                margin_top: 8,
                margin_bottom: 8,
                tooltip_text: title,
            });
            box.append(new Gtk.Image({gicon: icon, pixel_size: 32}));
            box.append(new Gtk.Label({
                label: title,
                ellipsize: 3,   // Pango.EllipsizeMode.END
                max_width_chars: 10,
                css_classes: ['caption'],
            }));
            this._gallery.append(box);
            this._galleryIds.push(id);
        }
        this._selectCurrentLogo();
    }

    _selectCurrentLogo() {
        const index = this._galleryIds.indexOf(this._settings.get_string('gallery-logo'));
        const child = this._gallery.get_child_at_index(Math.max(0, index));
        if (child && !child.is_selected())
            this._gallery.select_child(child);
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
