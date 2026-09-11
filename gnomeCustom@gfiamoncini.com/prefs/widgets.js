// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Linhas de preferências reaproveitadas pelas páginas.
 *
 * Cada função devolve uma `Adw.PreferencesRow` já ligada ao GSettings, de modo
 * que as páginas fiquem sendo apenas a lista do que existe, e não o mecanismo
 * de ligação repetido dezenas de vezes.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

/**
 * Escapa texto que vai para título ou subtítulo de uma linha.
 *
 * As linhas do Adwaita interpretam marcação Pango, então um atalho como
 * `<Alt>F1` seria lido como uma etiqueta aberta e a linha apareceria vazia.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkup(text) {
    return GLib.markup_escape_text(String(text ?? ''), -1);
}

/**
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key chave booleana
 * @returns {object} Adw.SwitchRow
 */
export function switchRow({title, subtitle = '', settings, key}) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * Linha numérica para chaves `u`, `i` ou `d`.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key
 * @param {number} args.min
 * @param {number} args.max
 * @param {number} [args.step]
 * @param {number} [args.digits] 0 para inteiro
 * @returns {object} Adw.SpinRow
 */
export function spinRow({title, subtitle = '', settings, key, min, max, step = 1, digits = 0}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            page_increment: step * 10,
        }),
        digits,
    });

    // `Gio.Settings.bind` cobre inteiros e doubles; o tipo real vem do esquema.
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * Linha de escolha para chaves enum, mostrando rótulos traduzidos.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key chave enum
 * @param {Array<[string, string]>} args.options pares [nick, rótulo]
 * @returns {object} Adw.ComboRow
 */
export function enumRow({title, subtitle = '', settings, key, options}) {
    const model = new Gtk.StringList();
    for (const [, label] of options)
        model.append(label);

    const nicks = options.map(([nick]) => nick);
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model,
        selected: Math.max(0, nicks.indexOf(settings.get_string(key))),
    });

    let updating = false;
    row.connect('notify::selected', () => {
        if (updating)
            return;
        const nick = nicks[row.selected];
        if (nick && nick !== settings.get_string(key))
            settings.set_string(key, nick);
    });

    const handler = settings.connect(`changed::${key}`, () => {
        const index = nicks.indexOf(settings.get_string(key));
        if (index !== -1 && index !== row.selected) {
            updating = true;
            row.selected = index;
            updating = false;
        }
    });
    row.connect('destroy', () => settings.disconnect(handler));

    return row;
}

/**
 * Linha de escolha alimentada por uma lista de textos livre.
 *
 * Diferente de `enumRow`, a chave é uma string qualquer: serve para o nome do
 * tema de Shell, que depende do que está instalado na máquina.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key
 * @param {Array<[string, string]>} args.options pares [valor, rótulo]
 * @returns {object} Adw.ComboRow
 */
export function stringChoiceRow({title, subtitle = '', settings, key, options}) {
    return enumRow({title, subtitle, settings, key, options});
}

/**
 * Linha com selecionador de cor, gravando '#rrggbb'.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key chave string
 * @param {string} [args.fallback] cor usada quando a chave está vazia
 * @param {boolean} [args.allowEmpty] permite limpar, devolvendo o controle ao tema
 * @returns {object} Adw.ActionRow
 */
export function colorRow({title, subtitle = '', settings, key, fallback = '#000000',
    allowEmpty = false}) {
    const row = new Adw.ActionRow({title, subtitle});

    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });

    const readColor = () => {
        const rgba = new Gdk.RGBA();
        const stored = settings.get_string(key);
        if (!rgba.parse(stored || fallback))
            rgba.parse(fallback);
        return rgba;
    };

    let updating = false;
    button.set_rgba(readColor());

    button.connect('notify::rgba', () => {
        if (updating)
            return;
        const {red, green, blue} = button.get_rgba();
        const hex = rgbaToHex(red, green, blue);
        if (hex !== settings.get_string(key))
            settings.set_string(key, hex);
    });

    const handler = settings.connect(`changed::${key}`, () => {
        updating = true;
        button.set_rgba(readColor());
        updating = false;
    });
    row.connect('destroy', () => settings.disconnect(handler));

    row.add_suffix(button);
    row.activatable_widget = button;

    if (allowEmpty) {
        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: subtitle || title,
        });
        clear.connect('clicked', () => settings.set_string(key, ''));
        row.add_suffix(clear);
    }

    return row;
}

/** @returns {string} '#rrggbb' a partir de componentes 0–1 */
export function rgbaToHex(red, green, blue) {
    const part = value => Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16).padStart(2, '0');
    return `#${part(red)}${part(green)}${part(blue)}`.toUpperCase();
}

/**
 * Linha somente-leitura, para mostrar informação.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.subtitle
 * @returns {object} Adw.ActionRow
 */
export function infoRow({title, subtitle}) {
    return new Adw.ActionRow({title, subtitle});
}
