// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {MODULES_INFO} from '../../lib/modules-info.js';

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
     */
    constructor(settings, _) {
        super({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        this._ = _;
        this._settings = settings;
        this._addModulesGroup();
        this._addLoggingGroup();
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
            title: info.title,
            subtitle: info.implemented ? info.summary : `${info.summary} — ${pending}`,
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
