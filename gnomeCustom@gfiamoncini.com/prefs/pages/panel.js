// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {MODULES_INFO} from '../../lib/modules-info.js';
import {moveItem, normalizeOrder} from '../../lib/panel-order.js';
import {switchRow, spinRow, enumRow, infoRow, escapeMarkup} from '../widgets.js';

const ORDER_KEY = 'button-order';

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

        const keyboard = new Adw.PreferencesGroup({title: _('Keyboard layout')});
        keyboard.add(switchRow({
            title: _('Capital letters'),
            subtitle: _('“BR” instead of “br” in the layout indicator of the top bar'),
            settings,
            key: 'keyboard-uppercase',
        }));
        this.add(keyboard);
        this.add(this._buildOrderGroup(settings, _));
    }

    /**
     * Uma linha por botão nosso, na ordem da barra, com setas para trocar de
     * lugar. As linhas são refeitas a cada mudança da chave, venha de onde vier.
     */
    _buildOrderGroup(settings, _) {
        const group = new Adw.PreferencesGroup({
            title: _('Order of the buttons'),
            description: _('From left to right, among the buttons that share a section of the bar. ' +
                'The section is chosen on the page of each one.'),
        });
        const titles = new Map(MODULES_INFO.map(info => [info.id, info.title]));

        let rows = [];
        const rebuild = () => {
            for (const row of rows)
                group.remove(row);
            const order = normalizeOrder(settings.get_strv(ORDER_KEY));
            rows = order.map((id, index) => {
                const row = new Adw.ActionRow({title: _(titles.get(id) ?? id)});
                const arrow = (iconName, tooltip, delta, sensitive) => {
                    const button = new Gtk.Button({
                        icon_name: iconName,
                        tooltip_text: tooltip,
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat'],
                        sensitive,
                    });
                    button.connect('clicked', () =>
                        settings.set_strv(ORDER_KEY, moveItem(order, id, delta)));
                    row.add_suffix(button);
                };
                arrow('go-up-symbolic', _('Move to the left'), -1, index > 0);
                arrow('go-down-symbolic', _('Move to the right'), 1, index < order.length - 1);
                group.add(row);
                return row;
            });
        };
        rebuild();

        const id = settings.connect(`changed::${ORDER_KEY}`, rebuild);
        this.connect('destroy', () => settings.disconnect(id));

        const reset = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.reset(ORDER_KEY));
        group.set_header_suffix(reset);
        return group;
    }
}
