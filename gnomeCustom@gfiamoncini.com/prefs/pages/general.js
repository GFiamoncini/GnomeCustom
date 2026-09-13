// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {MODULES_INFO} from '../../lib/modules-info.js';
import {KNOWN_EXTENSIONS} from '../../lib/known-extensions.js';
import {PROFILES, CUSTOM_PROFILE, conflictsFor} from '../../lib/profiles.js';
import {applyProfile, currentProfile} from '../../lib/profiles-apply.js';

const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

/**
 * Rótulos dos níveis de log, na ordem de LOG_LEVELS.
 *
 * @param {Function} _ função de tradução
 * @returns {string[]}
 */
const logLevelLabels = _ => [
    _('Silent'),
    _('Errors only'),
    _('Warnings'),
    _('Info'),
    _('Debug'),
];

export class GeneralPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * A função de tradução é recebida por parâmetro, e não importada do recurso
     * do processo de preferências: assim a página não depende de rodar dentro
     * daquele processo e pode ser exercitada por `tests/prefs-smoke.js`.
     *
     * @param {object} settings Gio.Settings do esquema base
     * @param {Function} _ função de tradução (`ExtensionPreferences.gettext`)
     * @param {object} [options]
     * @param {Function} [options.openSettings] (esquema filho) => Gio.Settings;
     *   sem ele o seletor de perfil não aparece
     * @param {Function} [options.isEnabled] (uuid) => boolean, para avisar sobre
     *   extensões originais ativas
     * @param {Function} [options.confirm] (conflitos, aplicar, cancelar) — injetável em testes
     */
    constructor(settings, _, {openSettings = null, isEnabled = () => false, confirm = null} = {}) {
        super({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        this._ = _;
        this._settings = settings;
        this._openSettings = openSettings;
        this._isEnabled = isEnabled;
        this._confirm = confirm ?? ((conflicts, apply, cancel) => this._confirmDialog(conflicts, apply, cancel));

        if (openSettings)
            this._addProfileGroup();
        this._addModulesGroup();
        this._addLoggingGroup();
    }

    /**
     * Seletor de perfil. Como nos presets de tema, o perfil mostrado é derivado
     * dos valores atuais: ligar ou desligar um módulo à mão vira "Personalizado".
     */
    _addProfileGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Profile'),
            description: _('Turns modules on or off and picks a theme in one step.'),
        });

        const open = name => (name ? this._openSettings(name) : this._settings);
        const ids = [...PROFILES.map(p => p.id), CUSTOM_PROFILE];
        const model = new Gtk.StringList();
        for (const id of ids) {
            const profile = PROFILES.find(p => p.id === id);
            model.append(profile ? _(profile.title) : _('Custom'));
        }

        const row = new Adw.ComboRow({title: _('Profile'), model});
        this._profileRow = row;
        let updating = false;

        const sync = () => {
            const current = currentProfile(open);
            updating = true;
            row.selected = ids.indexOf(current);
            updating = false;
            const profile = PROFILES.find(p => p.id === current);
            row.subtitle = profile ? _(profile.summary) : _('Your own combination of modules and settings');
        };

        row.connect('notify::selected', () => {
            if (updating)
                return;
            const profile = PROFILES.find(p => p.id === ids[row.selected]);
            if (!profile) {
                sync();
                return;
            }
            const conflicts = conflictsFor(profile, KNOWN_EXTENSIONS, this._isEnabled);
            const apply = () => applyProfile(open, profile);
            if (conflicts.length > 0)
                this._confirm(conflicts, apply, sync);
            else
                apply();
        });

        const watched = [this._settings, ...['theme', 'animation', 'tiling'].map(n => this._openSettings(n))];
        for (const settings of watched) {
            const handler = settings.connect('changed', (_s, key) => {
                if (key !== 'palette' && key !== 'migration-backup')
                    sync();
            });
            row.connect('destroy', () => settings.disconnect(handler));
        }

        sync();
        group.add(row);
        this.add(group);
    }

    /** Pergunta antes de ligar módulos cujas extensões originais estão ativas. */
    _confirmDialog(conflicts, apply, cancel) {
        const _ = this._;
        const names = [...new Set(conflicts.map(c => c.name))].join(', ');
        const dialog = new Adw.AlertDialog({
            heading: _('Original extensions are still active'),
            body: _('%s would run alongside the modules that replace them. Disable them in the Extensions app first, or apply anyway and disable them afterwards.').replace('%s', names),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('apply', _('Apply anyway'));
        dialog.set_response_appearance('apply', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_d, response) => {
            if (response === 'apply')
                apply();
            else
                cancel();
        });
        const root = this.get_root();
        if (root)
            dialog.present(root);
        else
            cancel();
    }

    _addModulesGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Modules'),
            description: _('Each module can be turned on or off on its own. Turning the extension off restores the previous state of GNOME.'),
        });

        for (const info of MODULES_INFO)
            group.add(this._createModuleRow(info));

        this.add(group);
    }

    _createModuleRow(info) {
        const _ = this._;
        // `String.prototype.format` não existe em módulos GJS; a substituição
        // manual mantém o marcador visível para quem traduz.
        const pending = _('not implemented yet, arrives in phase %d')
            .replace('%d', String(info.phase));
        const row = new Adw.SwitchRow({
            title: _(info.title),
            subtitle: info.implemented ? _(info.summary) : `${_(info.summary)} — ${pending}`,
            sensitive: info.implemented,
        });

        if (info.implemented) {
            this._settings.bind(info.key, row, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        } else {
            // A chave existe no esquema, mas ligá-la não teria efeito ainda.
            row.active = false;
        }

        return row;
    }

    _addLoggingGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Logging'),
            description: _('Messages are written to the systemd journal, tagged [GnomeCustom].'),
        });

        const model = new Gtk.StringList();
        for (const label of logLevelLabels(_))
            model.append(label);

        const row = new Adw.ComboRow({
            title: _('Detail level'),
            model,
            selected: Math.max(0, LOG_LEVELS.indexOf(this._settings.get_string('log-level'))),
        });

        row.connect('notify::selected', () => {
            const nick = LOG_LEVELS[row.selected];
            if (nick && nick !== this._settings.get_string('log-level'))
                this._settings.set_string('log-level', nick);
        });

        this._settingsHandler = this._settings.connect('changed::log-level', () => {
            const index = LOG_LEVELS.indexOf(this._settings.get_string('log-level'));
            if (index !== -1 && index !== row.selected)
                row.selected = index;
        });

        this.connect('destroy', () => {
            if (this._settingsHandler) {
                this._settings.disconnect(this._settingsHandler);
                this._settingsHandler = null;
            }
        });

        group.add(row);
        this.add(group);
    }
}
