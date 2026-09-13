// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dock: um segundo Dash do GNOME Shell, fora da visão geral (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: Dash.Dash, Dash.DashIcon, Dash.DashItemContainer (ui/dash.js) — subclasses, sem patch
 *   // GNOME 49: Dash._box, ._showAppsIcon, ._background, ._separator, ._maxWidth,
 *   //           ._queueRedisplay(), ._hookUpLabel(), ._itemMenuStateChanged()
 *   // GNOME 49: AppIcon._iconContainer, ._dot, ._updateRunningStyle(), animateLaunch()
 *   // GNOME 49: Main.layoutManager.addChrome/removeChrome, .primaryMonitor, 'monitors-changed'
 *   // GNOME 49: Main.overview.dash (visibilidade e altura), Main.overview.visible
 *   // GNOME 49: Main.activateWindow
 *
 * Adaptado do GNOME Shell (`ui/dash.js`, © autores do GNOME Shell,
 * GPL-2.0-or-later) e do Dash to Dock (© micheleg e colaboradores,
 * GPL-2.0-or-later) — reuso permitido, LICENSE-AUDIT.md §4. Do Shell vieram a
 * criação dos itens e o cálculo do tamanho de ícone; do Dash to Dock, os cliques,
 * o "alternar janelas" com memória de 3 s e os pontos por janela.
 *
 * A visão geral ocupa o monitor inteiro, não a área de trabalho: se o dash dela
 * apenas sumisse, o conteúdo passaria por baixo do dock. Por isso ele fica
 * escondido, mas com a altura do dock, e a própria visão geral reserva o espaço.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from '../../core/signals.js';
import {advanceCycle, decideClick, dotsCount, pickIconSize} from '../../lib/dock.js';
import {rgba} from '../../theme/engine/color.js';

/** Cor de fundo do Dash to Dock; a opacidade vem da configuração. */
const BACKGROUND_COLOR = [33, 33, 33];

/** Desloca os pontos para a folga abaixo do ícone; mais que isso encosta na borda da tela. */
const DOTS_OFFSET_Y = 1;

const appWindows = app => app.get_windows().filter(window => !window.skip_taskbar);

/** Alterna entre as janelas de um app a cada clique; a ordem vale por 3 s. */
class WindowCycler {
    constructor() {
        this._memory = null;
        this._windows = [];
    }

    next(app, windows) {
        this._memory = advanceCycle(this._memory, app.get_id(), windows.length,
            GLib.get_monotonic_time());
        if (this._memory.index === 1)
            this._windows = windows;
        return this._windows[this._memory.index % this._windows.length];
    }
}

const DockIcon = GObject.registerClass(
class DockIcon extends Dash.DashIcon {
    _init(app, {cycler, logger}) {
        super._init(app);
        this._cycler = cycler;
        this._logger = logger;

        this._dots = new St.BoxLayout({
            style_class: 'gnomecustom-dock-dots',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            translation_y: DOTS_OFFSET_Y,
        });
        this._iconContainer.add_child(this._dots);

        this.app.connectObject('windows-changed', () => this._updateRunningStyle(), this);
        Shell.WindowTracker.get_default().connectObject('notify::focus-app',
            () => this._syncFocus(), this);

        this._updateRunningStyle();
        this._syncFocus();
    }

    // Os pontos por janela substituem o ponto único do Shell.
    _updateRunningStyle() {
        this._dot?.hide();
        if (!this._dots)
            return;   // chamado pelo construtor da classe base, antes dos pontos existirem

        const count = dotsCount(appWindows(this.app).length);
        if (count !== this._dots.get_n_children()) {
            this._dots.destroy_all_children();
            for (let i = 0; i < count; i++)
                this._dots.add_child(new St.Widget({style_class: 'gnomecustom-dock-dot'}));
        }
        this._dots.visible = count > 0;
    }

    _syncFocus() {
        if (Shell.WindowTracker.get_default().focus_app === this.app)
            this._dots.add_style_class_name('focused');
        else
            this._dots.remove_style_class_name('focused');
    }

    activate(button) {
        const state = Clutter.get_current_event()?.get_state() ?? 0;
        const windows = appWindows(this.app);
        const action = decideClick({
            button,
            shift: (state & Clutter.ModifierType.SHIFT_MASK) !== 0,
            ctrl: (state & Clutter.ModifierType.CONTROL_MASK) !== 0,
            running: windows.length > 0,
            focused: Shell.WindowTracker.get_default().focus_app === this.app,
            inOverview: Main.overview.visible,
        });
        this._logger?.debug(`clique no dock: ${this.app.get_id()} (botão ${button}) → ${action}`);

        switch (action) {
        case 'cycle':
            Main.activateWindow(this._cycler.next(this.app, windows));
            break;
        case 'activate-first':
            Main.activateWindow(windows[0]);
            break;
        case 'minimize':
            this._minimizeOne(windows);
            Main.overview.hide();
            break;
        case 'new-window':
            if (this.app.can_open_new_window()) {
                this.animateLaunch();
                this.app.open_new_window(-1);
            } else {
                this.app.activate();
            }
            Main.overview.hide();
            break;
        case 'app-activate':
            this.app.activate();
            Main.overview.hide();
            break;
        default:
            super.activate(button);
        }
    }

    /** Minimiza a janela do app que está à vista no workspace atual. */
    _minimizeOne(windows) {
        const workspace = global.workspace_manager.get_active_workspace();
        windows.find(window =>
            window.get_workspace() === workspace && window.showing_on_its_workspace())?.minimize();
    }
});

const DockDash = GObject.registerClass(
class DockDash extends Dash.Dash {
    _init({iconSize, cycler, logger}) {
        this._iconSizeCap = iconSize;
        this._cycler = cycler;
        this._dockLogger = logger;
        super._init();

        // O baseline não usa o botão "Mostrar aplicativos" no dock.
        this._showAppsIcon.hide();
    }

    setIconSizeCap(size) {
        this._iconSizeCap = size;
        this._queueRedisplay();
    }

    /**
     * @param {number} alpha 0 (transparente) a 1
     * @param {?number[]} [color] RGB vindo do Theme Engine; null usa a cor padrão
     */
    setBackgroundOpacity(alpha, color = null) {
        this._background.style =
            `background-color: ${rgba(color ?? BACKGROUND_COLOR, alpha)};`;
    }

    // Adaptado de Dash._createAppItem (GNOME Shell 49): o mesmo item, com DockIcon.
    _createAppItem(app) {
        const item = new Dash.DashItemContainer();
        const appIcon = new DockIcon(app, {cycler: this._cycler, logger: this._dockLogger});

        appIcon.connect('menu-state-changed',
            (_icon, opened) => this._itemMenuStateChanged(item, opened));

        item.setChild(appIcon);
        appIcon.label_actor = null;
        item.setLabelText(app.get_name());
        appIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(item, appIcon);

        return item;
    }

    // Adaptado de Dash._adjustIconSize (GNOME Shell 49): a largura disponível
    // decide, mas nunca acima do limite configurado. A altura não entra — o dock
    // cresce com o ícone, em vez de o ícone caber numa altura dada.
    _adjustIconSize() {
        const items = this._box.get_children().filter(actor =>
            actor.child?._delegate?.icon && !actor.animatingOut);

        let size = this._iconSizeCap;
        if (items.length > 0 && this._maxWidth !== -1) {
            const themeNode = this.get_theme_node();
            const content = themeNode.get_content_box(
                new Clutter.ActorBox({x1: 0, y1: 0, x2: this._maxWidth, y2: 42}));

            const firstButton = items[0].child;
            const firstIcon = firstButton._delegate.icon;
            firstIcon.icon.ensure_style();
            const [, , iconWidth] = firstIcon.icon.get_preferred_size();
            const [, , buttonWidth] = firstButton.get_preferred_size();
            const spacing = themeNode.get_length('spacing');

            const available = content.x2 - content.x1 -
                items.length * (buttonWidth - iconWidth) - (items.length - 1) * spacing;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            size = pickIconSize(available / items.length, this._iconSizeCap, scale);
        }

        if (size === this.iconSize)
            return;

        this.iconSize = size;
        for (const item of [...items, this._showAppsIcon])
            item.child._delegate.icon.setIconSize(size);
        this._separator?.set_height(size);
        this.emit('icon-size-changed');
    }
});

export class ShellDashService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._signals = new SignalTracker({name: 'svc:dash', logger});
        this._cycler = new WindowCycler();
        this._listeners = new Set();
        this._chrome = new Set();
        this._overviewDash = null;   // {dash, wasVisible}

        this._signals.connect(Main.layoutManager, 'monitors-changed', () => {
            for (const listener of this._listeners) {
                try {
                    listener();
                } catch (e) {
                    this._logger.error('observador de monitores falhou', e);
                }
            }
        });
    }

    /** @returns {?{index: number, x: number, y: number, width: number, height: number}} */
    get primaryMonitor() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;
        const {index, x, y, width, height} = monitor;
        return {index, x, y, width, height};
    }

    /**
     * @param {Function} callback chamado quando os monitores mudam
     * @returns {Function} remove o observador
     */
    onMonitorsChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * @param {object} options
     * @param {number} options.iconSize limite do tamanho de ícone
     * @returns {object} DockDash
     */
    createDash({iconSize}) {
        return new DockDash({iconSize, cycler: this._cycler, logger: this._logger});
    }

    /** Prende o ator na tela reservando espaço (struts) e some em tela cheia. */
    addChrome(actor) {
        Main.layoutManager.addChrome(actor, {affectsStruts: true, trackFullscreen: true});
        this._chrome.add(actor);
    }

    removeChrome(actor) {
        if (!this._chrome.delete(actor))
            return;
        Main.layoutManager.removeChrome(actor);
    }

    /**
     * Esconde o dash da visão geral, mas com a altura dada, para que ela reserve
     * o espaço do dock no rodapé.
     *
     * @param {number} height
     */
    reserveOverviewDash(height) {
        const dash = Main.overview.dash;
        if (!dash)
            return;

        if (!this._overviewDash) {
            this._overviewDash = {dash, wasVisible: dash.visible};
            dash.hide();
        }
        dash.set_height(Math.max(0, Math.round(height)));
    }

    restoreOverviewDash() {
        if (!this._overviewDash)
            return;

        const {dash, wasVisible} = this._overviewDash;
        this._overviewDash = null;
        try {
            dash.set_height(-1);
            dash.visible = wasVisible;
        } catch (e) {
            this._logger.debug(`dash da visão geral já destruído: ${e.message}`);
        }
    }

    destroy() {
        for (const actor of [...this._chrome]) {
            this.removeChrome(actor);
            actor.destroy();
        }
        this.restoreOverviewDash();
        this._signals.destroy();
        this._listeners.clear();
    }
}
