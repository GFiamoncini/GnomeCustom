// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do dock: favoritos e apps abertos, fixo no rodapé do monitor principal.
 *
 * Recorte do baseline (BASELINE-CONFIG.md §3.1) com o que o usuário definiu em
 * 2026-09-10: só no monitor principal — o LG, qualquer que seja o nome do conector
 * (ele já apareceu como HDMI-1 e HDMI-4) —, fixo (reserva espaço e some em tela
 * cheia), transparente, ícones de até 24 px, pontos por janela e os cliques padrão
 * do Dash to Dock. Na visão geral o dock continua visível.
 */

import {Module} from '../../core/module.js';
import {Dock} from '../../ui/dock/dock.js';

export class DockModule extends Module {
    static get id() {
        return 'dock';
    }

    static get title() {
        return 'Dock';
    }

    static get requires() {
        return ['dash', 'style'];
    }

    enable() {
        this._dash = this.service('dash');
        this._style = this.service('style');
        this._settings = this.settings.child('dock');

        this._dock = new Dock({
            dash: this._dash.createDash({iconSize: this._settings.get_uint('icon-size')}),
        });
        this._dash.addChrome(this._dock);

        this._heightToken = this.signals.connect(this._dock, 'notify::height',
            () => this._dash.reserveOverviewDash(this._dock.height));

        this.signals.connectSetting(this._settings, 'icon-size',
            () => this._dock.dash.setIconSizeCap(this._settings.get_uint('icon-size')));
        this.signals.connectSetting(this._settings, 'length-fraction', () => this._place());
        this.signals.connectSetting(this._settings, 'background-opacity',
            () => this._syncBackground(), {fireNow: true});

        // A cor do fundo pode vir do Theme Engine. Sem tokens publicados — tema
        // desligado ou sem cor resolvida — o dock usa a própria cor padrão.
        this._unsubscribeStyle = this._style.onChanged(() => this._syncBackground());

        this._unsubscribe = this._dash.onMonitorsChanged(() => this._place());
        this._place();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._unsubscribeStyle?.();
        this._unsubscribeStyle = null;

        if (this._dock) {
            // Desconecta antes de destruir: o sinal é do próprio contêiner.
            this.signals.disconnect(this._heightToken);
            this._dash.removeChrome(this._dock);
            this._dock.destroy();
            this._dock = null;
        }
        this._dash?.restoreOverviewDash();

        this._dash = null;
        this._style = null;
        this._settings = null;
    }

    _syncBackground() {
        const color = this._style.tokens?.dock?.backgroundRgb ?? null;
        this._dock.dash.setBackgroundOpacity(
            this._settings.get_double('background-opacity'), color);
    }

    _place() {
        const monitor = this._dash.primaryMonitor;
        if (!monitor) {
            this._dock.hide();
            return;
        }

        this._dock.show();
        this._dock.place(monitor, this._settings.get_double('length-fraction'));
        this.log.debug(
            `dock no monitor ${monitor.index} (${monitor.width}×${monitor.height} em ${monitor.x},${monitor.y})`);
    }
}
