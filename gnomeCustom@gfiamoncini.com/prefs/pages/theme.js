// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {listThemes} from '../../lib/shell-themes.js';
import {switchRow, spinRow, enumRow, colorRow, stringChoiceRow} from '../widgets.js';

export class ThemePage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.theme`
     * @param {Function} _ função de tradução
     */
    constructor(settings, _) {
        super({
            title: _('Theme'),
            icon_name: 'applications-graphics-symbolic',
        });

        this._settings = settings;
        this._ = _;

        this._addShapeGroup();
        this._addColorGroup();
        this._addShellThemeGroup();
    }

    _addShapeGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Top bar'),
            description: _('Shape and position of the top bar. “None” leaves the shell theme in charge.'),
        });

        group.add(enumRow({
            title: _('Style'),
            settings: this._settings,
            key: 'panel-style',
            options: [
                ['none', _('None')],
                ['attached', _('Attached to the edge')],
                ['floating', _('Floating')],
            ],
        }));
        group.add(spinRow({
            title: _('Height'),
            subtitle: _('In pixels'),
            settings: this._settings,
            key: 'panel-height',
            min: 16,
            max: 96,
        }));
        group.add(spinRow({
            title: _('Corner radius'),
            settings: this._settings,
            key: 'panel-radius',
            min: 0,
            max: 50,
            step: 0.5,
            digits: 1,
        }));
        group.add(spinRow({
            title: _('Border thickness'),
            settings: this._settings,
            key: 'panel-border-width',
            min: 0,
            max: 10,
            step: 0.5,
            digits: 1,
        }));
        group.add(spinRow({
            title: _('Space above'),
            settings: this._settings,
            key: 'panel-margin-top',
            min: 0,
            max: 40,
            step: 0.1,
            digits: 1,
        }));
        group.add(spinRow({
            title: _('Space below'),
            settings: this._settings,
            key: 'panel-margin-bottom',
            min: 0,
            max: 40,
            step: 0.1,
            digits: 1,
        }));
        group.add(spinRow({
            title: _('Space at the sides'),
            settings: this._settings,
            key: 'panel-margin-sides',
            min: 0,
            max: 200,
            step: 0.5,
            digits: 1,
        }));
        group.add(switchRow({
            title: _('Full-height panel buttons'),
            subtitle: _('Removes the padding above and below buttons so they fill the bar'),
            settings: this._settings,
            key: 'fitts-widgets',
        }));

        this.add(group);
    }

    _addColorGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Colours'),
            description: _('With the wallpaper palette on, the bar takes its background from the desktop background. Setting a background colour below overrides it.'),
        });

        group.add(switchRow({
            title: _('Take colours from the wallpaper'),
            settings: this._settings,
            key: 'palette-from-wallpaper',
        }));
        group.add(spinRow({
            title: _('Palette colour to use'),
            subtitle: _('0 is the most frequent colour of the wallpaper'),
            settings: this._settings,
            key: 'palette-slot',
            min: 0,
            max: 11,
        }));
        group.add(spinRow({
            title: _('Background opacity'),
            settings: this._settings,
            key: 'panel-background-alpha',
            min: 0,
            max: 1,
            step: 0.05,
            digits: 2,
        }));
        group.add(spinRow({
            title: _('Border opacity'),
            settings: this._settings,
            key: 'panel-border-alpha',
            min: 0,
            max: 1,
            step: 0.05,
            digits: 2,
        }));
        group.add(colorRow({
            title: _('Accent colour'),
            subtitle: _('Highlights and open menus'),
            settings: this._settings,
            key: 'accent-color',
            fallback: '#1C71D8',
        }));
        group.add(colorRow({
            title: _('Background colour'),
            subtitle: _('Clear to go back to the wallpaper palette'),
            settings: this._settings,
            key: 'background-color',
            fallback: '#000000',
            allowEmpty: true,
        }));
        group.add(colorRow({
            title: _('Text colour'),
            subtitle: _('Clear to pick automatically for contrast'),
            settings: this._settings,
            key: 'foreground-color',
            fallback: '#FFFFFF',
            allowEmpty: true,
        }));

        this._paletteGroup = new Adw.PreferencesGroup({
            title: _('Current wallpaper palette'),
            description: _('Extracted automatically, most frequent colour first.'),
        });
        this._syncPalette();
        this._paletteHandler = this._settings.connect('changed::palette',
            () => this._syncPalette());
        this.connect('destroy', () => {
            if (this._paletteHandler) {
                this._settings.disconnect(this._paletteHandler);
                this._paletteHandler = null;
            }
        });

        this.add(group);
        this.add(this._paletteGroup);
    }

    _syncPalette() {
        const _ = this._;
        for (const row of [...this._paletteRows ?? []])
            this._paletteGroup.remove(row);
        this._paletteRows = [];

        const palette = this._settings.get_strv('palette');
        if (palette.length === 0) {
            const row = new Adw.ActionRow({
                title: _('No palette yet'),
                subtitle: _('It is extracted when the Theme module is enabled'),
            });
            this._paletteGroup.add(row);
            this._paletteRows.push(row);
            return;
        }

        palette.forEach((color, index) => {
            const row = new Adw.ActionRow({
                title: color,
                subtitle: index === 0 ? _('most frequent') : '',
            });
            this._paletteGroup.add(row);
            this._paletteRows.push(row);
        });
    }

    _addShellThemeGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Shell theme'),
            description: _('Loads a theme from ~/.themes, the job the User Themes extension does. The generated bar style is applied on top of it.'),
        });

        // A lista vem do disco: monta a linha assim que ela chegar.
        listThemes()
            .then(names => {
                const options = [['', _('Default GNOME theme')],
                    ...names.map(name => [name, name])];
                const current = this._settings.get_string('shell-theme');
                if (current && !names.includes(current))
                    options.push([current, `${current} ${_('(not installed)')}`]);

                group.add(stringChoiceRow({
                    title: _('Theme'),
                    settings: this._settings,
                    key: 'shell-theme',
                    options,
                }));
            })
            .catch(() => {
                group.add(new Adw.ActionRow({
                    title: _('Could not list installed themes'),
                }));
            });

        this.add(group);
    }
}
