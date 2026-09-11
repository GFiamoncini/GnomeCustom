// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do painel: menu de aplicações e visibilidade do botão Atividades.
 *
 * O baseline do usuário esconde o Atividades e mantém um menu de aplicações por
 * categoria — é exatamente o que este módulo entrega.
 */

import {Module} from '../../core/module.js';
import {AppsMenuButton} from '../../ui/panel/apps-menu.js';

const ROLE = 'gnomecustom-apps-menu';
const SHORTCUT_KEY = 'apps-menu-shortcut';

export class PanelModule extends Module {
    static get id() {
        return 'panel';
    }

    static get title() {
        return 'Panel';
    }

    static get requires() {
        return ['panel', 'apps', 'keybindings'];
    }

    enable() {
        this._panel = this.service('panel');
        this._apps = this.service('apps');
        this._keybindings = this.service('keybindings');
        this._settings = this.settings.child('panel');

        this.signals.connectSetting(this._settings, 'apps-menu',
            () => this._syncAppsMenu(), {fireNow: true});
        this.signals.connectSetting(this._settings, 'show-activities',
            () => this._syncActivities(), {fireNow: true});
        this.signals.connectSetting(this._settings, 'apps-menu-icon-size',
            () => this._button?.invalidate());

        this._unsubscribeApps = this._apps.onInstalledChanged(
            () => this._button?.invalidate());
    }

    disable() {
        this._unsubscribeApps?.();
        this._unsubscribeApps = null;

        this._removeAppsMenu();
        this._panel?.showNative('activities');

        this._panel = null;
        this._apps = null;
        this._keybindings = null;
        this._settings = null;
    }

    _syncAppsMenu() {
        if (this._settings.get_boolean('apps-menu'))
            this._addAppsMenu();
        else
            this._removeAppsMenu();
    }

    _addAppsMenu() {
        if (this._button)
            return;

        this._button = new AppsMenuButton({
            settings: this._settings,
            apps: this._apps,
            logger: this.log,
            gettext: this.ctx.gettext,
        });

        // Depois do Atividades quando ele existe, no começo quando não.
        this._panel.add(ROLE, this._button, {
            position: this._panel.indexAfter('activities'),
            box: 'left',
        });

        this._keybindings.add(SHORTCUT_KEY, this._settings,
            () => this._button?.menu.toggle());

        this.log.debug('menu de aplicações adicionado');
    }

    _removeAppsMenu() {
        if (!this._button)
            return;

        this._keybindings.remove(SHORTCUT_KEY);
        this._panel.remove(ROLE);
        this._button = null;
    }

    _syncActivities() {
        if (this._settings.get_boolean('show-activities'))
            this._panel.showNative('activities');
        else
            this._panel.hideNative('activities');
    }
}
