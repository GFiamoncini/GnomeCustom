// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Ações de sessão: visão geral, grade de aplicativos, bloqueio, energia e
 * encerramento forçado de janela.
 *
 * As ações de energia passam por `SystemActions`, o mesmo objeto que o menu de
 * sistema do GNOME usa. Isso importa: ele respeita inibidores, polkit e a
 * disponibilidade real de suspensão, o que uma chamada direta a `systemctl` não
 * faz. Há reserva por linha de comando caso a API mude de forma.
 *
 * APIs internas usadas:
 *   // GNOME 49: resource:///org/gnome/shell/misc/systemActions.js getDefault()
 *   // GNOME 49: Main.overview.toggle / .show / .dash.showAppsButton
 *   // GNOME 49: Main.pushModal / Main.popModal
 *   // GNOME 49: global.get_window_actors()
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {SignalTracker} from '../../core/signals.js';

export class SessionService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._picker = null;

        try {
            this._actions = SystemActions.getDefault();
        } catch (e) {
            this._actions = null;
            this._logger.warn(`SystemActions indisponível: ${e.message}`);
        }

        this._logger.debug(`ações de sessão disponíveis: ${this._describeActions()}`);
    }

    /** @returns {boolean} a sessão está bloqueada agora */
    get isLocked() {
        return Main.sessionMode.isLocked;
    }

    /** Alterna a visão geral. */
    toggleOverview() {
        Main.overview.toggle();
    }

    /** Abre a visão geral já na grade de aplicativos. */
    showAppGrid() {
        const button = Main.overview.dash?.showAppsButton;
        if (!button) {
            this._logger.debug('showAppsButton indisponível; abrindo a visão geral');
            Main.overview.show();
            return;
        }

        if (Main.overview.visible && button.checked) {
            Main.overview.hide();
            return;
        }

        Main.overview.show();
        button.checked = true;
    }

    /** @returns {boolean} */
    lockScreen() {
        return this._activate('activateLockScreen', 'canLockScreen');
    }

    /** @returns {boolean} */
    suspend() {
        return this._activate('activateSuspend', 'canSuspend');
    }

    /** @returns {boolean} */
    restart() {
        // Em algumas versões a ação chama-se activateRestart; em outras, o
        // reinício vem por activateSystemUpdate/PowerOff com diálogo.
        return this._activate('activateRestart', 'canRestart');
    }

    /** @returns {boolean} */
    powerOff() {
        return this._activate('activatePowerOff', 'canPowerOff');
    }

    /** @returns {boolean} */
    logout() {
        return this._activate('activateLogout', 'canLogout');
    }

    /**
     * Entra no modo de escolha de janela e encerra a que for clicada.
     *
     * Funciona no Wayland porque usa o próprio Mutter para achar a janela e
     * `Meta.Window.kill()` para encerrá-la — nada de `xkill`.
     *
     * @returns {boolean} true se o modo foi iniciado
     */
    pickWindowAndKill() {
        if (this._picker) {
            this._logger.debug('escolha de janela já em andamento');
            return false;
        }

        this._picker = new WindowPicker({
            logger: this._logger,
            onPicked: window => {
                this._logger.info(
                    `encerrando '${window.get_title() ?? '?'}' (${window.get_wm_class() ?? '?'})`);
                window.kill();
            },
            onFinished: () => {
                this._picker = null;
            },
        });

        return this._picker.start();
    }

    /** Cancela a escolha de janela, se estiver ativa. */
    cancelPick() {
        this._picker?.cancel();
    }

    _activate(method, capability) {
        if (!this._actions || typeof this._actions[method] !== 'function') {
            this._logger.warn(`ação '${method}' não existe nesta versão do GNOME`);
            return false;
        }

        if (capability in this._actions && this._actions[capability] === false) {
            this._logger.info(`ação '${method}' indisponível no sistema (${capability} é falso)`);
            return false;
        }

        try {
            this._actions[method]();
            return true;
        } catch (e) {
            this._logger.error(`falha na ação '${method}'`, e);
            return false;
        }
    }

    /** Diagnóstico: quais ações e capacidades a versão em uso expõe. */
    _describeActions() {
        if (!this._actions)
            return 'nenhuma';

        const methods = ['activateLockScreen', 'activateSuspend', 'activateRestart',
            'activatePowerOff', 'activateLogout'];
        return methods
            .map(name => `${name}=${typeof this._actions[name] === 'function' ? 'ok' : 'ausente'}`)
            .join(' ');
    }

    destroy() {
        this.cancelPick();
        this._actions = null;
    }
}

/**
 * Captura o próximo clique e entrega a janela sob o ponteiro.
 *
 * O ator cobre o palco inteiro e recebe um *modal grab*, então o clique não
 * chega à aplicação. `Escape` e o botão direito cancelam.
 */
class WindowPicker {
    constructor({logger, onPicked, onFinished}) {
        this._logger = logger;
        this._onPicked = onPicked;
        this._onFinished = onFinished;
        this._signals = new SignalTracker({name: 'window-picker', logger});
        this._grab = null;
        this._actor = null;
    }

    /** @returns {boolean} */
    start() {
        this._actor = new Clutter.Actor({reactive: true});
        this._actor.set_size(global.stage.width, global.stage.height);
        Main.uiGroup.add_child(this._actor);

        this._grab = Main.pushModal(this._actor, {
            actionMode: Shell.ActionMode.POPUP,
        });

        if (!this._grab?.get_seat_state) {
            // pushModal devolveu algo inesperado: não vale seguir com um grab
            // duvidoso, porque o usuário ficaria sem entrada.
            this._logger.warn('não foi possível capturar a entrada para escolher a janela');
            this._finish();
            return false;
        }

        this._setCursor(true);
        this._signals.connect(this._actor, 'button-press-event',
            (_actor, event) => this._onButtonPress(event));
        this._signals.connect(this._actor, 'key-press-event',
            (_actor, event) => this._onKeyPress(event));

        this._logger.info('escolha de janela: clique na janela a encerrar, Esc cancela');
        return true;
    }

    cancel() {
        this._finish();
    }

    _onButtonPress(event) {
        const button = event.get_button?.() ?? Clutter.BUTTON_PRIMARY;
        if (button !== Clutter.BUTTON_PRIMARY) {
            this._finish();
            return Clutter.EVENT_STOP;
        }

        const [x, y] = global.get_pointer();
        const window = this._windowAt(x, y);
        this._finish();

        if (!window) {
            this._logger.info('nenhuma janela sob o ponteiro');
            return Clutter.EVENT_STOP;
        }

        try {
            this._onPicked(window);
        } catch (e) {
            this._logger.error('falha ao encerrar a janela', e);
        }
        return Clutter.EVENT_STOP;
    }

    _onKeyPress(event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this._logger.debug('escolha de janela cancelada');
            this._finish();
        }
        return Clutter.EVENT_STOP;
    }

    /**
     * Janela mais acima que contém o ponto.
     *
     * @returns {?object} Meta.Window
     */
    _windowAt(x, y) {
        // A lista vem de baixo para cima, então percorre-se ao contrário.
        const actors = [...global.get_window_actors()].reverse();

        for (const actor of actors) {
            const window = actor.meta_window;
            if (!window || window.minimized)
                continue;
            if (window.window_type !== Meta.WindowType.NORMAL &&
                window.window_type !== Meta.WindowType.DIALOG)
                continue;

            const rect = window.get_frame_rect();
            if (x >= rect.x && x < rect.x + rect.width &&
                y >= rect.y && y < rect.y + rect.height)
                return window;
        }
        return null;
    }

    _setCursor(picking) {
        try {
            global.display.set_cursor(picking
                ? Meta.Cursor.CROSSHAIR
                : Meta.Cursor.DEFAULT);
        } catch (e) {
            this._logger.debug(`cursor não pôde ser alterado: ${e.message}`);
        }
    }

    _finish() {
        this._signals.destroy();
        this._setCursor(false);

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._actor) {
            this._actor.destroy();
            this._actor = null;
        }
        this._onFinished?.();
    }
}
