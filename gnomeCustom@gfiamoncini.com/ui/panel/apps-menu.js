// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Menu de aplicações por categoria, em duas colunas.
 *
 * Adaptado da extensão oficial `apps-menu` do gnome-shell-extensions
 * (© 2013 Giovanni Campagna e colaboradores, GPL-2.0-or-later — reuso permitido,
 * ver LICENSE-AUDIT.md §4). O que veio de lá é o *modo de fazer*: a árvore
 * `GMenu` como fonte das categorias, o filtro por `should_show()` e o layout de
 * categorias à esquerda com aplicações à direita, trocando ao passar o ponteiro.
 * A estrutura foi reescrita para conversar com os serviços do projeto em vez de
 * chamar `Main.*` direto, e o arrastar-para-a-área-de-trabalho foi deixado de
 * fora: depende de integração com ícones na área de trabalho, que não existe no
 * baseline.
 */

import Clutter from 'gi://Clutter';
import GMenu from 'gi://GMenu';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** Proporção da altura da tela que o menu pode ocupar. */
const MAX_HEIGHT_FRACTION = 0.7;

/** Largura da coluna de categorias. */
const CATEGORY_WIDTH = 190;

/** Largura da coluna de aplicações. */
const APPLICATION_WIDTH = 300;

export class AppsMenuButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {object} options.settings Gio.Settings de `…gnomecustom.panel`
     * @param {object} options.apps AppsService
     * @param {object} options.logger
     * @param {Function} options.gettext
     */
    constructor({settings, apps, logger, gettext}) {
        super(0.5, 'GnomeCustom Applications', false);

        this._settings = settings;
        this._apps = apps;
        this._logger = logger;
        this._ = gettext;

        this._categories = [];
        this._needsReload = true;
        this._tree = null;

        this.add_child(new St.Label({
            text: gettext('Applications'),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-button-label',
        }));

        this._buildLayout();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._onOpened();
        });
    }

    /** Força recarga da árvore na próxima abertura. */
    invalidate() {
        this._needsReload = true;
    }

    _buildLayout() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: '',
        });

        this._categoriesBox = new St.BoxLayout({
            vertical: true,
            style_class: 'gnomecustom-apps-categories',
            width: CATEGORY_WIDTH,
        });
        this._applicationsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'gnomecustom-apps-list',
            width: APPLICATION_WIDTH,
        });

        this._categoriesScroll = this._wrapInScroll(this._categoriesBox);
        this._applicationsScroll = this._wrapInScroll(this._applicationsBox);

        const columns = new St.BoxLayout({
            vertical: false,
            style_class: 'gnomecustom-apps-menu',
        });
        columns.add_child(this._categoriesScroll);
        columns.add_child(this._applicationsScroll);

        item.add_child(columns);
        this.menu.addMenuItem(item);
    }

    _wrapInScroll(child) {
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
        });
        scroll.set_child(child);
        return scroll;
    }

    _onOpened() {
        const maxHeight = Math.round(
            global.stage.height * MAX_HEIGHT_FRACTION);
        this._categoriesScroll.style = `max-height: ${maxHeight}px;`;
        this._applicationsScroll.style = `max-height: ${maxHeight}px;`;

        if (!this._needsReload)
            return;

        this._reload();
        this._needsReload = false;
    }

    /**
     * Recarrega categorias e aplicações.
     *
     * `GMenu.Tree.load_sync` lê os arquivos `.desktop` de forma síncrona. É o
     * que o menu oficial e o próprio Shell fazem, mas para não pagar esse custo
     * ao entrar na sessão a carga acontece só na primeira abertura do menu, e é
     * refeita apenas quando as aplicações instaladas mudam.
     */
    _reload() {
        this._categoriesBox.destroy_all_children();
        this._applicationsBox.destroy_all_children();
        this._categories = [];

        try {
            this._tree ??= new GMenu.Tree({menu_basename: 'applications.menu'});
            this._tree.load_sync();
        } catch (e) {
            this._logger.error('não foi possível carregar a árvore de aplicações', e);
            this._showMessage(this._('Could not read the application menu'));
            return;
        }

        const root = this._tree.get_root_directory();
        const iter = root.iter();
        let type;

        while ((type = iter.next()) !== GMenu.TreeItemType.INVALID) {
            if (type !== GMenu.TreeItemType.DIRECTORY)
                continue;

            const directory = iter.get_directory();
            if (directory.get_is_nodisplay())
                continue;

            const apps = this._collectApps(directory);
            if (apps.length === 0)
                continue;

            this._categories.push({directory, apps});
        }

        if (this._categories.length === 0) {
            this._showMessage(this._('No applications found'));
            return;
        }

        for (const category of this._categories)
            this._categoriesBox.add_child(this._createCategoryRow(category));

        this._selectCategory(this._categories[0]);
    }

    /**
     * Aplicações visíveis de uma categoria, incluindo subcategorias.
     *
     * @param {object} directory GMenu.TreeDirectory
     * @param {object[]} [into]
     * @returns {object[]} Shell.App
     */
    _collectApps(directory, into = []) {
        const iter = directory.iter();
        let type;

        while ((type = iter.next()) !== GMenu.TreeItemType.INVALID) {
            if (type === GMenu.TreeItemType.ENTRY) {
                const entry = iter.get_entry();
                let id;
                try {
                    // Nomes de arquivo inválidos em UTF-8 fazem esta chamada
                    // lançar; a entrada é simplesmente ignorada.
                    id = entry.get_desktop_file_id();
                } catch {
                    continue;
                }

                const app = this._apps.lookup(id) ??
                    new Shell.App({app_info: entry.get_app_info()});
                if (app.get_app_info()?.should_show())
                    into.push(app);
            } else if (type === GMenu.TreeItemType.DIRECTORY) {
                const subdirectory = iter.get_directory();
                if (!subdirectory.get_is_nodisplay())
                    this._collectApps(subdirectory, into);
            }
        }

        into.sort((a, b) => a.get_name().localeCompare(b.get_name()));
        return into;
    }

    _createCategoryRow(category) {
        const row = new St.Button({
            style_class: 'gnomecustom-apps-category',
            can_focus: true,
            x_expand: true,
            reactive: true,
        });

        const box = new St.BoxLayout({vertical: false});
        const icon = category.directory.get_icon();
        if (icon) {
            box.add_child(new St.Icon({
                gicon: icon,
                icon_size: 22,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        box.add_child(new St.Label({
            text: category.directory.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        row.set_child(box);

        // Passar o ponteiro troca a lista, como no menu oficial; o clique
        // também funciona, para quem navega por teclado.
        row.connect('notify::hover', () => {
            if (row.hover)
                this._selectCategory(category);
        });
        row.connect('key-focus-in', () => this._selectCategory(category));
        row.connect('clicked', () => this._selectCategory(category));

        category.row = row;
        return row;
    }

    _selectCategory(category) {
        if (this._selected === category)
            return;

        this._selected?.row?.remove_style_pseudo_class('selected');
        this._selected = category;
        category.row?.add_style_pseudo_class('selected');

        this._applicationsBox.destroy_all_children();
        const iconSize = this._settings.get_uint('apps-menu-icon-size');

        for (const app of category.apps)
            this._applicationsBox.add_child(this._createAppRow(app, iconSize));
    }

    _createAppRow(app, iconSize) {
        const row = new St.Button({
            style_class: 'gnomecustom-apps-item',
            can_focus: true,
            x_expand: true,
            reactive: true,
        });

        const box = new St.BoxLayout({vertical: false});
        box.add_child(new St.Icon({
            gicon: app.get_icon(),
            icon_size: iconSize,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        row.set_child(box);

        row.connect('clicked', () => {
            this.menu.close();
            try {
                app.activate();
            } catch (e) {
                this._logger.error(`falha ao lançar ${app.get_id()}`, e);
            }
        });

        return row;
    }

    _showMessage(text) {
        this._applicationsBox.add_child(new St.Label({
            text,
            style_class: 'gnomecustom-apps-message',
        }));
    }

    destroy() {
        this._tree = null;
        this._categories = [];
        this._selected = null;
        this._settings = null;
        this._apps = null;
        super.destroy();
    }
}
