// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Leitura de processador, memória e rede, direto do kernel.
 *
 * São três arquivos do `/proc`, que não tocam o disco: o kernel monta o texto
 * na hora, em microssegundos. Por isso a leitura é síncrona — uma leitura
 * assíncrona custaria mais, em idas e vindas, do que o que ela evita.
 */

import GLib from 'gi://GLib';

import {parseCpuStat, parseMeminfo, parseNetDev} from '../../lib/sysmon.js';

export class SysStatsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._decoder = new TextDecoder();
        this._warned = new Set();
    }

    /**
     * @returns {{cpu: ?object, memory: ?object, net: object, at: number}}
     *     contadores crus e o instante, em microssegundos monotônicos
     */
    read() {
        return {
            cpu: parseCpuStat(this._file('/proc/stat')),
            memory: parseMeminfo(this._file('/proc/meminfo')),
            net: parseNetDev(this._file('/proc/net/dev')),
            at: GLib.get_monotonic_time(),
        };
    }

    /** @returns {number} quantos processadores lógicos */
    get cores() {
        return GLib.get_num_processors();
    }

    _file(path) {
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return this._decoder.decode(bytes);
        } catch (e) {
            if (!this._warned.has(path)) {
                this._warned.add(path);
                this._logger.warn(`não foi possível ler ${path}: ${e.message}`);
            }
            return '';
        }
    }

    destroy() {}
}
