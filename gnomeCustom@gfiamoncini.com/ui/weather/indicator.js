// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de clima da barra superior e o card com a previsão.
 *
 * Na barra: ícone da condição e temperatura. No card, no desenho dos outros cards
 * do projeto (WinDock): cabeçalho com a cidade e a hora da última atualização;
 * temperatura atual grande, condição e detalhes (sensação, umidade, vento); uma
 * faixa com as próximas horas; os próximos dias; e a atribuição do Open-Meteo,
 * exigida pela licença CC BY 4.0 dos dados.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {WEEKDAYS, formatHour, formatTemperature, windDirection} from '../../lib/weather.js';

export class WeatherIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onRefresh pedido de atualização pelo botão do card
     * @param {Function} options.onSettings abrir as preferências
     */
    constructor({gettext, onRefresh, onSettings}) {
        super(0.5, 'GnomeCustom Weather', false);

        this._ = gettext;
        this._callbacks = {onRefresh, onSettings};

        const box = new St.BoxLayout({style_class: 'gnomecustom-weather-panel'});
        this._panelIcon = new St.Icon({
            icon_name: 'weather-few-clouds-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnomecustom-weather-panel-temp',
        });
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._buildCard();
    }

    /** Sem cidade definida: o card convida a escolher uma. */
    showNoLocation() {
        const _ = this._;
        this._panelIcon.icon_name = 'weather-few-clouds-symbolic';
        this._panelLabel.text = '';
        this._title.text = _('Weather');
        this._updated.text = '';
        this._setMessage(_('Choose your city in the settings to see the weather.'), true);
    }

    /**
     * @param {string} locationName
     * @param {object} forecast de `parseForecast`
     * @param {object} [state]
     * @param {?string} [state.error] a última atualização falhou (os dados são os anteriores)
     */
    showForecast(locationName, forecast, {error = null} = {}) {
        const _ = this._;
        const {current, hourly, daily, units} = forecast;

        this._panelIcon.icon_name = current.icon;
        this._panelLabel.text = formatTemperature(current.temperature);

        this._title.text = locationName || _('Weather');
        this._updated.text = error
            ? _('Offline — data from %s').replace('%s', formatHour(current.hour, current.minute))
            : _('Updated at %s').replace('%s', formatHour(current.hour, current.minute));
        this._setMessage(null);

        this._currentIcon.icon_name = current.icon;
        this._currentTemp.text = `${formatTemperature(current.temperature)}${units.temperature.replace('°', '')}`;
        this._currentDescription.text = _(current.description);
        const wind = [current.windSpeed, units.wind, _(windDirection(current.windDirection))]
            .filter(part => part !== null && part !== '').join(' ');
        this._details.text = [
            _('Feels like %s').replace('%s', formatTemperature(current.feelsLike)),
            _('Humidity %s%%').replace('%s', current.humidity ?? '–').replace('%%', '%'),
            _('Wind %s').replace('%s', wind),
        ].join('  ·  ');

        this._hourly.destroy_all_children();
        for (const hour of hourly)
            this._hourly.add_child(this._hourCell(hour));

        this._daily.destroy_all_children();
        daily.forEach((day, index) => this._daily.add_child(this._dayRow(day, index === 0)));
    }

    _buildCard() {
        const _ = this._;
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-weather-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-weather-card',
        });

        // Cabeçalho: cidade e última atualização; à direita, atualizar.
        const header = new St.BoxLayout({style_class: 'gnomecustom-weather-header'});
        const titles = new St.BoxLayout({vertical: true, x_expand: true});
        this._title = new St.Label({style_class: 'gnomecustom-weather-title'});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._updated = new St.Label({style_class: 'gnomecustom-weather-updated'});
        titles.add_child(this._title);
        titles.add_child(this._updated);
        header.add_child(titles);
        header.add_child(this._iconButton('view-refresh-symbolic', _('Update now'),
            () => this._callbacks.onRefresh?.()));
        header.add_child(this._iconButton('emblem-system-symbolic', _('Weather settings'), () => {
            this.menu.close();
            this._callbacks.onSettings?.();
        }));

        // Agora: ícone e temperatura grandes, condição e detalhes.
        this._now = new St.BoxLayout({style_class: 'gnomecustom-weather-now'});
        this._currentIcon = new St.Icon({style_class: 'gnomecustom-weather-now-icon',
            y_align: Clutter.ActorAlign.CENTER});
        const nowText = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._currentTemp = new St.Label({style_class: 'gnomecustom-weather-now-temp'});
        this._currentDescription = new St.Label({style_class: 'gnomecustom-weather-now-description'});
        nowText.add_child(this._currentTemp);
        nowText.add_child(this._currentDescription);
        this._now.add_child(this._currentIcon);
        this._now.add_child(nowText);

        this._details = new St.Label({style_class: 'gnomecustom-weather-details'});
        this._details.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._hourly = new St.BoxLayout({style_class: 'gnomecustom-weather-hourly'});
        this._daily = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-weather-daily'});

        this._message = new St.Label({style_class: 'gnomecustom-weather-message', visible: false});
        this._message.clutter_text.line_wrap = true;

        this._footer = new St.Label({
            text: _('Weather data by Open-Meteo.com (CC BY 4.0)'),
            style_class: 'gnomecustom-weather-footer',
        });

        this._forecastParts = [this._now, this._details, this._hourly, this._daily];
        for (const child of [header, this._message, ...this._forecastParts, this._footer])
            card.add_child(child);

        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    /**
     * @param {?string} text null esconde a mensagem
     * @param {boolean} [replacesForecast] esconde as partes da previsão
     */
    _setMessage(text, replacesForecast = false) {
        this._message.visible = Boolean(text);
        this._message.text = text ?? '';
        for (const part of this._forecastParts)
            part.visible = !replacesForecast;
    }

    _iconButton(iconName, accessibleName, onClick) {
        const button = new St.Button({
            style_class: 'gnomecustom-weather-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, icon_size: 14}),
        });
        button.connect('clicked', onClick);
        return button;
    }

    _hourCell(hour) {
        const cell = new St.BoxLayout({vertical: true, x_expand: true,
            style_class: 'gnomecustom-weather-hour'});
        cell.add_child(new St.Label({text: formatHour(hour.hour),
            style_class: 'gnomecustom-weather-hour-time', x_align: Clutter.ActorAlign.CENTER}));
        cell.add_child(new St.Icon({icon_name: hour.icon, icon_size: 18,
            x_align: Clutter.ActorAlign.CENTER}));
        cell.add_child(new St.Label({text: formatTemperature(hour.temperature),
            style_class: 'gnomecustom-weather-hour-temp', x_align: Clutter.ActorAlign.CENTER}));
        const rain = new St.Label({
            text: hour.precipitation > 0 ? `${hour.precipitation}%` : ' ',
            style_class: 'gnomecustom-weather-rain',
            x_align: Clutter.ActorAlign.CENTER,
        });
        cell.add_child(rain);
        return cell;
    }

    _dayRow(day, today) {
        const _ = this._;
        const row = new St.BoxLayout({style_class: 'gnomecustom-weather-day'});
        row.add_child(new St.Label({
            text: today ? _('Today') : _(WEEKDAYS[day.weekday] ?? ''),
            style_class: 'gnomecustom-weather-day-name',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Icon({icon_name: day.icon, icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(new St.Label({
            text: _(day.description),
            style_class: 'gnomecustom-weather-day-description',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({
            text: day.precipitation > 0 ? `${day.precipitation}%` : '',
            style_class: 'gnomecustom-weather-rain',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({
            text: formatTemperature(day.min),
            style_class: 'gnomecustom-weather-day-min',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(new St.Label({
            text: formatTemperature(day.max),
            style_class: 'gnomecustom-weather-day-max',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        return row;
    }

    destroy() {
        this._callbacks = {};
        super.destroy();
    }
}
