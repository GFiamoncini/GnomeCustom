// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Cliente HTTP do Open-Meteo. Só Soup e GLib, sem APIs do Shell: a página de
 * preferências usa o mesmo cliente para a busca de cidades.
 *
 * As chamadas usam callback em vez de `Gio._promisify`, pelo mesmo motivo do
 * serviço de capas (`services/system/cover-art.js`).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {forecastUrl, geocodingUrl, parseForecast, parseGeocoding} from '../../lib/weather.js';

function isCancelled(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

export class OpenMeteoClient {
    /** @param {object} [options] @param {object} [options.logger] */
    constructor({logger = null} = {}) {
        this._logger = logger;
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 20, user_agent: 'GnomeCustom (GNOME Shell extension)'});
    }

    /**
     * @param {{latitude: number, longitude: number, units?: string}} location
     * @returns {Promise<object>} previsão de `parseForecast`
     */
    async forecast(location) {
        const forecast = parseForecast(await this._getJson(forecastUrl(location)));
        if (!forecast)
            throw new Error('resposta do Open-Meteo sem os dados atuais');
        return forecast;
    }

    /**
     * @param {string} name
     * @param {string} [language]
     * @returns {Promise<object[]>} resultados de `parseGeocoding`
     */
    async search(name, language = 'en') {
        const url = geocodingUrl(name, language);
        return url ? parseGeocoding(await this._getJson(url)) : [];
    }

    _getJson(url) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP ${message.get_status()}`);
                        resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    /** @param {Error} error @returns {boolean} o pedido foi cancelado por `destroy()` */
    static isCancelled(error) {
        return isCancelled(error);
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
    }
}
