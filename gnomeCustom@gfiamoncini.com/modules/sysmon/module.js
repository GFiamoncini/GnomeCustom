// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do sistema: processador e memória na barra, e o cartão com os gráficos.
 *
 * Pedido do usuário em 2026-10-07, pelo que o WinDock tem. Uma leitura a cada
 * `interval-seconds` (2 s de fábrica), sempre — o histórico do gráfico tem de
 * existir antes de o cartão abrir —, mas o cartão fechado não redesenha nada.
 *
 * As contas estão em `lib/sysmon.js`; a leitura do `/proc`, em
 * `services/system/sysstats.js`.
 */

import GLib from 'gi://GLib';

import {Module} from '../../core/module.js';
import {cpuPercent, netRate, pushSample} from '../../lib/sysmon.js';
import {SysmonIndicator} from '../../ui/sysmon/indicator.js';

const ROLE = 'gnomecustom-sysmon';

export class SysmonModule extends Module {
    static get id() {
        return 'sysmon';
    }

    static get title() {
        return 'System Monitor';
    }

    static get requires() {
        return ['panel', 'sysStats', 'apps'];
    }

    enable() {
        this._panel = this.service('panel');
        this._stats = this.service('sysStats');
        this._apps = this.service('apps');
        this._settings = this.settings.child('sysmon');
        this._previous = null;
        this._history = {cpu: [], memory: [], down: [], up: []};
        this._timer = undefined;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'interval-seconds', () => this._start());

        this._sample();
        this._start();
    }

    disable() {
        this._stop();
        this._removeIndicator();

        this._panel = null;
        this._stats = null;
        this._apps = null;
        this._settings = null;
        this._previous = null;
        this._history = null;
    }

    _createIndicator() {
        this._indicator = new SysmonIndicator({
            gettext: this.ctx.gettext,
            onMonitor: () => this._apps.launch('org.gnome.SystemMonitor.desktop'),
        });
        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            slot: this.constructor.id,
        });
        // Abrir o cartão preenche na hora, sem esperar a próxima leitura.
        this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._render();
        });
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
        this._render();
    }

    _start() {
        this._stop();
        const seconds = this._settings.get_uint('interval-seconds');
        this._timer = this.signals.addTimeout(seconds * 1000, () => {
            this._sample();
            return GLib.SOURCE_CONTINUE;
        }, {label: 'sysmon-sample'});
    }

    _stop() {
        if (this._timer === undefined)
            return;
        this.signals.removeSource(this._timer);
        this._timer = undefined;
    }

    _sample() {
        const current = this._stats.read();
        const previous = this._previous;
        this._previous = current;

        this._cpu = cpuPercent(previous?.cpu, current.cpu);
        this._memory = current.memory;
        this._net = previous
            ? netRate(previous.net, current.net, (current.at - previous.at) / 1e6)
            : null;

        if (this._cpu !== null)
            pushSample(this._history.cpu, this._cpu);
        if (this._memory)
            pushSample(this._history.memory, this._memory.percent);
        if (this._net) {
            pushSample(this._history.down, this._net.down);
            pushSample(this._history.up, this._net.up);
        }
        this._render();
    }

    _render() {
        this._indicator?.update({
            cpu: this._cpu ?? null,
            memory: this._memory ?? null,
            net: this._net ?? null,
            cores: this._stats.cores,
            history: this._history,
        });
    }
}
