// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {TILING_ACTIONS} from '../../lib/tiling/actions.js';
import {parseRules, serializeRules} from '../../lib/tiling/rules.js';
import {switchRow, spinRow, escapeMarkup, shortcutRow, readKeybindings} from '../widgets.js';

export class TilingPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.tiling`
     * @param {object} bindings Gio.Settings de `…gnomecustom.tiling.keybindings`
     * @param {Function} _ função de tradução
     */
    constructor(settings, bindings, _) {
        super({
            title: _('Tiling'),
            icon_name: 'view-grid-symbolic',
        });

        this._settings = settings;
        this._bindings = bindings;
        this._ = _;

        this._addBehaviourGroup();
        this._addGapsGroup();
        this._addRulesGroup();
        this._addWorkspacesGroup();
        this._addShortcutsGroup();
    }

    _addBehaviourGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Behaviour'),
            description: _('Arranges windows side by side automatically. While the Forge extension is active, this module waits and does nothing.'),
        });

        const rows = [
            ['tiling-mode', _('Tile windows'), _('Also toggled from quick settings and with Shift+Super+P')],
            ['auto-split', _('Split automatically'), _('A new window splits the focused one along its longer side')],
            ['drag-swap', _('Swap windows by dragging'), _('Drop a window over another to swap them')],
            ['float-always-on-top', _('Keep floating windows on top'), ''],
            ['focus-border', _('Border around the focused window'), _('Colour and thickness are set on the Theme page')],
            ['quick-settings-toggle', _('Switch in quick settings'), ''],
        ];
        for (const [key, title, subtitle] of rows)
            group.add(switchRow({title, subtitle, settings: this._settings, key}));

        group.add(spinRow({
            title: _('Resize step'),
            subtitle: _('Pixels moved by each resize shortcut'),
            settings: this._settings,
            key: 'resize-amount',
            min: 1,
            max: 200,
        }));

        this.add(group);
    }

    _addGapsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Gaps'),
            description: _('Windows end up 2 × size × step apart, and the same distance from the screen edges.'),
        });

        group.add(spinRow({title: _('Size'), settings: this._settings, key: 'gap-size', min: 0, max: 32}));
        group.add(spinRow({
            title: _('Step'),
            subtitle: _('Changed by Ctrl+Super+Plus and Ctrl+Super+Minus'),
            settings: this._settings,
            key: 'gap-increment',
            min: 0,
            max: 8,
        }));
        group.add(switchRow({
            title: _('No gaps around a single window'),
            settings: this._settings,
            key: 'gap-hidden-on-single',
        }));

        this.add(group);
    }

    /**
     * Regras de janela: lista com remoção e uma linha para acrescentar.
     *
     * Só classe e título: regras por id de janela não existem neste projeto, e
     * as que vierem de um windows.json antigo são descartadas na leitura.
     */
    _addRulesGroup() {
        const _ = this._;
        this._rulesGroup = new Adw.PreferencesGroup({
            title: _('Windows that always float'),
            description: _('Matched by application class and, optionally, by text in the title. Separate several titles with commas; start one with “!” to match titles that do not contain it.'),
        });
        this._ruleRows = [];

        const classRow = new Adw.EntryRow({title: _('Application class, e.g. org.gnome.Calculator')});
        const titleRow = new Adw.EntryRow({title: _('Title contains (optional)')});
        const addButton = new Gtk.Button({
            label: _('Add rule'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        addButton.connect('clicked', () => {
            const wmClass = classRow.text.trim();
            if (!wmClass)
                return;
            const rule = {wmClass, mode: 'float'};
            if (titleRow.text.trim())
                rule.wmTitle = titleRow.text.trim();
            this._writeRules([...this._readRules(), rule]);
            classRow.text = '';
            titleRow.text = '';
        });
        titleRow.add_suffix(addButton);

        this._rulesGroup.add(classRow);
        this._rulesGroup.add(titleRow);

        const handler = this._settings.connect('changed::window-rules', () => this._syncRules());
        this._rulesGroup.connect('destroy', () => this._settings.disconnect(handler));
        this._syncRules();

        this.add(this._rulesGroup);
    }

    _readRules() {
        return parseRules(this._settings.get_string('window-rules')).rules;
    }

    _writeRules(rules) {
        this._settings.set_string('window-rules', serializeRules(rules));
    }

    _syncRules() {
        const _ = this._;
        for (const row of this._ruleRows)
            this._rulesGroup.remove(row);
        this._ruleRows = [];

        const rules = this._readRules();
        rules.forEach((rule, index) => {
            const row = new Adw.ActionRow({
                title: escapeMarkup(rule.wmClass),
                subtitle: rule.wmTitle
                    ? escapeMarkup(`${_('title')}: ${rule.wmTitle}`)
                    : _('whole application'),
            });
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: _('Remove rule'),
            });
            remove.connect('clicked', () =>
                this._writeRules(rules.filter((_rule, i) => i !== index)));
            row.add_suffix(remove);
            this._rulesGroup.add(row);
            this._ruleRows.push(row);
        });
    }

    _addWorkspacesGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Workspaces without tiling')});
        const row = new Adw.ActionRow({title: _('Workspaces')});
        const reset = new Gtk.Button({
            label: _('Tile everywhere'),
            valign: Gtk.Align.CENTER,
        });
        reset.connect('clicked', () =>
            this._settings.set_value('skip-workspaces', new GLib.Variant('ai', [])));
        row.add_suffix(reset);

        const sync = () => {
            const skipped = this._settings.get_value('skip-workspaces').deepUnpack();
            row.subtitle = skipped.length
                ? skipped.map(index => index + 1).join(', ')
                : _('none — toggle the current one with Shift+Super+W');
            reset.sensitive = skipped.length > 0;
        };
        const handler = this._settings.connect('changed::skip-workspaces', sync);
        row.connect('destroy', () => this._settings.disconnect(handler));
        sync();

        group.add(row);
        this.add(group);
    }

    _addShortcutsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Keyboard shortcuts'),
            description: _('Click a row to record a new combination; the arrows restore the default and clear it. A row warns when the combination is already used elsewhere. Stacked and tabbed layouts are not available, so their shortcuts stay free.'),
        });

        // Lido a cada mudança: o aviso precisa enxergar os atalhos atuais.
        const others = () => readKeybindings([{settings: this._bindings}, {settings: this._settings}]);

        for (const spec of TILING_ACTIONS) {
            if (spec.action.type === 'unsupported') {
                const row = new Adw.ActionRow({title: _(spec.title), sensitive: false});
                row.add_suffix(new Gtk.ShortcutLabel({
                    accelerator: this._bindings.get_strv(spec.key)[0] ?? '',
                    disabled_text: _('none'),
                    valign: Gtk.Align.CENTER,
                }));
                group.add(row);
                continue;
            }

            group.add(shortcutRow({
                title: _(spec.title),
                settings: this._bindings,
                key: spec.key,
                _,
                others,
            }));
        }

        this.add(group);
    }
}
