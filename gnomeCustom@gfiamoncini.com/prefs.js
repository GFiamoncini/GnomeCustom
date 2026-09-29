// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Janela de preferências. Como o `extension.js`, é deliberadamente magra:
 * apenas monta as páginas de `prefs/pages/` no menu lateral de `prefs/layout.js`.
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
import {WeatherPage} from './prefs/pages/weather.js';
import {AiUsagePage} from './prefs/pages/aiusage.js';
import {RemovablePage} from './prefs/pages/removable.js';
import {UpdatesPage} from './prefs/pages/updates.js';
import {DockPage} from './prefs/pages/dock.js';
import {OverviewPage} from './prefs/pages/overview.js';
import {AnimationPage} from './prefs/pages/animation.js';
import {TilingPage} from './prefs/pages/tiling.js';
import {MigrationPage} from './prefs/pages/migration.js';
import {AdvancedPage} from './prefs/pages/advanced.js';
import {buildSidebarWindow} from './prefs/layout.js';

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

        // Menu lateral no lugar das abas: com doze páginas os títulos eram cortados.
        buildSidebarWindow(window, [
            new GeneralPage(settings, _, {openSettings, isEnabled}),
            new ThemePage(child('theme'), _),
            new PanelPage(child('panel'), _),
            new MenuPage(child('menu'), _),
            new BluetoothPage(child('bluetooth'), _),
            new MediaPage(child('media'), _, {openSettings}),
            new WeatherPage(child('weather'), _, {baseSettings: settings}),
            new AiUsagePage(child('aiusage'), _, {baseSettings: settings}),
            new RemovablePage(child('removable'), _),
            new UpdatesPage(child('updates'), _),
            new DockPage(child('dock'), _),
            new OverviewPage(child('overview'), _),
            new AnimationPage(child('animation'), _),
            new TilingPage(child('tiling'), child('tiling.keybindings'), _),
            new MigrationPage(openSettings, _, {isEnabled}),
            new AdvancedPage(settings, this.metadata, _),
        ], _);

        window.set_default_size(980, 720);
    }
}
