// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de dispositivo externo: remover pen-drive, cartão e HD externo com
 * segurança, pela barra.
 *
 * Pedido do usuário em 2026-09-28, pelo que o WinDock ganhou em 2026-09-25. O
 * ícone **só existe enquanto houver o que remover** (é o padrão; a opção
 * `hide-when-empty` o deixa fixo), o mesmo critério do WinDock: um botão parado
 * o dia inteiro dizendo "nenhum dispositivo" pesa mais que o deslocamento dos
 * vizinhos quando algo entra — e esse deslocamento é o aviso de que entrou.
 *
 * As regras estão em `lib/removable.js`; a leitura e a remoção, em
 * `services/system/removable.js`.
 */

import Gio from 'gi://Gio';

import {Module} from '../../core/module.js';
import {summarize} from '../../lib/removable.js';
import {RemovableIndicator} from '../../ui/removable/indicator.js';

const ROLE = 'gnomecustom-removable';

export class RemovableModule extends Module {
    static get id() {
        return 'removable';
    }

    static get title() {
        return 'Removable Devices';
    }

    static get requires() {
        return ['panel', 'removable'];
    }

    enable() {
        this._panel = this.service('panel');
        this._removable = this.service('removable');
        this._settings = this.settings.child('removable');
        this._busy = null;
        this._message = null;
        this._summary = null;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'hide-when-empty', () => this._sync());

        this._unsubscribe = this._removable.onChanged(() => this._sync());
        this._sync();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._removeIndicator();

        this._panel = null;
        this._removable = null;
        this._settings = null;
        this._busy = null;
        this._message = null;
    }

    _createIndicator() {
        this._indicator = new RemovableIndicator({
            gettext: this.ctx.gettext,
            onOpenDevice: id => this._removable.open(id),
            onEject: id => this._eject(id),
            onClosed: () => {
                // O diálogo "quem está usando" do Shell fecha o card no meio da
                // remoção; o recado dela tem de sobreviver até a próxima abertura.
                if (this._busy === null)
                    this._message = null;
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

        const devices = this._removable.devices;
        this._indicator.update(devices, {busy: this._busy, message: this._message});

        // Com o card aberto o botão fica, mesmo sem aparelho: é nele que está o
        // "já pode desconectar" do último que saiu.
        const open = this._indicator.menu.isOpen;
        this._indicator.visible = devices.length > 0 || open ||
            !this._settings.get_boolean('hide-when-empty');

        const summary = summarize(devices);
        if (summary !== this._summary) {
            this._summary = summary;
            this.log.debug(`externos: ${summary}`);
        }
    }

    async _eject(id) {
        if (this._busy !== null)
            return;
        const _ = this.ctx.gettext;
        const device = this._removable.devices.find(d => d.id === id);
        const name = device?.name ?? id;

        this._busy = id;
        this._message = {kind: '', text: _('Removing %s…').replace('%s', name)};
        this._defer();

        try {
            await this._removable.eject(id);
            this.log.info(`removido: ${name}`);
            this._message = {kind: 'ok', text: _('%s can be unplugged.').replace('%s', name)};
        } catch (e) {
            if (!this._removable)
                return;   // desativado no meio
            this._message = this._failure(e, name);
            this.log.info(`não removido: ${name}: ${e.message}`);
        } finally {
            if (this._removable) {
                this._busy = null;
                this._sync();
            }
        }
    }

    _failure(error, name) {
        const _ = this.ctx.gettext;
        // A pessoa já respondeu ao diálogo do Shell (cancelou): nada a acrescentar.
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED_HANDLED) ||
            error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return null;
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.BUSY)) {
            return {kind: 'error', text: _('%s is still in use. Close the program using it and try again.')
                .replace('%s', name)};
        }
        return {kind: 'error', text: _('Could not remove %s: %s').replace('%s', name).replace('%s', error.message)};
    }

    /** Adiado: `_sync` recria as linhas, e o botão não deve ser destruído no próprio clique. */
    _defer() {
        this.signals.addIdle(() => {
            this._sync();
            return false;
        }, {label: 'removable-sync'});
    }
}
