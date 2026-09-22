// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de clima: condição atual e previsão da cidade escolhida, na barra.
 *
 * Pedido do usuário em 2026-09-21: a base do GNOME Weather (libgweather) não tem
 * a cidade dele. Os dados vêm do Open-Meteo, sem chave de API; a cidade é
 * escolhida nas preferências, pela busca ou por coordenadas.
 *
 * A previsão é pedida ao ativar, a cada `refresh-minutes`, quando a cidade ou as
 * unidades mudam, e pelo botão do card. Se um pedido falha, o card mantém os
 * dados anteriores e avisa que está sem conexão.
 */

import {Module} from '../../core/module.js';
import {hasLocation} from '../../lib/weather.js';
import {WeatherIndicator} from '../../ui/weather/indicator.js';

const ROLE = 'gnomecustom-weather';

/** Depois de uma falha, tenta de novo mais cedo que o intervalo normal. */
const RETRY_MINUTES = 5;

export class WeatherModule extends Module {
    static get id() {
        return 'weather';
    }

    static get title() {
        return 'Weather';
    }

    static get requires() {
        return ['panel', 'weather'];
    }

    enable() {
        this._panel = this.service('panel');
        this._client = this.service('weather');
        this._settings = this.settings.child('weather');
        this._forecast = null;
        this._timer = undefined;
        this._generation = 0;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        for (const key of ['latitude', 'longitude', 'units']) {
            this.signals.connectSetting(this._settings, key, () => {
                this._forecast = null;   // outra cidade ou unidade: os dados antigos não servem
                this._refresh();
            });
        }
        this.signals.connectSetting(this._settings, 'location-name', () => this._render());
        this.signals.connectSetting(this._settings, 'refresh-minutes', () => this._schedule());

        this._refresh();
    }

    disable() {
        this._generation++;   // respostas que chegarem depois são descartadas
        this._stopTimer();
        this._removeIndicator();
        this._panel = null;
        this._client = null;
        this._settings = null;
        this._forecast = null;
    }

    _createIndicator() {
        this._indicator = new WeatherIndicator({
            gettext: this.ctx.gettext,
            onRefresh: () => this._refresh(),
            onSettings: () => this.ctx.extension.openPreferences(),
        });
        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            position: 0,
        });
        this._render();
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
    }

    _location() {
        return {
            name: this._settings.get_string('location-name'),
            latitude: this._settings.get_double('latitude'),
            longitude: this._settings.get_double('longitude'),
            units: this._settings.get_string('units'),
        };
    }

    _render(error = null) {
        if (!this._indicator)
            return;
        const location = this._location();
        if (!hasLocation(location.latitude, location.longitude))
            this._indicator.showNoLocation();
        else if (this._forecast)
            this._indicator.showForecast(location.name, this._forecast, {error});
    }

    async _refresh() {
        this._stopTimer();
        const location = this._location();
        if (!hasLocation(location.latitude, location.longitude)) {
            this._render();
            return;
        }

        const generation = ++this._generation;
        let error = null;
        try {
            const forecast = await this._client.forecast(location);
            if (generation !== this._generation)
                return;   // desativado, ou outro pedido mais novo
            this._forecast = forecast;
            this.log.debug(`clima de ${location.name || 'local sem nome'}: ` +
                `${forecast.current.temperature}${forecast.units.temperature}, ${forecast.current.description}`);
        } catch (e) {
            if (generation !== this._generation || this._client?.constructor.isCancelled(e))
                return;
            error = e.message;
            this.log.warn(`não foi possível atualizar o clima: ${e.message}`);
        }

        this._render(error);
        this._schedule(error ? RETRY_MINUTES : null);
    }

    _schedule(minutes = null) {
        this._stopTimer();
        if (!this._settings)
            return;
        const interval = minutes ?? this._settings.get_uint('refresh-minutes');
        this._timer = this.signals.addTimeout(interval * 60 * 1000, () => {
            this._timer = undefined;
            this._refresh();
            return false;   // GLib.SOURCE_REMOVE: o próximo é agendado pelo _refresh
        }, {label: 'weather-refresh'});
    }

    _stopTimer() {
        if (this._timer === undefined)
            return;
        this.signals.removeSource(this._timer);
        this._timer = undefined;
    }
}
