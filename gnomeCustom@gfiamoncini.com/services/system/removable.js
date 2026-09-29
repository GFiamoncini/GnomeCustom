// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pen-drives, cartões e HDs externos montados, pelo `Gio.VolumeMonitor`, e a
 * remoção segura deles. As regras ficam em `lib/removable.js`.
 *
 * **Sem relógio.** O monitor avisa quando algo entra ou sai; perguntar de
 * tempos em tempos acordaria um HD externo adormecido só para saber que ele
 * continua lá (o mesmo motivo do WinDock). O tamanho de cada montagem é lido
 * uma vez, sem bloquear, e guardado.
 *
 * **A saída é pedida, nunca forçada.** Ejetar vai com um `ShellMountOperation`,
 * o mesmo do Shell e do Nautilus: se um programa ainda usa o aparelho, o GNOME
 * mostra quem é e deixa a pessoa decidir, e o aviso de "já pode desconectar"
 * vem dele. O que o GnomeCustom nunca faz é passar `FORCE` por conta própria.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {ShellMountOperation} from 'resource:///org/gnome/shell/ui/shellMountOperation.js';

import {groupDevices, removalMethod} from '../../lib/removable.js';

const MONITOR_SIGNALS = [
    'mount-added', 'mount-removed', 'mount-changed',
    'volume-added', 'volume-removed', 'volume-changed',
    'drive-connected', 'drive-disconnected', 'drive-changed',
];

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

export class RemovableService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._cancellable = new Gio.Cancellable();
        this._listeners = new Set();
        this._sizes = new Map();      // uri -> bytes (null enquanto a leitura corre)
        this._drives = new Map();     // id do aparelho -> {drive, mounts}
        this._devices = [];
        this._idleId = 0;

        this._monitor = Gio.VolumeMonitor.get();
        this._handlers = MONITOR_SIGNALS.map(signal =>
            this._monitor.connect(signal, () => this._queueRefresh()));

        this._refresh();
    }

    /** @returns {object[]} aparelhos externos montados (`Device` de lib/removable.js) */
    get devices() {
        return this._devices;
    }

    /** @returns {Function} para cancelar a inscrição */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * Abre cada raiz do aparelho no gerenciador de arquivos: um HD com duas
     * partições abre as duas, porque "o aparelho" ali são os dois volumes.
     *
     * @param {string} id
     * @returns {boolean} achou o aparelho
     */
    open(id) {
        const device = this._devices.find(d => d.id === id);
        if (!device)
            return false;
        for (const uri of device.uris) {
            try {
                Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
            } catch (e) {
                this._logger.warn(`não foi possível abrir ${uri}: ${e.message}`);
            }
        }
        return true;
    }

    /**
     * Pede a saída do aparelho. Resolve quando ele já pode ser desconectado;
     * rejeita com o erro do GIO quando não pode (`BUSY`, `FAILED_HANDLED` se a
     * pessoa respondeu ao diálogo do Shell, `CANCELLED`…).
     *
     * @param {string} id
     * @returns {Promise<void>}
     */
    async eject(id) {
        const entry = this._drives.get(id);
        if (!entry)
            throw new Error(`aparelho desconhecido: ${id}`);

        const {drive, mounts} = entry;
        const method = removalMethod({canEject: drive.can_eject(), canStop: drive.can_stop()});
        // O diálogo do Shell pega o ícone e o drive da montagem (pede `get_drive`).
        const operation = new ShellMountOperation(mounts[0]);
        const flags = Gio.MountUnmountFlags.NONE;

        this._logger.info(`removendo ${drive.get_name()} (${method})`);
        try {
            if (method === 'eject') {
                await this._call(drive, 'eject_with_operation', flags, operation.mountOp);
            } else if (method === 'stop') {
                await this._call(drive, 'stop', flags, operation.mountOp);
            } else {
                for (const mount of mounts)
                    await this._call(mount, 'unmount_with_operation', flags, operation.mountOp);
            }
        } finally {
            operation.close();
        }
    }

    /** `obj.method(flags, op, cancellable, cb)` + `method_finish`, como promessa. */
    _call(object, method, flags, mountOp) {
        return new Promise((resolve, reject) => {
            object[method](flags, mountOp, this._cancellable, (source, result) => {
                try {
                    source[`${method}_finish`](result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    // ------------------------------------------------------------ leitura

    /** Uma rajada de sinais (montagem, volume e drive juntos) vira uma leitura só. */
    _queueRefresh() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        const entries = [];
        const drives = new Map();

        for (const mount of this._monitor.get_mounts()) {
            try {
                if (mount.is_shadowed())
                    continue;
                const drive = mount.get_drive();
                if (!drive)
                    continue;   // rede, imagens, telefones: sem aparelho para tirar
                const driveId = drive.get_identifier(Gio.DRIVE_IDENTIFIER_KIND_UNIX_DEVICE) ??
                    drive.get_name();
                const uri = mount.get_root().get_uri();
                entries.push({
                    driveId,
                    driveName: drive.get_name(),
                    removable: drive.is_removable(),
                    canEject: drive.can_eject(),
                    canStop: drive.can_stop(),
                    name: mount.get_name(),
                    uri,
                    size: this._size(mount, uri),
                });
                if (!drives.has(driveId))
                    drives.set(driveId, {drive, mounts: []});
                drives.get(driveId).mounts.push(mount);
            } catch (e) {
                this._logger.debug(`montagem ignorada: ${e.message}`);
            }
        }

        this._devices = groupDevices(entries);
        const known = new Set(this._devices.map(d => d.id));
        this._drives = new Map([...drives].filter(([id]) => known.has(id)));

        // Tamanhos de montagens que saíram não servem mais.
        const uris = new Set(entries.map(e => e.uri));
        for (const uri of this._sizes.keys()) {
            if (!uris.has(uri))
                this._sizes.delete(uri);
        }

        this._notify();
    }

    /** O tamanho guardado, ou null enquanto a leitura (disparada aqui) não volta. */
    _size(mount, uri) {
        if (this._sizes.has(uri))
            return this._sizes.get(uri);

        this._sizes.set(uri, null);
        mount.get_root().query_filesystem_info_async(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE,
            GLib.PRIORITY_LOW, this._cancellable, (root, result) => {
                try {
                    const info = root.query_filesystem_info_finish(result);
                    this._sizes.set(uri, info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE));
                    this._queueRefresh();
                } catch (e) {
                    if (!isCancelled(e))
                        this._logger.debug(`tamanho de ${uri} indisponível: ${e.message}`);
                }
            });
        return null;
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch (e) {
                this._logger.error('observador de dispositivos externos falhou', e);
            }
        }
    }

    destroy() {
        this._cancellable.cancel();
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        for (const id of this._handlers)
            this._monitor.disconnect(id);
        this._handlers = [];
        this._monitor = null;
        this._listeners.clear();
        this._sizes.clear();
        this._drives.clear();
        this._devices = [];
    }
}
