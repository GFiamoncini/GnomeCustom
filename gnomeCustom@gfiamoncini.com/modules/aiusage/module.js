// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de cota de IA: quanto do plano do Claude já foi usado, na barra.
 *
 * Pedido do usuário em 2026-09-24, no desenho do cartão de cota do WinDock. As
 * regras estão em `lib/ai-usage.js`; a leitura, em `services/ai/claude-usage.js`.
 *
 * A cota é lida ao ativar (depois de alguns segundos, para não disputar o login),
 * a cada `refresh-minutes`, ao abrir o card e pelo botão de atualizar. O serviço
 * não pergunta de novo antes de dois minutos por conta, então abrir o card dez
 * vezes seguidas não vira dez consultas.
 */

import {Module} from '../../core/module.js';
import {State, chooseProfiles} from '../../lib/ai-usage.js';
import {AiUsageIndicator} from '../../ui/aiusage/indicator.js';

const ROLE = 'gnomecustom-aiusage';

/** A primeira leitura espera o login assentar. */
const FIRST_READ_MS = 8 * 1000;

export class AiUsageModule extends Module {
    static get id() {
        return 'aiusage';
    }

    static get title() {
        return 'AI Usage';
    }

    static get requires() {
        return ['panel', 'aiUsage'];
    }

    enable() {
        this._panel = this.service('panel');
        this._client = this.service('aiUsage');
        this._settings = this.settings.child('aiusage');
        this._accounts = null;
        this._readAt = null;
        this._timer = undefined;
        this._generation = 0;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'accounts', () => {
            this._accounts = null;   // outras contas: os blocos antigos não servem
            this._refresh();
        });
        for (const key of ['show-percent', 'expanded'])
            this.signals.connectSetting(this._settings, key, () => this._render());
        this.signals.connectSetting(this._settings, 'refresh-minutes', () => this._schedule());

        this._schedule(FIRST_READ_MS);
    }

    disable() {
        this._generation++;   // respostas que chegarem depois são descartadas
        this._stopTimer();
        this._removeIndicator();
        this._panel = null;
        this._client = null;
        this._settings = null;
        this._accounts = null;
    }

    _createIndicator() {
        this._indicator = new AiUsageIndicator({
            gettext: this.ctx.gettext,
            onOpen: () => this._refresh(),
            onRefresh: () => this._refresh({force: true}),
            onToggleExpanded: () => this._settings.set_boolean('expanded',
                !this._settings.get_boolean('expanded')),
            onSettings: () => this.ctx.extension.openPreferences(),
        });
        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            position: 0,
        });
        this._render();
    }

    _removeIndicator() {
        if (!this._indicator)
            return;
        this._panel.remove(ROLE);
        this._indicator = null;
    }

    _recreate() {
        this._removeIndicator();
        this._createIndicator();
    }

    /**
     * Antes da primeira resposta, uma entrada por conta encontrada, cada uma
     * "consultando…": o card nasce com os nomes certos em vez de aparecer vazio.
     */
    _render() {
        if (!this._indicator)
            return;
        const accounts = this._accounts ?? this._pending();
        this._indicator.show(accounts, {
            readAt: this._readAt,
            expanded: this._settings.get_boolean('expanded'),
            showPercent: this._settings.get_boolean('show-percent'),
        });
    }

    _pending() {
        try {
            return chooseProfiles(this._client.profiles(), this._settings.get_strv('accounts'))
                .map(profile => ({profile, state: State.UNKNOWN, gauges: [], plan: null, error: null, since: null}));
        } catch (e) {
            this.log.warn(`não deu para listar as contas do Claude Code: ${e.message}`);
            return [];
        }
    }

    async _refresh({force = false} = {}) {
        if (!this._client)
            return;
        this._stopTimer();

        const generation = ++this._generation;
        try {
            const accounts = await this._client.read(this._settings.get_strv('accounts'), {force});
            if (generation !== this._generation)
                return;   // desativado, ou outro pedido mais novo
            this._accounts = accounts;
            if (accounts.some(a => a.state === State.OK && !a.since))
                this._readAt = Date.now();
        } catch (e) {
            if (generation !== this._generation || this._client?.constructor.isCancelled(e))
                return;
            this.log.warn(`não foi possível ler a cota de IA: ${e.message}`);
        }

        this._render();
        this._schedule();
    }

    _schedule(delayMs = null) {
        this._stopTimer();
        if (!this._settings)
            return;
        const interval = delayMs ?? this._settings.get_uint('refresh-minutes') * 60 * 1000;
        this._timer = this.signals.addTimeout(interval, () => {
            this._timer = undefined;
            this._refresh();
            return false;   // GLib.SOURCE_REMOVE: o próximo é agendado pelo _refresh
        }, {label: 'aiusage-refresh'});
    }

    _stopTimer() {
        if (this._timer === undefined)
            return;
        this.signals.removeSource(this._timer);
        this._timer = undefined;
    }
}
