// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de Bluetooth: dispositivos pareados, a bateria de cada um e o rádio.
 *
 * Na barra, o ícone de cada dispositivo conectado com a porcentagem (ou o ícone
 * do Bluetooth quando nada está conectado); o clique abre o card no desenho do
 * WinDock, com o interruptor do rádio e os pareados. Clicar num dispositivo
 * conecta ou desconecta; o ✕ o esconde do card (`hidden-devices`). Bateria no
 * limite ou abaixo fica em vermelho.
 *
 * Desenho original do usuário em 2026-09-10 (ROADMAP, Fase 3), revisto em
 * 2026-09-16 pelo WinDock. Reimplementação independente (LICENSE-AUDIT.md §4).
 */

import {Module} from '../../core/module.js';
import {toggleHidden, visibleDevices} from '../../lib/bluetooth.js';
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
        return ['panel', 'bluetooth', 'apps'];
    }

    enable() {
        this._panel = this.service('panel');
        this._bluetooth = this.service('bluetooth');
        this._apps = this.service('apps');
        this._settings = this.settings.child('bluetooth');
        this._pending = new Set();   // conexões em andamento
        this._powerBusy = false;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        for (const key of ['low-battery-threshold', 'hidden-devices', 'hide-when-disconnected'])
            this.signals.connectSetting(this._settings, key, () => this._sync());

        this._unsubscribe = this._bluetooth.onChanged(() => this._sync());
        this._sync();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._removeIndicator();

        this._panel = null;
        this._bluetooth = null;
        this._apps = null;
        this._settings = null;
        this._pending = null;
    }

    _createIndicator() {
        this._indicator = new BluetoothIndicator({
            gettext: this.ctx.gettext,
            onToggle: (path, connect) => this._toggle(path, connect),
            onPower: powered => this._setPowered(powered),
            onHide: address => this._setHidden(address, true),
            onShowHidden: () => this._settings.set_strv('hidden-devices', []),
            onSettings: () => this._apps.launchSettingsPanel('bluetooth'),
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

        const hidden = this._settings.get_strv('hidden-devices');
        const devices = visibleDevices(this._bluetooth.devices, hidden);
        const adapter = this._bluetooth.adapter;
        const hiddenCount = this._bluetooth.devices
            .filter(device => device.paired && hidden.includes(device.address)).length;

        this._indicator.update({
            devices,
            powered: adapter ? adapter.powered : null,
            powerBusy: this._powerBusy,
            hiddenCount,
            threshold: this._settings.get_uint('low-battery-threshold'),
            pending: this._pending,
        });

        const anyConnected = devices.some(device => device.connected);
        this._indicator.visible = adapter !== null &&
            (anyConnected || !this._settings.get_boolean('hide-when-disconnected'));
        if (!this._indicator.visible)
            this._indicator.menu.close();

        const summary = `${adapter ? (adapter.powered ? 'ligado' : 'desligado') : 'sem adaptador'}: ` +
            (devices.map(d => `${d.name} ${d.connected ? `${d.battery ?? '?'}%` : 'pareado'}`)
                .join(', ') || 'nenhum');
        if (summary !== this._summary) {
            this._summary = summary;
            this.log.debug(`bluetooth ${summary}`);
        }
    }

    _setHidden(address, hide) {
        const current = this._settings.get_strv('hidden-devices');
        // Adiado: a gravação recria as linhas, e o ✕ não deve ser destruído no próprio clique.
        this.signals.addIdle(() => {
            this._settings?.set_strv('hidden-devices', toggleHidden(current, address, hide));
            return false;
        }, {label: 'bluetooth-hide'});
    }

    async _setPowered(powered) {
        if (this._powerBusy)
            return;
        this._powerBusy = true;
        this._sync();

        try {
            await this._bluetooth.setPowered(powered);
            this.log.info(`rádio Bluetooth ${powered ? 'ligado' : 'desligado'}`);
        } catch (e) {
            this.log.warn(`não foi possível ${powered ? 'ligar' : 'desligar'} o Bluetooth: ${e.message}`);
        } finally {
            if (this._pending) {
                this._powerBusy = false;
                this._sync();
            }
        }
    }

    async _toggle(path, connect) {
        if (this._pending.has(path))
            return;

        this._pending.add(path);

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
