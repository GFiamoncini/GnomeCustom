// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do menu do logotipo.
 *
 * Coloca o botão no canto do painel e o mantém sincronizado com a configuração.
 * Toda a interação com o GNOME passa pelos serviços; o módulo só decide *quando*
 * o botão existe.
 */

import {Module} from '../../core/module.js';
import {LogoMenuButton} from '../../ui/menu/logo-menu.js';

const ROLE = 'gnomecustom-logo-menu';

/** Chaves que só exigem reconstruir o botão. */
const REFRESH_KEYS = [
    'icon-source', 'custom-icon-path', 'icon-size', 'gallery-logo', 'gallery-monochrome',
    'show-system-details', 'show-app-grid', 'show-activities-item',
    'show-software', 'show-monitor', 'show-terminal', 'show-extensions',
    'show-settings', 'show-force-quit', 'show-lock', 'show-power',
    'software-app', 'monitor-app', 'terminal-app', 'extensions-app',
];

export class MenuModule extends Module {
    static get id() {
        return 'menu';
    }

    static get title() {
        return 'Logo Menu';
    }

    static get requires() {
        return ['panel', 'distro', 'apps', 'session'];
    }

    enable() {
        this._panel = this.service('panel');
        this._distro = this.service('distro');
        this._apps = this.service('apps');
        this._session = this.service('session');
        this._settings = this.settings.child('menu');

        // O nome da distribuição vem de disco: carrega em segundo plano e só
        // então monta o botão, para não bloquear o loop principal.
        this._distro.load()
            .then(() => this._createButton())
            .catch(e => this.log.error('falha ao identificar a distribuição', e));

        for (const key of REFRESH_KEYS)
            this.signals.connectSetting(this._settings, key, () => this._button?.refresh());

        this._unsubscribeApps = this._apps.onInstalledChanged(() => this._button?.refresh());
    }

    disable() {
        this._unsubscribeApps?.();
        this._unsubscribeApps = null;

        if (this._button) {
            this._panel.remove(ROLE);
            this._button = null;
        }

        this._session?.cancelPick();

        this._panel = null;
        this._distro = null;
        this._apps = null;
        this._session = null;
        this._settings = null;
    }

    _createButton() {
        // O módulo pode ter sido desativado enquanto o os-release era lido.
        if (!this._panel || this._button)
            return;

        this._button = new LogoMenuButton({
            settings: this._settings,
            distro: this._distro,
            apps: this._apps,
            session: this._session,
            logger: this.log,
            gettext: this.ctx.gettext,
        });

        this._panel.add(ROLE, this._button, {position: 0, box: 'left'});
        this.log.debug(`botão do menu criado (logo '${this._distro.logoIconName}')`);
    }
}
