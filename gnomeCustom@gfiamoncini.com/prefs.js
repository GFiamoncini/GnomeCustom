// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Janela de preferências. Como o `extension.js`, é deliberadamente magra:
 * apenas monta as páginas de `prefs/pages/`.
 *
 * A função de tradução é passada às páginas por parâmetro (AD-12), o que as
 * mantém montáveis fora do processo de preferências — é assim que
 * `tests/prefs-smoke.js` consegue exercitá-las.
 */

import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GeneralPage} from './prefs/pages/general.js';
import {ThemePage} from './prefs/pages/theme.js';
import {PanelPage} from './prefs/pages/panel.js';
import {MenuPage} from './prefs/pages/menu.js';
import {BluetoothPage} from './prefs/pages/bluetooth.js';
import {MediaPage} from './prefs/pages/media.js';
import {DockPage} from './prefs/pages/dock.js';
import {OverviewPage} from './prefs/pages/overview.js';
import {AnimationPage} from './prefs/pages/animation.js';
import {TilingPage} from './prefs/pages/tiling.js';
import {MigrationPage} from './prefs/pages/migration.js';
import {AdvancedPage} from './prefs/pages/advanced.js';

export default class GnomeCustomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const _ = this.gettext.bind(this);
        const child = name =>
            this.getSettings(`${this.metadata['settings-schema']}.${name}`);

        const openSettings = name => (name ? child(name) : settings);
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const isEnabled = uuid => !shell.get_boolean('disable-user-extensions') &&
            !shell.get_strv('disabled-extensions').includes(uuid) &&
            shell.get_strv('enabled-extensions').includes(uuid);

        window.add(new GeneralPage(settings, _, {openSettings, isEnabled}));
        window.add(new ThemePage(child('theme'), _));
        window.add(new PanelPage(child('panel'), _));
        window.add(new MenuPage(child('menu'), _));
        window.add(new BluetoothPage(child('bluetooth'), _));
        window.add(new MediaPage(child('media'), _, {openSettings}));
        window.add(new DockPage(child('dock'), _));
        window.add(new OverviewPage(child('overview'), _));
        window.add(new AnimationPage(child('animation'), _));
        window.add(new TilingPage(child('tiling'), child('tiling.keybindings'), _));
        window.add(new MigrationPage(openSettings, _, {isEnabled}));
        window.add(new AdvancedPage(settings, this.metadata, _));

        window.set_default_size(760, 680);
        window.search_enabled = true;
    }
}
