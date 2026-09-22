// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {hasLocation} from '../../lib/weather.js';
import {OpenMeteoClient} from '../../services/weather/openmeteo.js';
import {switchRow, spinRow, enumRow, escapeMarkup} from '../widgets.js';

/** Idioma dos nomes na busca (ex. 'pt'), pela configuração do sistema. */
function searchLanguage() {
    const name = GLib.get_language_names().find(lang => /^[a-z]{2}/.test(lang)) ?? 'en';
    return name.slice(0, 2);
}

export class WeatherPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.weather`
     * @param {Function} _ função de tradução
     * @param {object} [options]
     * @param {Function} [options.search] (texto) => Promise<resultados>; os testes injetam um falso
     * @param {object} [options.baseSettings] Gio.Settings base, dono de `weather-enabled`
     */
    constructor(settings, _, {search = null, baseSettings = null} = {}) {
        super({
            title: _('Weather'),
            icon_name: 'weather-few-clouds-symbolic',
        });

        this._settings = settings;
        this._ = _;
        this._client = search ? null : new OpenMeteoClient();
        this._search = search ?? (text => this._client.search(text, searchLanguage()));
        this._searchSerial = 0;
        this._baseSettings = baseSettings;

        this._addEnableGroup();
        this._addLocationGroup();
        this._addOptionsGroup();

        this.connect('destroy', () => {
            this._searchSerial++;
            this._client?.destroy();
            this._client = null;
        });
    }

    /**
     * O liga/desliga do módulo também aqui: só com ele na página Geral, escolher
     * a cidade parecia ativar o clima e nada aparecia (visto em 2026-09-21).
     */
    _addEnableGroup() {
        if (!this._baseSettings)
            return;
        const _ = this._;
        const group = new Adw.PreferencesGroup();
        group.add(switchRow({
            title: _('Show the weather in the top bar'),
            subtitle: _('The same switch as the Weather module on the General page'),
            settings: this._baseSettings,
            key: 'weather-enabled',
        }));
        this.add(group);
    }

    _addLocationGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({
            title: _('City'),
            description: _('Search by the city name (postal codes are not supported) and pick the right one from the list. Data from Open-Meteo, free and without an account.'),
        });

        this._currentRow = new Adw.ActionRow({title: _('Current location')});
        group.add(this._currentRow);

        this._searchRow = new Adw.EntryRow({
            title: _('Search for a city'),
            show_apply_button: true,
        });
        this._searchRow.connect('apply', () => this._runSearch());
        this._searchRow.connect('entry-activated', () => this._runSearch());
        group.add(this._searchRow);

        this._resultsBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            margin_top: 12,
            visible: false,
        });
        group.add(this._resultsBox);

        // Coordenadas: para quando a busca não achar o lugar exato.
        const manual = new Adw.ExpanderRow({
            title: _('Coordinates'),
            subtitle: _('For a place the search does not find'),
        });
        manual.add_row(spinRow({
            title: _('Latitude'),
            subtitle: _('South is negative'),
            settings: this._settings,
            key: 'latitude',
            min: -90,
            max: 90,
            step: 0.01,
            digits: 4,
        }));
        manual.add_row(spinRow({
            title: _('Longitude'),
            subtitle: _('West is negative'),
            settings: this._settings,
            key: 'longitude',
            min: -180,
            max: 180,
            step: 0.01,
            digits: 4,
        }));
        group.add(manual);

        this._syncCurrent();
        const handlers = ['location-name', 'latitude', 'longitude'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._syncCurrent()));
        this._currentRow.connect('destroy', () => handlers.forEach(id => this._settings.disconnect(id)));

        this.add(group);
    }

    _addOptionsGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('Display')});

        group.add(enumRow({
            title: _('Units'),
            settings: this._settings,
            key: 'units',
            options: [
                ['metric', _('Celsius and km/h')],
                ['imperial', _('Fahrenheit and mph')],
            ],
        }));
        group.add(spinRow({
            title: _('Update every'),
            subtitle: _('In minutes'),
            settings: this._settings,
            key: 'refresh-minutes',
            min: 10,
            max: 180,
            step: 5,
        }));
        group.add(enumRow({
            title: _('Position'),
            settings: this._settings,
            key: 'panel-position',
            options: [
                ['left', _('Left')],
                ['center', _('Centre')],
                ['right', _('Right')],
            ],
        }));

        this.add(group);
    }

    _syncCurrent() {
        const _ = this._;
        const lat = this._settings.get_double('latitude');
        const lon = this._settings.get_double('longitude');
        const name = this._settings.get_string('location-name');
        if (!hasLocation(lat, lon)) {
            this._currentRow.subtitle = _('Not set');
            return;
        }
        this._currentRow.subtitle = escapeMarkup(
            `${name || _('Unnamed place')} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    }

    async _runSearch() {
        const _ = this._;
        const text = this._searchRow.text.trim();
        const serial = ++this._searchSerial;
        this._showResults([], _('Searching…'));

        let results;
        try {
            results = await this._search(text);
        } catch (e) {
            if (serial === this._searchSerial)
                this._showResults([], _('The search failed: %s').replace('%s', e.message));
            return;
        }
        if (serial !== this._searchSerial)
            return;   // outra busca começou, ou a página fechou
        this._showResults(results, results.length === 0 ? _('No place found with this name') : null);
    }

    _showResults(results, message) {
        this._resultsBox.remove_all();
        this._resultsBox.visible = Boolean(message) || results.length > 0;

        if (message) {
            this._resultsBox.append(new Adw.ActionRow({title: escapeMarkup(message), activatable: false}));
            return;
        }

        for (const result of results) {
            const row = new Adw.ActionRow({
                title: escapeMarkup(result.name),
                subtitle: escapeMarkup(`${result.detail} · ${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`),
                activatable: true,
            });
            row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
            row.connect('activated', () => this._choose(result));
            this._resultsBox.append(row);
        }
    }

    _choose(result) {
        // Nome antes das coordenadas: o módulo já mostra o nome certo ao receber a previsão.
        this._settings.set_string('location-name', result.name);
        this._settings.set_double('latitude', result.latitude);
        this._settings.set_double('longitude', result.longitude);
        // Escolher a cidade é pedir o clima: com o módulo desligado, ele liga.
        if (this._baseSettings && !this._baseSettings.get_boolean('weather-enabled'))
            this._baseSettings.set_boolean('weather-enabled', true);
        this._searchRow.text = '';
        this._showResults([], null);
        this._resultsBox.visible = false;
    }
}
