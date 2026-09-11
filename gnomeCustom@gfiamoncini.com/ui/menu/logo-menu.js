// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de painel com o logotipo da distribuição e um menu de sistema.
 *
 * Implementação própria. A extensão Logo Menu serviu para saber *quais* itens
 * fazem sentido nesse menu, mas nenhuma linha veio dela: sua licença é GPL-2.0
 * sem cláusula "or later" e é incompatível com este projeto
 * (LICENSE-AUDIT.md §2.2). O que existe aqui está construído sobre
 * `PanelMenu.Button` e `PopupMenu`, e as ações passam pelos serviços — o botão
 * não fala com o GNOME diretamente.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class LogoMenuButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {object} options.settings Gio.Settings de `…gnomecustom.menu`
     * @param {object} options.distro DistroService
     * @param {object} options.apps AppsService
     * @param {object} options.session SessionService
     * @param {object} options.logger
     * @param {Function} options.gettext
     */
    constructor({settings, distro, apps, session, logger, gettext}) {
        super(0.5, 'GnomeCustom Logo Menu', false);

        this._settings = settings;
        this._distro = distro;
        this._apps = apps;
        this._session = session;
        this._logger = logger;
        this._ = gettext;

        this._icon = new St.Icon({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._icon);

        this._syncIcon();
        this._buildMenu();
    }

    /** Reaplica ícone e itens depois de uma mudança de configuração. */
    refresh() {
        this._syncIcon();
        this._buildMenu();
    }

    // ------------------------------------------------------------- ícone

    _syncIcon() {
        const source = this._settings.get_string('icon-source');
        const size = this._settings.get_uint('icon-size');

        this._icon.icon_size = size;
        this._icon.gicon = null;
        this._icon.icon_name = null;

        switch (source) {
        case 'custom': {
            const path = this._settings.get_string('custom-icon-path');
            const file = path ? Gio.File.new_for_path(path) : null;
            if (file?.query_exists(null)) {
                this._icon.gicon = new Gio.FileIcon({file});
                this._icon.style_class = '';
                return;
            }
            this._logger.warn(`ícone personalizado não encontrado: '${path}'`);
            break;
        }
        case 'symbolic':
            this._icon.icon_name = this._distro.symbolicIconName;
            // A classe faz o ícone seguir a cor do texto do painel, que é o
            // ponto de usar um ícone monocromático.
            this._icon.style_class = 'system-status-icon';
            return;
        default:
            break;
        }

        this._icon.icon_name = this._distro.logoIconName;
        this._icon.style_class = '';
    }

    // -------------------------------------------------------------- menu

    _buildMenu() {
        this.menu.removeAll();

        const _ = this._;
        const show = key => this._settings.get_boolean(key);

        if (show('show-system-details')) {
            this._addItem(_('About This System'), () => this._apps.launchAboutSystem());
            this._addSeparator();
        }

        let hasNavigation = false;
        if (show('show-app-grid')) {
            this._addItem(_('Applications'), () => this._session.showAppGrid());
            hasNavigation = true;
        }
        if (show('show-activities-item')) {
            this._addItem(_('Activities'), () => this._session.toggleOverview());
            hasNavigation = true;
        }
        if (hasNavigation)
            this._addSeparator();

        let hasApps = false;
        if (show('show-software')) {
            this._addItem(_('Software'), () =>
                this._apps.launch(this._settings.get_string('software-app'),
                    ['org.gnome.Software.desktop']));
            hasApps = true;
        }
        if (show('show-monitor')) {
            this._addItem(_('System Monitor'), () =>
                this._apps.launch(this._settings.get_string('monitor-app'),
                    ['org.gnome.SystemMonitor.desktop', 'org.gnome.Usage.desktop']));
            hasApps = true;
        }
        if (show('show-terminal')) {
            this._addItem(_('Terminal'), () =>
                this._apps.launchTerminal(this._settings.get_string('terminal-app')));
            hasApps = true;
        }
        if (show('show-extensions')) {
            this._addItem(_('Extensions'), () =>
                this._apps.launchExtensionManager(this._settings.get_string('extensions-app')));
            hasApps = true;
        }
        if (show('show-settings')) {
            this._addItem(_('Settings'), () =>
                this._apps.launch('org.gnome.Settings.desktop'));
            hasApps = true;
        }
        if (hasApps)
            this._addSeparator();

        if (show('show-force-quit')) {
            this._addItem(_('Force Quit a Window…'), () => this._session.pickWindowAndKill());
            this._addSeparator();
        }

        if (show('show-lock'))
            this._addItem(_('Lock Screen'), () => this._session.lockScreen());

        if (show('show-power')) {
            this._addItem(_('Suspend'), () => this._session.suspend());
            this._addItem(_('Restart…'), () => this._session.restart());
            this._addItem(_('Power Off…'), () => this._session.powerOff());
        }

        this._trimTrailingSeparator();
    }

    _addItem(label, onActivate) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            try {
                onActivate();
            } catch (e) {
                this._logger.error(`item de menu '${label}' falhou`, e);
            }
        });
        this.menu.addMenuItem(item);
        return item;
    }

    _addSeparator() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    /** Um separador no fim do menu fica visível e feio; remove se sobrou. */
    _trimTrailingSeparator() {
        const items = this.menu._getMenuItems();
        const last = items.at(-1);
        if (last instanceof PopupMenu.PopupSeparatorMenuItem)
            last.destroy();
    }

    destroy() {
        this._settings = null;
        this._distro = null;
        this._apps = null;
        this._session = null;
        super.destroy();
    }
}
