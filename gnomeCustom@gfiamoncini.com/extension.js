// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Ponto de entrada.
 *
 * Este arquivo é deliberadamente magro: ele apenas monta as dependências que
 * vêm do GNOME Shell e as injeta no núcleo. Todo o resto de `core/` é livre de
 * imports do Shell, o que o torna testável com `gjs` puro (`make test`).
 */

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {Lifecycle} from './core/lifecycle.js';

import {ShellExtensionsService} from './services/shell/extensions.js';
import {ShellPanelService} from './services/shell/panel.js';
import {ShellThemeService} from './services/shell/theme.js';
import {AppsService} from './services/shell/apps.js';
import {SessionService} from './services/shell/session.js';
import {KeybindingsService} from './services/shell/keybindings.js';
import {ShellOsdService} from './services/shell/osd.js';
import {ShellDashService} from './services/shell/dash.js';
import {ShellOverviewService} from './services/shell/overview.js';
import {AnimationService} from './services/shell/animation.js';
import {BluetoothService} from './services/bluetooth/devices.js';
import {MprisService} from './services/mpris/players.js';
import {OpenMeteoClient} from './services/weather/openmeteo.js';
import {ClaudeUsageService} from './services/ai/claude-usage.js';
import {RemovableService} from './services/system/removable.js';
import {CoverArtService} from './services/system/cover-art.js';
import {DistroService} from './services/system/distro.js';
import {WallpaperService} from './services/system/wallpaper.js';
import {AppThemeService} from './services/system/app-theme.js';
import {StyleService} from './services/theme/style.js';
import {WindowsService} from './services/shell/windows.js';
import {QuickSettingsService} from './services/shell/quick-settings.js';

import {ThemeModule} from './modules/theme/module.js';
import {PanelModule} from './modules/panel/module.js';
import {MenuModule} from './modules/menu/module.js';
import {BluetoothModule} from './modules/bluetooth/module.js';
import {VolumeModule} from './modules/volume/module.js';
import {MediaModule} from './modules/media/module.js';
import {WeatherModule} from './modules/weather/module.js';
import {AiUsageModule} from './modules/aiusage/module.js';
import {RemovableModule} from './modules/removable/module.js';
import {DockModule} from './modules/dock/module.js';
import {OverviewModule} from './modules/overview/module.js';
import {AnimationModule} from './modules/animation/module.js';
import {TilingModule} from './modules/tiling/module.js';
import {DiagnosticsModule} from './modules/diagnostics/module.js';

/**
 * Ordem de ativação (ARCHITECTURE.md §5). A desativação é o inverso exato.
 *
 * O tema vem primeiro para que os módulos de interface já nasçam estilizados;
 * o diagnóstico vem por último, para avaliar o conjunto já montado.
 */
const MODULES = [
    ThemeModule,
    PanelModule,
    MenuModule,
    BluetoothModule,
    VolumeModule,
    MediaModule,
    WeatherModule,
    AiUsageModule,
    RemovableModule,
    DockModule,
    OverviewModule,
    AnimationModule,
    TilingModule,
    DiagnosticsModule,
];

export default class GnomeCustomExtension extends Extension {
    enable() {
        this._lifecycle = new Lifecycle({
            extension: this,
            shellVersion: Config.PACKAGE_VERSION,
            gettext: this.gettext.bind(this),
            createInjectionManager: () => new InjectionManager(),
            serviceFactories: {
                shellExtensions: ({logger}) => new ShellExtensionsService({
                    logger,
                    selfUuid: this.uuid,
                }),
                panel: ({logger}) => new ShellPanelService({logger}),
                shellTheme: ({logger}) => new ShellThemeService({logger}),
                apps: ({logger}) => new AppsService({logger}),
                session: ({logger}) => new SessionService({logger}),
                keybindings: ({logger}) => new KeybindingsService({logger}),
                osd: ({logger}) => new ShellOsdService({logger}),
                dash: ({logger}) => new ShellDashService({logger}),
                overview: ({logger}) => new ShellOverviewService({logger}),
                animation: ({logger}) => new AnimationService({logger}),
                bluetooth: ({logger}) => new BluetoothService({logger}),
                mpris: ({logger}) => new MprisService({logger}),
                coverArt: ({logger}) => new CoverArtService({logger}),
                weather: ({logger}) => new OpenMeteoClient({logger}),
                aiUsage: ({logger}) => new ClaudeUsageService({logger}),
                removable: ({logger}) => new RemovableService({logger}),
                distro: ({logger}) => new DistroService({logger}),
                wallpaper: ({logger}) => new WallpaperService({logger}),
                appTheme: ({logger}) => new AppThemeService({logger}),
                style: ({logger}) => new StyleService({logger}),
                windows: ({logger}) => new WindowsService({logger}),
                quickSettings: ({logger}) => new QuickSettingsService({logger}),
            },
            modules: MODULES,
        });

        this._lifecycle.enable();
    }

    disable() {
        this._lifecycle?.disable();
        this._lifecycle = null;
    }
}
