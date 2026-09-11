// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dispositivos Bluetooth pelo BlueZ, no barramento de sistema. Nenhuma API
 * interna do Shell.
 *
 * O estado é carregado com `GetManagedObjects` e mantido pelos sinais do
 * ObjectManager e de `PropertiesChanged` — sem consulta periódica: a bateria vem
 * de `org.bluez.Battery1`, que avisa quando muda. Se o `bluetoothd` reinicia, o
 * estado é descartado e recarregado. As regras ficam em `lib/bluetooth.js`.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    BATTERY_IFACE, DEVICE_IFACE, addInterfaces, changeProperties, devicesFromState,
    removeInterfaces,
} from '../../lib/bluetooth.js';

const BLUEZ = 'org.bluez';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const PROPERTIES = 'org.freedesktop.DBus.Properties';

/** Conectar um fone pode demorar; o padrão de 25 s do D-Bus às vezes não basta. */
const CONNECT_TIMEOUT_MS = 30000;

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

export class BluetoothService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._bus = Gio.DBus.system;
        this._cancellable = new Gio.Cancellable();
        this._state = new Map();
        this._listeners = new Set();

        this._subscriptions = [
            this._subscribe(OBJECT_MANAGER, 'InterfacesAdded', null, (_path, [path, interfaces]) => {
                addInterfaces(this._state, path, interfaces);
                this._notify();
            }),
            this._subscribe(OBJECT_MANAGER, 'InterfacesRemoved', null, (_path, [path, names]) => {
                removeInterfaces(this._state, path, names);
                this._notify();
            }),
            // Um filtro por interface: o BlueZ emite muitas outras mudanças (áudio, GATT).
            ...[DEVICE_IFACE, BATTERY_IFACE].map(iface =>
                this._subscribe(PROPERTIES, 'PropertiesChanged', iface,
                    (path, [name, changed, invalidated]) => {
                        if (changeProperties(this._state, path, name, changed, invalidated))
                            this._notify();
                    })),
        ];

        this._ownerId = this._bus.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', BLUEZ,
            Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _iface, _signal, params) => {
                const [, , newOwner] = params.deepUnpack();
                this._logger.info(newOwner ? 'bluetoothd voltou' : 'bluetoothd saiu');
                this._state.clear();
                this._notify();
                if (newOwner)
                    this._load();
            });

        this._load();
    }

    /** @returns {object[]} dispositivos conhecidos, normalizados */
    get devices() {
        return devicesFromState(this._state);
    }

    /**
     * @param {Function} callback chamado quando qualquer dispositivo muda
     * @returns {Function} remove o observador
     */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * @param {string} path objeto do dispositivo no BlueZ
     * @param {boolean} connected
     * @returns {Promise<void>}
     */
    setConnected(path, connected) {
        const method = connected ? 'Connect' : 'Disconnect';
        return new Promise((resolve, reject) => {
            this._bus.call(BLUEZ, path, DEVICE_IFACE, method, null, null,
                Gio.DBusCallFlags.NONE, CONNECT_TIMEOUT_MS, this._cancellable,
                (connection, result) => {
                    try {
                        connection.call_finish(result);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    _subscribe(iface, signal, arg0, handler) {
        return this._bus.signal_subscribe(BLUEZ, iface, signal, null, arg0,
            Gio.DBusSignalFlags.NONE, (_bus, _sender, path, _iface, _signal, params) => {
                try {
                    handler(path, params.recursiveUnpack());
                } catch (e) {
                    this._logger.error(`sinal ${signal} do BlueZ falhou`, e);
                }
            });
    }

    async _load() {
        try {
            const reply = await new Promise((resolve, reject) => {
                this._bus.call(BLUEZ, '/', OBJECT_MANAGER, 'GetManagedObjects', null,
                    new GLib.VariantType('(a{oa{sa{sv}}})'), Gio.DBusCallFlags.NO_AUTO_START,
                    -1, this._cancellable, (connection, result) => {
                        try {
                            resolve(connection.call_finish(result));
                        } catch (e) {
                            reject(e);
                        }
                    });
            });

            const [objects] = reply.recursiveUnpack();
            this._state.clear();
            for (const [path, interfaces] of Object.entries(objects))
                addInterfaces(this._state, path, interfaces);

            this._logger.debug(`${this.devices.length} dispositivo(s) Bluetooth conhecido(s)`);
            this._notify();
        } catch (e) {
            // Sem bluetoothd ou sem adaptador: nada a mostrar até o serviço aparecer.
            if (!isCancelled(e))
                this._logger.info(`BlueZ indisponível: ${e.message}`);
        }
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch (e) {
                this._logger.error('observador de dispositivos falhou', e);
            }
        }
    }

    destroy() {
        this._cancellable.cancel();
        for (const id of this._subscriptions)
            this._bus.signal_unsubscribe(id);
        this._bus.signal_unsubscribe(this._ownerId);
        this._subscriptions = [];
        this._state.clear();
        this._listeners.clear();
    }
}
