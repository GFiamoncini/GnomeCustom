// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {describeAccount} from '../../lib/ai-usage.js';
import {ClaudeUsageService} from '../../services/ai/claude-usage.js';
import {switchRow, spinRow, enumRow, infoRow, escapeMarkup} from '../widgets.js';

export class AiUsagePage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.aiusage`
     * @param {Function} _ função de tradução
     * @param {object} [options]
     * @param {object} [options.baseSettings] Gio.Settings base, dono de `aiusage-enabled`
     * @param {Function} [options.profiles] () => contas; os testes injetam uma lista falsa
     */
    constructor(settings, _, {baseSettings = null, profiles = null} = {}) {
        super({
            title: _('AI Usage'),
            icon_name: 'utilities-system-monitor-symbolic',
        });

        this._settings = settings;
        this._ = _;
        this._baseSettings = baseSettings;
        this._service = profiles ? null : new ClaudeUsageService();
        this._profiles = profiles ?? (() => this._service.profiles());

        this._addEnableGroup();
        this._addAccountsGroup();
        this._addOptionsGroup();
        this._addAboutGroup();

        this.connect('destroy', () => {
            this._service?.destroy();
            this._service = null;
        });
    }

    /** O liga/desliga do módulo também aqui, como no clima. */
    _addEnableGroup() {
        if (!this._baseSettings)
            return;
        const _ = this._;
        const group = new Adw.PreferencesGroup();
        group.add(switchRow({
            title: _('Show the AI usage in the top bar'),
            subtitle: _('The same switch as the AI Usage module on the General page'),
            settings: this._baseSettings,
            key: 'aiusage-enabled',
        }));
        this.add(group);
    }

    /**
     * Uma linha por conta do Claude Code achada nesta máquina. Todas marcadas
     * grava a lista vazia — "todas", inclusive as que aparecerem depois.
     */
    _addAccountsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Accounts'),
            description: _('Every ~/.claude* folder with a Claude Code login is an account, plus the one CLAUDE_CONFIG_DIR points to. Keep your personal and work accounts side by side with CLAUDE_CONFIG_DIR.'),
        });

        let profiles = [];
        try {
            profiles = this._profiles();
        } catch (e) {
            console.warn(`[GnomeCustom] cota de IA: não deu para listar as contas: ${e.message}`);
        }

        if (profiles.length === 0) {
            group.add(infoRow({
                title: _('No account found'),
                subtitle: _('Sign in to Claude Code on this computer; the card finds the account by itself.'),
            }));
            this.add(group);
            return;
        }

        const chosen = new Set(this._settings.get_strv('accounts').map(id => id.toLowerCase()));
        this._accountRows = profiles.map(profile => {
            const {title, line} = describeAccount(profile);
            const row = new Adw.SwitchRow({
                title: escapeMarkup(title),
                subtitle: escapeMarkup([line, profile.dir].filter(Boolean).join('  ·  ')),
                active: chosen.size === 0 || chosen.has(profile.id.toLowerCase()),
            });
            row.connect('notify::active', () => this._saveAccounts());
            group.add(row);
            return {row, id: profile.id};
        });

        this.add(group);
    }

    _saveAccounts() {
        const marked = this._accountRows.filter(r => r.row.active).map(r => r.id);
        // Nenhuma marcada seria um card vazio; todas é a lista vazia ("todas").
        const value = marked.length === this._accountRows.length || marked.length === 0 ? [] : marked;
        this._settings.set_strv('accounts', value);
        if (marked.length === 0)
            this._accountRows.forEach(r => (r.row.active = true));
    }

    _addOptionsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Display')});

        group.add(switchRow({
            title: _('Usage next to the icon'),
            subtitle: _('The 5-hour window of the first account, in amber or red when it is running out'),
            settings: this._settings,
            key: 'show-percent',
        }));
        group.add(switchRow({
            title: _('Detailed card'),
            subtitle: _('Account line and when each window resets. The arrow at the bottom of the card switches too.'),
            settings: this._settings,
            key: 'expanded',
        }));
        group.add(spinRow({
            title: _('Update every'),
            subtitle: _('In minutes. Opening the card also updates it, at most every two minutes.'),
            settings: this._settings,
            key: 'refresh-minutes',
            min: 2,
            max: 60,
            step: 1,
        }));
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

        this.add(group);
    }

    _addAboutGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('How it works')});
        group.add(infoRow({
            title: _('The same numbers as /usage in Claude Code'),
            subtitle: _('Read with the login Claude Code keeps in .credentials.json. The address is not a public API and may change without notice; if it does, the card says it could not read.'),
        }));
        group.add(infoRow({
            title: _('Read-only'),
            subtitle: _('Nothing is written to the Claude Code folders and the token never goes to the log. When the login expires, using Claude Code once renews it.'),
        }));
        this.add(group);
    }
}
