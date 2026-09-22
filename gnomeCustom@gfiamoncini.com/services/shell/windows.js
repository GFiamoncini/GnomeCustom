// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Janelas do Mutter, vistas por um adaptador simples.
 *
 * Implementa a interface que o `TilingController` espera (ver
 * `lib/tiling/controller.js`) e traduz os sinais do Mutter em eventos
 * normalizados. Nenhum módulo toca em `Meta.Window` diretamente.
 *
 * APIs internas e do Mutter usadas (GNOME 49 / Mutter 17, conferidas no typelib):
 *   // global.display: window-created, notify::focus-window, grab-op-begin,
 *   //   grab-op-end, window-entered-monitor, workareas-changed,
 *   //   get_monitor_neighbor_index, get_monitor_geometry, get_n_monitors
 *   // global.workspace_manager: active-workspace-changed
 *   // Main.layoutManager: monitors-changed; Main.overview: showing, hidden
 *   // Meta.Window: shown, unmanaged, workspace-changed, notify::minimized,
 *   //   notify::fullscreen, notify::maximized-horizontally/-vertically,
 *   //   notify::title, notify::wm-class, set_unmaximize_flags + unmaximize()
 *   //   (assinatura nova do 49), move_frame, move_resize_frame
 */

import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from '../../core/signals.js';

/** Tipos de janela que o tiling considera; o resto nem é rastreado. */
const TYPE_NAMES = new Map([
    [Meta.WindowType.NORMAL, 'normal'],
    [Meta.WindowType.DIALOG, 'dialog'],
    [Meta.WindowType.MODAL_DIALOG, 'modal-dialog'],
]);

const DIRECTIONS = {
    up: Meta.DisplayDirection.UP,
    down: Meta.DisplayDirection.DOWN,
    left: Meta.DisplayDirection.LEFT,
    right: Meta.DisplayDirection.RIGHT,
};

const plainRect = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});

export class WindowsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._signals = new SignalTracker({name: 'svc:windows', logger});
        /** @type {Map<number, {window: object, ready: boolean, tokens: number[]}>} */
        this._tracked = new Map();
        this._listeners = new Set();

        const display = global.display;
        this._signals.connect(display, 'window-created', (_d, window) => this._track(window, {isNew: true}));
        // O foco vai para uma janela nova *antes* de ela ficar pronta; se o evento
        // esperasse, o histórico de foco nunca conteria janelas recém-abertas e
        // um split seguido de janela nova mandaria a nova para o fim (visto
        // rodando no Shell). Então o id vai cru, pronto ou não.
        this._signals.connect(display, 'notify::focus-window', () =>
            this._emit({type: 'focus', id: display.focus_window?.get_id() ?? null}));
        this._signals.connect(display, 'grab-op-begin', (_d, window, op) =>
            this._emitFor(window, {type: 'grab-begin', op}));
        this._signals.connect(display, 'grab-op-end', (_d, window, op) =>
            this._emitFor(window, {type: 'grab-end', op}));
        this._signals.connect(display, 'window-entered-monitor', (_d, _monitor, window) =>
            this._emitFor(window, {type: 'changed', what: 'monitor'}));
        this._signals.connect(display, 'workareas-changed', () => this._emit({type: 'workareas-changed'}));

        this._signals.connect(global.workspace_manager, 'active-workspace-changed', () =>
            this._emit({type: 'workspace-switched'}));
        this._signals.connect(Main.layoutManager, 'monitors-changed', () =>
            this._emit({type: 'monitors-changed'}));
        this._signals.connect(Main.overview, 'showing', () => this._emit({type: 'overview', visible: true}));
        this._signals.connect(Main.overview, 'hidden', () => this._emit({type: 'overview', visible: false}));

        for (const actor of global.get_window_actors())
            this._track(actor.meta_window, {isNew: false});
    }

    /**
     * @param {Function} callback recebe `{type, id?, ...}`
     * @returns {Function} remove o observador
     */
    onEvent(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    // ------------------------------------------- adaptador do controlador

    list() {
        return [...this._tracked.entries()]
            .filter(([, entry]) => entry.ready)
            .map(([id]) => id);
    }

    describe(id) {
        const window = this._readyWindow(id);
        if (!window)
            return null;

        const workspace = window.is_on_all_workspaces() ? -1 : (window.get_workspace()?.index() ?? -1);
        return {
            id,
            wmClass: window.get_wm_class(),
            title: window.get_title(),
            type: TYPE_NAMES.get(window.get_window_type()) ?? 'other',
            transient: window.get_transient_for() !== null,
            // Não `allows_resize()`: ele devolve falso enquanto a janela está
            // maximizada, e o Mutter maximiza sozinho janelas que abrem grandes —
            // todas pareceriam "tamanho fixo" e flutuariam. `resizeable` descreve
            // a janela, não o estado dela agora.
            allowsResize: window.resizeable ?? window.allows_resize(),
            minimized: window.minimized,
            fullscreen: window.is_fullscreen(),
            maximized: window.is_maximized(),
            skipTaskbar: window.is_skip_taskbar(),
            monitor: window.get_monitor(),
            workspace,
        };
    }

    workArea(monitor, workspace) {
        const manager = global.workspace_manager;
        const ws = manager.get_workspace_by_index(workspace) ?? manager.get_active_workspace();
        return plainRect(ws.get_work_area_for_monitor(monitor));
    }

    activeWorkspace() {
        return global.workspace_manager.get_active_workspace_index();
    }

    monitors() {
        return global.display.get_n_monitors();
    }

    monitorNeighbor(monitor, direction) {
        return global.display.get_monitor_neighbor_index(monitor, DIRECTIONS[direction]);
    }

    monitorAt(x, y) {
        for (let i = 0; i < global.display.get_n_monitors(); i++) {
            const geometry = global.display.get_monitor_geometry(i);
            if (x >= geometry.x && x < geometry.x + geometry.width &&
                y >= geometry.y && y < geometry.y + geometry.height)
                return i;
        }
        return -1;
    }

    frameRect(id) {
        const window = this._readyWindow(id);
        return window ? plainRect(window.get_frame_rect()) : {x: 0, y: 0, width: 0, height: 0};
    }

    moveResize(id, rect) {
        const window = this._readyWindow(id);
        if (!window)
            return;

        if (window.is_maximized()) {
            try {
                // GNOME 49: as direções saíram do argumento de unmaximize().
                window.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
                window.unmaximize();
            } catch (e) {
                this._logger.debug(`unmaximize no formato antigo: ${e.message}`);
                window.unmaximize(Meta.MaximizeFlags.BOTH);
            }
        }

        // Sem isto, a animação de mapa/maximização do Shell compete com o
        // posicionamento e a janela "salta" depois de ir para o lugar.
        window.get_compositor_private()?.remove_all_transitions();
        window.move_frame(true, rect.x, rect.y);
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
    }

    activate(id) {
        this._readyWindow(id)?.activate(global.get_current_time());
    }

    /** @param {number} id @returns {boolean} */
    isAbove(id) {
        return Boolean(this._tracked.get(id)?.window.is_above());
    }

    setAbove(id, above) {
        const window = this._tracked.get(id)?.window;
        if (!window)
            return;
        if (above && !window.is_above())
            window.make_above();
        else if (!above && window.is_above())
            window.unmake_above();
    }

    focusedId() {
        const window = global.display.focus_window;
        if (!window)
            return null;
        const id = window.get_id();
        return this._tracked.get(id)?.ready ? id : null;
    }

    pointer() {
        const [x, y] = global.get_pointer();
        return [x, y];
    }

    // ------------------------------------------------ extras para a borda

    /** @returns {?object} Meta.Window */
    window(id) {
        return this._readyWindow(id);
    }

    /** @returns {boolean} a visão geral está aberta */
    get overviewVisible() {
        return Main.overview.visible;
    }

    // ------------------------------------------------------------ internos

    _readyWindow(id) {
        const entry = this._tracked.get(id);
        return entry?.ready ? entry.window : null;
    }

    _track(window, {isNew}) {
        if (!window || !TYPE_NAMES.has(window.get_window_type()))
            return;

        const id = window.get_id();
        if (this._tracked.has(id))
            return;

        const entry = {window, ready: false, tokens: []};
        this._tracked.set(id, entry);

        const on = (signal, handler) => entry.tokens.push(this._signals.connect(window, signal, handler));
        on('unmanaged', () => this._untrack(id));
        on('workspace-changed', () => this._emitReady(id, {type: 'changed', what: 'workspace'}));
        on('notify::minimized', () => this._emitReady(id, {type: 'changed', what: 'minimized'}));
        on('notify::fullscreen', () => this._emitReady(id, {type: 'changed', what: 'fullscreen'}));
        on('notify::maximized-horizontally', () => this._emitReady(id, {type: 'changed', what: 'maximized'}));
        on('notify::maximized-vertically', () => this._emitReady(id, {type: 'changed', what: 'maximized'}));
        on('notify::title', () => this._emitReady(id, {type: 'changed', what: 'title'}));
        on('notify::wm-class', () => this._emitReady(id, {type: 'changed', what: 'class'}));

        if (!isNew) {
            entry.ready = true;
            return;
        }

        // Janela nova: só entra no jogo depois de aparecer, e mais um ciclo do
        // loop, para o Mutter terminar o posicionamento inicial. Mover antes
        // disso faz a janela brigar com a própria colocação.
        let shownToken;
        const becomeReady = () => {
            if (shownToken !== undefined) {
                this._signals.disconnect(shownToken);
                shownToken = undefined;
            }
            this._signals.addIdle(() => {
                if (this._tracked.get(id) === entry && !entry.ready) {
                    entry.ready = true;
                    this._emit({type: 'added', id});
                }
                return false;   // GLib.SOURCE_REMOVE
            }, {label: 'window-ready'});
        };

        if (window.get_compositor_private()?.visible && !window.minimized)
            becomeReady();
        else {
            shownToken = this._signals.connect(window, 'shown', becomeReady);
            // Se a janela sumir antes de aparecer, _untrack também desconecta.
            entry.tokens.push(shownToken);
        }
    }

    _untrack(id) {
        const entry = this._tracked.get(id);
        if (!entry)
            return;
        for (const token of entry.tokens)
            this._signals.disconnect(token);
        this._tracked.delete(id);
        if (entry.ready)
            this._emit({type: 'removed', id});
    }

    _emitFor(window, event) {
        if (!window)
            return;
        this._emitReady(window.get_id(), event);
    }

    _emitReady(id, event) {
        if (this._tracked.get(id)?.ready)
            this._emit({...event, id});
    }

    _emit(event) {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (e) {
                this._logger.error(`observador de janelas falhou em '${event.type}'`, e);
            }
        }
    }

    destroy() {
        this._listeners.clear();
        this._signals.destroy();
        this._tracked.clear();
    }
}
