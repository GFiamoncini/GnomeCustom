// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Players de mídia pelo D-Bus (MPRIS). Nenhuma API interna do Shell.
 *
 * Acompanha todos os nomes `org.mpris.MediaPlayer2.*` da sessão: descobre os que
 * já existem, observa os que entram e saem e mantém um proxy por player. Quem
 * decide qual player aparece é o módulo, com as regras de `lib/mpris.js`.
 *
 * `Position` não gera aviso de mudança no MPRIS. O serviço guarda uma âncora
 * (posição + instante) e o consumidor estima o tempo a partir dela; a âncora é
 * refeita no `Seeked`, na troca de faixa ou de estado, e quando alguém pede.
 *
 * Os controles (tocar/pausar, próxima, anterior) são repassados por `control()`;
 * quem escolhe o player e confere as propriedades `Can*` é o módulo.
 *
 * As chamadas usam callback em vez de `Gio._promisify`: o Shell e outras
 * extensões podem já ter preparado `Gio.DBusConnection.call`, e preparar de novo
 * gera aviso.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MPRIS_PREFIX, playerIdFromBusName, normalizeMetadata, estimatePosition} from '../../lib/mpris.js';

const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const RootProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`);

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="${PLAYER_IFACE}">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="CanControl" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <signal name="Seeked">
      <arg name="Position" type="x"/>
    </signal>
  </interface>
</node>`);

/** Métodos de reprodução que o serviço aceita repassar. */
const CONTROL_METHODS = new Set(['PlayPause', 'Next', 'Previous']);

const now = () => GLib.get_monotonic_time();

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

function callAsync(bus, name, path, iface, method, params, replyType, cancellable) {
    return new Promise((resolve, reject) => {
        bus.call(name, path, iface, method, params, new GLib.VariantType(replyType),
            Gio.DBusCallFlags.NO_AUTO_START, -1, cancellable, (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/** `a{sv}` já em objeto JS, com cada valor desempacotado. */
function unpackMetadata(metadata) {
    return Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) =>
        [key, value instanceof GLib.Variant ? value.recursiveUnpack() : value]));
}

export class MprisService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._bus = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();
        this._players = new Map();    // busName -> entry
        this._connecting = new Set();
        this._listeners = new Set();

        this._ownerChangedId = this._bus.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            MPRIS_PREFIX.slice(0, -1), Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_bus, _sender, _path, _iface, _signal, params) =>
                this._onOwnerChanged(params.deepUnpack()));

        this._discover();
    }

    /** @returns {object[]} retrato atual de cada player conectado */
    get players() {
        return [...this._players.values()].map(entry => this._snapshot(entry));
    }

    /**
     * @param {Function} callback chamado quando qualquer player muda
     * @returns {Function} remove o observador
     */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * Relê `Position` do player (a cópia em cache do proxy fica velha) e avisa os
     * observadores.
     *
     * @param {string} busName
     */
    async refreshPosition(busName) {
        if (!this._players.has(busName))
            return;

        try {
            const reply = await callAsync(this._bus, busName, MPRIS_PATH,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']), '(v)', this._cancellable);
            const entry = this._players.get(busName);
            if (!entry)
                return;
            this._setAnchor(entry, Number(reply.recursiveUnpack()[0]));
            this._notify();
        } catch (e) {
            if (!isCancelled(e))
                this._logger.debug(`posição indisponível em ${busName}: ${e.message}`);
        }
    }

    /**
     * Pede ao player uma ação de reprodução.
     *
     * @param {string} busName
     * @param {string} method 'PlayPause' | 'Next' | 'Previous'
     * @returns {Promise<boolean>} se a chamada chegou ao player
     */
    async control(busName, method) {
        if (!this._players.has(busName) || !CONTROL_METHODS.has(method))
            return false;

        try {
            await callAsync(this._bus, busName, MPRIS_PATH, PLAYER_IFACE, method, null, '()',
                this._cancellable);
            return true;
        } catch (e) {
            if (!isCancelled(e))
                this._logger.warn(`${method} falhou em ${busName}: ${e.message}`);
            return false;
        }
    }

    /**
     * Pula para um ponto da faixa (`SetPosition`). O player ignora o pedido se a
     * faixa já tiver mudado, por isso o `trackId` vai junto.
     *
     * @param {string} busName
     * @param {string} trackId caminho de objeto da faixa atual
     * @param {number} position microssegundos
     * @returns {Promise<boolean>}
     */
    async seek(busName, trackId, position) {
        if (!this._players.has(busName))
            return false;

        try {
            await callAsync(this._bus, busName, MPRIS_PATH, PLAYER_IFACE, 'SetPosition',
                new GLib.Variant('(ox)', [trackId, Math.round(position)]), '()', this._cancellable);
            // Nem todo player emite `Seeked`; a âncora é refeita pela leitura real.
            this.refreshPosition(busName);
            return true;
        } catch (e) {
            if (!isCancelled(e))
                this._logger.warn(`SetPosition falhou em ${busName}: ${e.message}`);
            return false;
        }
    }

    async _discover() {
        try {
            const reply = await callAsync(this._bus, 'org.freedesktop.DBus',
                '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, '(as)',
                this._cancellable);
            const [names] = reply.deepUnpack();
            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._add(name);
            }
        } catch (e) {
            if (!isCancelled(e))
                this._logger.error('não foi possível listar os players MPRIS', e);
        }
    }

    _onOwnerChanged([name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PREFIX))
            return;
        if (oldOwner)
            this._remove(name);
        if (newOwner)
            this._add(name);
    }

    async _add(busName) {
        if (this._players.has(busName) || this._connecting.has(busName))
            return;
        this._connecting.add(busName);

        try {
            const flags = Gio.DBusProxyFlags.DO_NOT_AUTO_START;
            const [root, player] = await Promise.all([
                RootProxy.newAsync(this._bus, busName, MPRIS_PATH, this._cancellable, flags),
                PlayerProxy.newAsync(this._bus, busName, MPRIS_PATH, this._cancellable, flags),
            ]);

            // O player pode ter saído do barramento enquanto conectava.
            if (!this._connecting.delete(busName))
                return;

            const entry = {busName, id: playerIdFromBusName(busName), root, player, anchor: null};
            this._setAnchor(entry, 0);
            entry.propertiesId = player.connect('g-properties-changed',
                (_proxy, changed) => this._onPropertiesChanged(entry, changed));
            entry.seekedId = player.connectSignal('Seeked', (_proxy, _sender, [position]) => {
                this._setAnchor(entry, Number(position));
                this._notify();
            });

            this._players.set(busName, entry);
            this._logger.debug(`player MPRIS conectado: ${busName} (${root.Identity || entry.id})`);
            this._notify();
            this.refreshPosition(busName);
        } catch (e) {
            this._connecting.delete(busName);
            if (!isCancelled(e))
                this._logger.warn(`falha ao conectar ao player ${busName}: ${e.message}`);
        }
    }

    _remove(busName) {
        this._connecting.delete(busName);
        const entry = this._players.get(busName);
        if (!entry)
            return;

        this._players.delete(busName);
        this._disconnect(entry);
        this._logger.debug(`player MPRIS saiu: ${busName}`);
        this._notify();
    }

    _onPropertiesChanged(entry, changed) {
        const keys = Object.keys(changed.deepUnpack());

        if (keys.includes('Metadata')) {
            // Faixa nova começa do zero até a leitura real chegar.
            this._setAnchor(entry, 0);
            this.refreshPosition(entry.busName);
        } else if (keys.includes('PlaybackStatus') || keys.includes('Rate')) {
            // Mantém a continuidade do tempo e confirma com o player.
            const position = estimatePosition(entry.anchor, now());
            this._setAnchor(entry, position);
            this.refreshPosition(entry.busName);
        }

        this._notify();
    }

    _setAnchor(entry, position) {
        entry.anchor = {
            position,
            at: now(),
            playing: entry.player.PlaybackStatus === 'Playing',
            rate: entry.player.Rate || 1,
        };
    }

    _snapshot(entry) {
        return {
            busName: entry.busName,
            id: entry.id,
            identity: entry.root.Identity || entry.id,
            desktopEntry: entry.root.DesktopEntry || '',
            status: entry.player.PlaybackStatus || 'Stopped',
            track: normalizeMetadata(unpackMetadata(entry.player.Metadata)),
            anchor: {...entry.anchor},
            // Ausente no proxy = desconhecido; `canInvoke` trata como permitido.
            can: {
                control: entry.player.CanControl ?? null,
                play: entry.player.CanPlay ?? null,
                pause: entry.player.CanPause ?? null,
                next: entry.player.CanGoNext ?? null,
                previous: entry.player.CanGoPrevious ?? null,
                seek: entry.player.CanSeek ?? null,
            },
        };
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch (e) {
                this._logger.error('observador de players falhou', e);
            }
        }
    }

    _disconnect(entry) {
        try {
            entry.player.disconnect(entry.propertiesId);
            entry.player.disconnectSignal(entry.seekedId);
        } catch (e) {
            this._logger.debug(`proxy de ${entry.busName} já liberado: ${e.message}`);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._bus.signal_unsubscribe(this._ownerChangedId);
        for (const entry of this._players.values())
            this._disconnect(entry);
        this._players.clear();
        this._connecting.clear();
        this._listeners.clear();
    }
}
