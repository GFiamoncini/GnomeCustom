// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {SOURCES} from '../../lib/migration/importers.js';
import {openSource, applyImports, restoreBackup, backupDate} from '../../lib/migration/apply.js';
import {formatReport} from '../../lib/migration/report.js';

/**
 * Página de migração: importar a configuração das extensões originais.
 *
 * O caminho completo de troca é importar → escolher perfil → desativar as
 * originais → encerrar a sessão. A página explica isso; nada aqui liga módulos
 * ou mexe nas extensões originais.
 */
export class MigrationPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {Function} openSettings (esquema filho, '' = base) => Gio.Settings
     * @param {Function} _ função de tradução
     * @param {object} [options]
     * @param {Function} [options.openSource] injetável para testes
     * @param {Function} [options.isEnabled] (uuid) => boolean, idem
     */
    constructor(openSettings, _, {openSource: opener = openSource, isEnabled = null} = {}) {
        super({
            title: _('Migration'),
            icon_name: 'document-send-symbolic',
        });

        this._open = openSettings;
        this._ = _;
        this._openSource = opener;
        this._isEnabled = isEnabled ?? defaultIsEnabled();
        /** Último relatório, para a interface e para os testes. */
        this.lastReport = null;

        this._addImportGroup();
        this._addUndoGroup();
        this._addStepsGroup();
    }

    _addImportGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Import from the original extensions'),
            description: _('Reads the settings of the extensions GnomeCustom replaces and copies them over. The original extensions are only read, never changed.'),
        });

        this._sources = [];
        for (const source of SOURCES) {
            const opened = this._openSource(source);
            const status = !opened.installed
                ? _('not installed')
                : this._isEnabled(source.uuid) ? _('installed, active') : _('installed, inactive');

            const row = new Adw.ActionRow({title: _(source.title), subtitle: status});
            const button = new Gtk.Button({
                label: _('Import'),
                valign: Gtk.Align.CENTER,
                sensitive: opened.installed,
            });
            button.connect('clicked', () => this.importSources([{source, opened}]));
            row.add_suffix(button);
            group.add(row);

            if (opened.installed)
                this._sources.push({source, opened});
        }

        const all = new Adw.ActionRow({
            title: _('Import from every installed extension'),
            subtitle: _('%d found').replace('%d', String(this._sources.length)),
        });
        const allButton = new Gtk.Button({
            label: _('Import all'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            sensitive: this._sources.length > 0,
        });
        allButton.connect('clicked', () => this.importSources(this._sources));
        all.add_suffix(allButton);
        group.add(all);

        this.add(group);
    }

    _addUndoGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Undo')});
        this._undoRow = new Adw.ActionRow({title: _('Undo the last import')});
        this._undoButton = new Gtk.Button({label: _('Undo'), valign: Gtk.Align.CENTER});
        this._undoButton.connect('clicked', () => {
            const restored = restoreBackup(this._open);
            this._syncUndo();
            this._toast(_('%d option(s) restored').replace('%d', String(restored)));
        });
        this._undoRow.add_suffix(this._undoButton);
        group.add(this._undoRow);
        this._syncUndo();
        this.add(group);
    }

    _addStepsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('Switching over'),
            description: _('Importing only copies settings. To replace the original extensions:'),
        });
        const steps = [
            _('1. Import, above'),
            _('2. Choose a profile, or turn modules on, in the General page'),
            _('3. Disable the original extensions in the Extensions app'),
            _('4. Log out and back in'),
        ];
        for (const step of steps)
            group.add(new Adw.ActionRow({title: step}));
        this.add(group);
    }

    /**
     * Importa e mostra o relatório.
     *
     * @param {Array<{source: object, opened: object}>} entries
     * @returns {object} relatório
     */
    importSources(entries) {
        const imports = entries.map(({source, opened}) => ({
            source,
            result: source.run({read: opened.read, file: opened.file}),
        }));
        const report = applyImports(imports, this._open);
        this.lastReport = report;
        this._syncUndo();

        const {heading, body} = formatReport(report, this._);
        const root = this.get_root();
        if (root) {
            const dialog = new Adw.AlertDialog({heading, body});
            dialog.add_response('close', this._('Close'));
            dialog.present(root);
        }
        return report;
    }

    _syncUndo() {
        const date = backupDate(this._open);
        this._undoButton.sensitive = date !== null;
        this._undoRow.subtitle = date
            ? this._('Saved before the import of %s').replace('%s', date.replace('T', ' ').slice(0, 16))
            : this._('Nothing to undo');
    }

    _toast(message) {
        const root = this.get_root();
        if (root?.add_toast)
            root.add_toast(new Adw.Toast({title: message}));
    }
}

/** Mesma aproximação da página Avançado: as chaves do próprio GNOME Shell. */
function defaultIsEnabled() {
    const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
    return uuid => !shell.get_boolean('disable-user-extensions') &&
        !shell.get_strv('disabled-extensions').includes(uuid) &&
        shell.get_strv('enabled-extensions').includes(uuid);
}
