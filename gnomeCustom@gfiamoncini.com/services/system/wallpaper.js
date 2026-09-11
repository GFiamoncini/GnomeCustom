// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Papel de parede atual e a paleta de cores extraída dele.
 *
 * A imagem é carregada de forma assíncrona e reduzida a uma largura pequena
 * antes da quantização: para descobrir as cores dominantes, 160 pixels de
 * largura dão o mesmo resultado prático que a imagem inteira e custam uma
 * fração do tempo (medido: ~60 ms no papel de parede de referência, contra
 * segundos na resolução original).
 *
 * O serviço não conhece o Theme Engine: ele apenas avisa que a paleta mudou.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import '../../core/gio-promises.js';
import {SignalTracker} from '../../core/signals.js';
import {quantize} from '../../theme/engine/quantize.js';
import {toHex} from '../../theme/engine/color.js';

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';

/** Largura de trabalho para a extração de paleta. */
const SAMPLE_WIDTH = 160;

/** Quantas cores a paleta guarda. */
const PALETTE_SIZE = 12;

/** Espera antes de reextrair, para agrupar mudanças em rajada. */
const DEBOUNCE_MS = 400;

export class WallpaperService {
    /**
     * @param {object} options
     * @param {object} options.logger
     * @param {object} [options.signals] rastreador externo, quando houver
     */
    constructor({logger, signals = null}) {
        this._logger = logger;
        this._signals = signals ?? new SignalTracker({name: 'svc:wallpaper', logger});
        this._ownsSignals = signals === null;

        this._background = new Gio.Settings({schema_id: BACKGROUND_SCHEMA});
        this._interface = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        this._palette = [];
        this._paletteUri = null;
        this._listeners = new Set();
        this._pendingToken = undefined;
        this._extracting = false;

        for (const key of ['picture-uri', 'picture-uri-dark'])
            this._signals.connectSetting(this._background, key, () => this._schedule());
        this._signals.connectSetting(this._interface, 'color-scheme', () => this._schedule());
    }

    /** @returns {boolean} o esquema de cores em uso é o escuro */
    get isDarkMode() {
        return this._interface.get_string('color-scheme') === 'prefer-dark';
    }

    /** @returns {string} URI da imagem em uso, conforme claro/escuro */
    get currentUri() {
        const key = this.isDarkMode ? 'picture-uri-dark' : 'picture-uri';
        const uri = this._background.get_string(key);
        return uri || this._background.get_string('picture-uri');
    }

    /** @returns {string[]} paleta em '#rrggbb', mais frequente primeiro */
    get palette() {
        return [...this._palette];
    }

    /**
     * @param {Function} callback recebe a paleta nova
     * @returns {Function} remove o observador
     */
    onPaletteChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * Extrai a paleta do papel de parede atual.
     *
     * @param {object} [options]
     * @param {boolean} [options.force] refaz mesmo que a URI não tenha mudado
     * @returns {Promise<string[]>}
     */
    async extract({force = false} = {}) {
        const uri = this.currentUri;
        if (!uri) {
            this._logger.debug('nenhum papel de parede definido');
            return [];
        }
        if (!force && uri === this._paletteUri && this._palette.length > 0)
            return this.palette;

        // Arquivos de sequência (slideshow) não são imagens: não há o que ler.
        if (/\.xml$/i.test(uri)) {
            this._logger.info(`papel de parede é uma sequência XML; paleta ignorada: ${uri}`);
            return [];
        }

        if (this._extracting) {
            this._logger.debug('extração já em andamento');
            return this.palette;
        }
        this._extracting = true;

        try {
            const pixels = await this._samplePixels(uri);
            if (pixels.length === 0) {
                this._logger.warn(`nenhum pixel útil em ${uri}`);
                return [];
            }

            const colors = quantize(pixels, PALETTE_SIZE).map(entry => toHex(entry.color));
            this._palette = colors;
            this._paletteUri = uri;
            this._logger.info(
                `paleta extraída de ${uri}: ${colors.slice(0, 3).join(' ')}…`);
            this._notify();
            return this.palette;
        } catch (e) {
            this._logger.error(`falha ao extrair a paleta de ${uri}`, e);
            return [];
        } finally {
            this._extracting = false;
        }
    }

    /**
     * Lê a imagem em escala reduzida e devolve os pixels relevantes.
     *
     * Descarta transparentes e os extremos de branco e preto: são fundos
     * neutros que dominariam a contagem sem dizer nada sobre a cor da imagem.
     *
     * @returns {Promise<Array<number[]>>}
     */
    async _samplePixels(uri) {
        const file = Gio.File.new_for_uri(uri);
        const stream = await file.read_async(null, null);
        const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream, SAMPLE_WIDTH, -1, true, null);
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
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];
                const alpha = channels === 4 ? data[index + 3] : 255;

                if (alpha < 125)
                    continue;
                if (r > 250 && g > 250 && b > 250)
                    continue;
                if (r < 5 && g < 5 && b < 5)
                    continue;

                pixels.push([r, g, b]);
            }
        }
        return pixels;
    }

    _schedule() {
        if (this._pendingToken !== undefined)
            return;

        this._pendingToken = this._signals.addTimeout(DEBOUNCE_MS, () => {
            this._pendingToken = undefined;
            this.extract().catch(e => this._logger.error('extração agendada falhou', e));
            return false;   // GLib.SOURCE_REMOVE
        }, {label: 'wallpaper-debounce'});
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener(this.palette);
            } catch (e) {
                this._logger.error('observador de paleta falhou', e);
            }
        }
    }

    destroy() {
        this._listeners.clear();
        if (this._ownsSignals)
            this._signals.destroy();
        this._background = null;
        this._interface = null;
        this._palette = [];
    }
}
