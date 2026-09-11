// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Capas de álbum: arquivo local para exibir e cor dominante para o fundo do card.
 *
 * Adaptado do spotify-controller (© 2026 NarkAgni, GPL-3.0-or-later — reuso
 * permitido, ver LICENSE-AUDIT.md §4). O que veio de lá é o modo de fazer: baixar
 * a capa uma vez para um cache em disco, exibir pelo arquivo local e tirar dela a
 * cor do degradê. Aqui toda a I/O é assíncrona (o original grava e lê a imagem de
 * forma síncrona), o arquivo é nomeado pelo hash da URL e a cor sai do mesmo corte
 * mediano usado para o papel de parede.
 *
 * Soup e `replace_contents_bytes_async` usam callback em vez de `Gio._promisify`,
 * pelo mesmo motivo do serviço `mpris`: evitar preparar de novo o que o Shell ou
 * outra extensão já preparou.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';

import '../../core/gio-promises.js';
import {quantize} from '../../theme/engine/quantize.js';

/** Lado da imagem reduzida usada para achar a cor. */
const SAMPLE_SIZE = 48;

/** Capas mantidas em disco. */
const CACHE_LIMIT = 40;

/** Capas lembradas em memória (URL → resultado). */
const MEMORY_LIMIT = 20;

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

function fromCallback(start) {
    return new Promise((resolve, reject) => {
        start((source, result, finish) => {
            try {
                resolve(finish(source, result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export class CoverArtService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 15});
        this._cacheDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomecustom', 'cover-art']));
        this._memory = new Map();
    }

    /**
     * @param {string} url `https://…` ou `file://…`
     * @returns {Promise<?{uri: string, color: ?number[]}>} null quando não há capa
     */
    load(url) {
        if (!url)
            return Promise.resolve(null);
        if (this._memory.has(url))
            return this._memory.get(url);

        const promise = this._load(url).catch(e => {
            this._memory.delete(url);
            if (!isCancelled(e))
                this._logger.warn(`capa indisponível (${url}): ${e.message}`);
            return null;
        });

        this._memory.set(url, promise);
        while (this._memory.size > MEMORY_LIMIT)
            this._memory.delete(this._memory.keys().next().value);
        return promise;
    }

    async _load(url) {
        const file = url.startsWith('file://')
            ? Gio.File.new_for_uri(url)
            : await this._download(url);

        let color = null;
        try {
            color = await this._dominantColor(file);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            this._logger.debug(`sem cor para a capa ${url}: ${e.message}`);
        }

        this._logger.debug(`capa pronta: ${file.get_basename()}`);
        return {uri: file.get_uri(), color};
    }

    async _download(url) {
        if (!/^https?:\/\//i.test(url))
            throw new Error('esquema de URL não suportado');

        const name = `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)}.img`;
        const file = this._cacheDir.get_child(name);
        if (await this._exists(file))
            return file;

        const message = Soup.Message.new('GET', url);
        if (!message)
            throw new Error('URL inválida');

        const bytes = await fromCallback(done => this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable,
            (session, result) => done(session, result, (s, r) => s.send_and_read_finish(r))));
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${message.get_status()}`);

        await this._ensureCacheDir();
        await fromCallback(done => file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable,
            (source, result) => done(source, result, (s, r) => s.replace_contents_finish(r))));

        this._prune().catch(e => {
            if (!isCancelled(e))
                this._logger.debug(`limpeza do cache de capas falhou: ${e.message}`);
        });
        return file;
    }

    async _exists(file) {
        try {
            await file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, this._cancellable);
            return true;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return false;
            throw e;
        }
    }

    /** Cria `~/.cache/gnomecustom/cover-art` um nível por vez, sem I/O síncrona. */
    async _ensureCacheDir() {
        for (const dir of [this._cacheDir.get_parent(), this._cacheDir]) {
            try {
                await fromCallback(done => dir.make_directory_async(GLib.PRIORITY_DEFAULT,
                    this._cancellable,
                    (source, result) => done(source, result, (s, r) => s.make_directory_finish(r))));
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw e;
            }
        }
    }

    /** Cor mais frequente da capa, ignorando transparência e os extremos. */
    async _dominantColor(file) {
        const stream = await file.read_async(GLib.PRIORITY_DEFAULT, this._cancellable);
        const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream, SAMPLE_SIZE, SAMPLE_SIZE, true, this._cancellable);
        stream.close_async(GLib.PRIORITY_DEFAULT, null, null);

        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        const channels = pixbuf.get_n_channels();
        const stride = pixbuf.get_rowstride();
        const data = pixbuf.get_pixels();

        const pixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * stride + x * channels;
                const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
                const alpha = channels === 4 ? data[index + 3] : 255;
                if (alpha < 125 || (r > 245 && g > 245 && b > 245) || (r < 10 && g < 10 && b < 10))
                    continue;
                pixels.push([r, g, b]);
            }
        }

        return pixels.length > 0 ? quantize(pixels, 5)[0].color : null;
    }

    /** Mantém só as capas mais recentes no disco. */
    async _prune() {
        const enumerator = await this._cacheDir.enumerate_children_async(
            'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW, this._cancellable);

        const entries = [];
        let batch;
        while ((batch = await enumerator.next_files_async(50, GLib.PRIORITY_LOW, this._cancellable)).length > 0)
            entries.push(...batch);

        entries.sort((a, b) =>
            b.get_modification_date_time().to_unix() - a.get_modification_date_time().to_unix());

        for (const info of entries.slice(CACHE_LIMIT))
            await this._cacheDir.get_child(info.get_name()).delete_async(GLib.PRIORITY_LOW, this._cancellable);
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._memory.clear();
    }
}
