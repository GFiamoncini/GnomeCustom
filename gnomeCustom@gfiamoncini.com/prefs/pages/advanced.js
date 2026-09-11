// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {KNOWN_EXTENSIONS} from '../../lib/known-extensions.js';
import {MODULES_INFO} from '../../lib/modules-info.js';

/**
 * Detecção de extensões ativas no processo de preferências.
 *
 * Aqui não existe `Main.extensionManager` — o processo é separado do Shell.
 * A aproximação possível é ler as próprias chaves do GNOME Shell, que é o que
 * esta classe faz. Dentro do Shell, o módulo de diagnóstico usa a fonte precisa.
 */
class ExtensionProbe {
    constructor() {
        this._shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
    }

    isEnabled(uuid) {
        if (this._shell.get_boolean('disable-user-extensions'))
            return false;
        if (this._shell.get_strv('disabled-extensions').includes(uuid))
            return false;
        return this._shell.get_strv('enabled-extensions').includes(uuid);
    }

    destroy() {
        this._shell = null;
    }
}

export class AdvancedPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings do esquema base
     * @param {object} metadata metadata.json da extensão
     * @param {Function} _ função de tradução (`ExtensionPreferences.gettext`)
     */
    constructor(settings, metadata, _) {
        super({
            title: _('Advanced'),
            icon_name: 'applications-engineering-symbolic',
        });

        this._ = _;
        this._settings = settings;
        this._metadata = metadata;

        const probe = new ExtensionProbe();
        this._addConflictsGroup(probe);
        probe.destroy();

        this._addDevelopmentGroup();
        this._addAboutGroup();
    }

    _addConflictsGroup(probe) {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Extensions being replaced'),
            description: _('GnomeCustom never disables anything on its own. While both are active, the two implementations compete for the same feature.'),
        });

        const implemented = new Set(
            MODULES_INFO.filter(info => info.implemented).map(info => info.id));

        let listed = 0;
        for (const entry of KNOWN_EXTENSIONS) {
            if (!probe.isEnabled(entry.uuid))
                continue;

            listed++;
            const conflict = implemented.has(entry.module) &&
                this._settings.get_boolean(`${entry.module}-enabled`);

            const row = new Adw.ActionRow({
                title: entry.name,
                subtitle: conflict
                    ? _('Conflict: this feature is already provided by GnomeCustom')
                    : _('Detected — the matching module is off, so there is no conflict'),
            });
            row.add_suffix(new Gtk.Image({
                icon_name: conflict ? 'dialog-warning-symbolic' : 'emblem-ok-symbolic',
                css_classes: conflict ? ['warning'] : ['dim-label'],
                valign: Gtk.Align.CENTER,
            }));
            group.add(row);
        }

        if (listed === 0) {
            group.add(new Adw.ActionRow({
                title: _('No known extension is active'),
                subtitle: _('Nothing competing with GnomeCustom was found'),
            }));
        }

        this.add(group);
    }

    _addDevelopmentGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Development'),
            description: _('Options meant for working on the extension itself.'),
        });

        const warnings = new Adw.SwitchRow({
            title: _('Warn about conflicting extensions'),
            subtitle: _('Writes a warning to the journal when a module and an original extension overlap'),
        });
        this._settings.bind('conflict-warnings', warnings, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(warnings);

        const cleanup = new Adw.SwitchRow({
            title: _('Check cleanup on disable'),
            subtitle: _('Reports leftover signals, sources and patches when the extension is turned off'),
        });
        this._settings.bind('strict-cleanup-check', cleanup, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(cleanup);

        this.add(group);
    }

    _addAboutGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('About')});

        group.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: this._metadata['version-name'] ?? String(this._metadata.version ?? '?'),
        }));
        group.add(new Adw.ActionRow({
            title: _('Tested GNOME Shell version'),
            subtitle: (this._metadata['shell-version'] ?? []).join(', '),
        }));
        group.add(new Adw.ActionRow({
            title: _('License'),
            subtitle: 'GPL-3.0-or-later',
        }));

        this.add(group);
    }
}
