// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de Bluetooth: dispositivos conectados e a bateria de cada um.
 *
 * Na barra, o ícone de cada dispositivo conectado com a porcentagem; o clique
 * abre um card com a lista, e clicar num dispositivo conecta ou desconecta.
 * Bateria no limite ou abaixo dele fica em vermelho. O botão some quando nada
 * está conectado.
 *
 * Desenho definido pelo usuário em 2026-09-10 (ROADMAP, Fase 3), no lugar dos
 * percentuais no menu do Bluetooth Battery Indicator. Reimplementação
 * independente (LICENSE-AUDIT.md §4).
 */

import {Module} from '../../core/module.js';
import {visibleDevices} from '../../lib/bluetooth.js';
import {BluetoothIndicator} from '../../ui/bluetooth/indicator.js';

const ROLE = 'gnomecustom-bluetooth';

export class BluetoothModule extends Module {
    static get id() {
        return 'bluetooth';
    }

    static get title() {
        return 'Bluetooth Battery';
    }

    static get requires() {
        return ['panel', 'bluetooth'];
    }

    enable() {
        this._panel = this.service('panel');
        this._bluetooth = this.service('bluetooth');
        this._settings = this.settings.child('bluetooth');
        this._kept = new Set();      // desconectados pelo card, visíveis até ele fechar
        this._pending = new Set();   // conexões em andamento

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'low-battery-threshold', () => this._sync());

        this._unsubscribe = this._bluetooth.onChanged(() => this._sync());
        this._sync();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._removeIndicator();

        this._panel = null;
        this._bluetooth = null;
        this._settings = null;
        this._kept = null;
        this._pending = null;
    }

    _createIndicator() {
        this._indicator = new BluetoothIndicator({
            gettext: this.ctx.gettext,
            onToggle: (path, connect) => this._toggle(path, connect),
            onClosed: () => {
                this._kept?.clear();
                this._sync();
            },
        });

        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            position: 0,
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
        this._sync();
    }

    _sync() {
        if (!this._indicator)
            return;

        const devices = visibleDevices(this._bluetooth.devices, this._kept);
        this._indicator.update({
            devices,
            threshold: this._settings.get_uint('low-battery-threshold'),
            pending: this._pending,
        });
        this._indicator.visible = devices.length > 0;

        const summary = devices
            .map(d => `${d.name} ${d.connected ? `${d.battery ?? '?'}%` : 'desconectado'}`)
            .join(', ') || 'nenhum';
        if (summary !== this._summary) {
            this._summary = summary;
            this.log.debug(`dispositivos exibidos: ${summary}`);
        }
    }

    async _toggle(path, connect) {
        if (this._pending.has(path))
            return;

        this._pending.add(path);
        if (!connect)
            this._kept.add(path);

        // Adiado: o `_sync` recria a linha, e ela não deve ser destruída dentro
        // do próprio clique.
        this.signals.addIdle(() => {
            this._sync();
            return false;
        }, {label: 'bluetooth-toggle'});

        try {
            await this._bluetooth.setConnected(path, connect);
            this.log.info(`${connect ? 'conectado' : 'desconectado'}: ${path}`);
        } catch (e) {
            this.log.warn(`não foi possível ${connect ? 'conectar' : 'desconectar'} ${path}: ${e.message}`);
        } finally {
            // O módulo pode ter sido desativado enquanto a chamada corria.
            if (this._pending) {
                this._pending.delete(path);
                this._sync();
            }
        }
    }
}
