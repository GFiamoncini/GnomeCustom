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

import {SYSTEM_KEYBINDING_SCHEMAS, acceptShortcut, findCollisions, isModifierKeyName} from '../lib/shortcuts.js';

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
 * Opacidade de 0 a 100 %, gravada como fração (chave `d` de 0 a 1), como a
 * opacidade do Dash to Dock.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key chave `d` de 0 a 1
 * @returns {object} Adw.SpinRow
 */
export function percentRow({title, subtitle = '', settings, key}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5, page_increment: 10}),
        digits: 0,
    });

    const toPercent = () => Math.round(settings.get_double(key) * 100);
    let updating = false;
    row.value = toPercent();
    row.connect('notify::value', () => {
        if (updating)
            return;
        const fraction = Math.round(row.value) / 100;
        if (Math.abs(fraction - settings.get_double(key)) > 1e-9)
            settings.set_double(key, fraction);
    });
    const handler = settings.connect(`changed::${key}`, () => {
        updating = true;
        row.value = toPercent();
        updating = false;
    });
    row.connect('destroy', () => settings.disconnect(handler));
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

/**
 * Atalhos do sistema (e de outros esquemas `as` pedidos), para o aviso de
 * colisão do editor. Esquemas que não existem na máquina são ignorados.
 *
 * @param {Array<{schema?: string, settings?: object}>} [extra] nossos outros esquemas
 * @returns {Array<{schema: string, key: string, accels: string[]}>}
 */
export function readKeybindings(extra = []) {
    const source = Gio.SettingsSchemaSource.get_default();
    const sources = SYSTEM_KEYBINDING_SCHEMAS
        .map(id => source?.lookup(id, true))
        .filter(Boolean)
        .map(schema => ({schema: schema.get_id(), settings: new Gio.Settings({settings_schema: schema})}));

    const bindings = [];
    for (const {schema, settings} of [...sources, ...extra]) {
        const settingsSchema = settings.settings_schema;
        for (const key of settingsSchema.list_keys()) {
            if (settingsSchema.get_key(key).get_value_type().dup_string() === 'as')
                bindings.push({schema: schema ?? settingsSchema.get_id(), key, accels: settings.get_strv(key)});
        }
    }
    return bindings;
}

/**
 * O que fazer com uma tecla apertada durante a captura de um atalho.
 *
 * @param {number} keyval
 * @param {number} keycode
 * @param {number} state Gdk.ModifierType
 * @returns {{action: 'cancel'|'clear'|'wait'|'invalid'|'set', accel?: string}}
 */
export function captureAccel(keyval, keycode, state) {
    const mask = state & Gtk.accelerator_get_default_mod_mask();
    const lower = Gdk.keyval_to_lower(keyval);
    const keyName = Gdk.keyval_name(lower) ?? '';

    if (mask === 0 && lower === Gdk.KEY_Escape)
        return {action: 'cancel'};
    if (mask === 0 && lower === Gdk.KEY_BackSpace)
        return {action: 'clear'};
    if (isModifierKeyName(keyName))
        return {action: 'wait'};

    const hasModifier = (mask & ~Gdk.ModifierType.SHIFT_MASK) !== 0;
    if (!acceptShortcut(keyName, hasModifier))
        return {action: 'invalid'};

    return {action: 'set', accel: Gtk.accelerator_name_with_keycode(null, lower, keycode, mask)};
}

/**
 * Linha de atalho editável, ligada a uma chave `as`: mostra a combinação, abre
 * a captura no clique e oferece limpar e voltar ao padrão. Quando a combinação
 * também é usada em outro lugar, o subtítulo avisa.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.subtitle]
 * @param {object} args.settings
 * @param {string} args.key chave `as`
 * @param {Function} args._ tradução
 * @param {Function} [args.others] devolve os atalhos a conferir (ver `readKeybindings`)
 * @returns {object} Adw.ActionRow
 */
export function shortcutRow({title, subtitle = '', settings, key, _, others = () => []}) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true});

    const label = new Gtk.ShortcutLabel({
        disabled_text: _('Disabled'),
        valign: Gtk.Align.CENTER,
    });
    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: _('Restore default'),
    });
    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: _('Disable shortcut'),
    });
    reset.connect('clicked', () => settings.reset(key));
    clear.connect('clicked', () => settings.set_strv(key, []));

    row.add_suffix(label);
    row.add_suffix(reset);
    row.add_suffix(clear);

    const sync = () => {
        const accels = settings.get_strv(key).filter(Boolean);
        label.accelerator = accels[0] ?? '';
        clear.sensitive = accels.length > 0;
        reset.sensitive = settings.get_user_value(key) !== null;

        const collision = findCollisions([{key, accels}],
            others().filter(binding => binding.key !== key))[0];
        row.subtitle = collision
            ? escapeMarkup(_('Also used by “%s” (%s)').replace('%s', collision.theirs).replace('%s', collision.schema))
            : subtitle;
        if (collision)
            row.add_css_class('warning');
        else
            row.remove_css_class('warning');
    };

    const handler = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(handler));
    row.connect('activated', () => openShortcutDialog(row, title, settings, key, _));
    sync();

    return row;
}

function openShortcutDialog(parent, title, settings, key, _) {
    const hint = _('Press the new shortcut. Esc cancels, Backspace disables.');
    const dialog = new Adw.AlertDialog({heading: title, body: hint});
    dialog.add_response('cancel', _('Cancel'));

    const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const result = captureAccel(keyval, keycode, state);
        switch (result.action) {
        case 'wait':
            return true;
        case 'invalid':
            dialog.body = _('Use Ctrl, Alt or Super with the key (function and media keys work alone).');
            return true;
        case 'clear':
            settings.set_strv(key, []);
            break;
        case 'set':
            settings.set_strv(key, [result.accel]);
            break;
        }
        dialog.close();
        return true;
    });
    dialog.add_controller(controller);
    dialog.present(parent);
}
