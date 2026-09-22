// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras do módulo de clima, sem dependências.
 *
 * Os dados vêm do Open-Meteo (https://open-meteo.com): gratuito, sem chave e sem
 * cadastro, com dados sob CC BY 4.0 — a atribuição aparece no card. A busca de
 * cidades usa a API de geocodificação do mesmo serviço, que se apoia no GeoNames
 * (bem mais completo que a base do libgweather, que não tinha a cidade do usuário).
 *
 * Este arquivo só monta URLs e interpreta as respostas; quem faz o pedido HTTP é
 * `services/weather/openmeteo.js`. Ideia inspirada no OpenWeather (GPL-3.0), sem
 * reaproveitar código: aquele usa o OpenWeatherMap, que exige chave de API.
 */

const N_ = message => message;

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Quantas horas o card mostra, a partir da hora atual. */
export const HOURS_SHOWN = 8;

/** Quantos dias o card mostra, incluindo hoje. */
export const DAYS_SHOWN = 7;

const CURRENT_FIELDS = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'weather_code', 'is_day', 'wind_speed_10m', 'wind_direction_10m'];
const HOURLY_FIELDS = ['temperature_2m', 'weather_code', 'precipitation_probability', 'is_day'];
const DAILY_FIELDS = ['weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_probability_max', 'sunrise', 'sunset'];

const query = params => Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

/**
 * @param {object} options
 * @param {number} options.latitude
 * @param {number} options.longitude
 * @param {string} [options.units] 'metric' | 'imperial'
 * @returns {string}
 */
export function forecastUrl({latitude, longitude, units = 'metric'}) {
    const imperial = units === 'imperial';
    return `${FORECAST_URL}?${query({
        latitude: latitude.toFixed(4),
        longitude: longitude.toFixed(4),
        current: CURRENT_FIELDS.join(','),
        hourly: HOURLY_FIELDS.join(','),
        daily: DAILY_FIELDS.join(','),
        timezone: 'auto',
        forecast_days: DAYS_SHOWN,
        temperature_unit: imperial ? 'fahrenheit' : 'celsius',
        wind_speed_unit: imperial ? 'mph' : 'kmh',
    })}`;
}

/**
 * @param {string} name texto digitado
 * @param {string} [language] ex. 'pt'
 * @returns {?string} null quando o texto é curto demais para buscar
 */
export function geocodingUrl(name, language = 'en') {
    const text = String(name ?? '').trim();
    if (text.length < 2)
        return null;
    return `${GEOCODING_URL}?${query({name: text, count: 10, language, format: 'json'})}`;
}

/**
 * Resultados da busca de cidades, prontos para listar.
 *
 * @param {object} json resposta da geocodificação
 * @returns {Array<{name: string, detail: string, latitude: number, longitude: number}>}
 */
export function parseGeocoding(json) {
    return (json?.results ?? [])
        .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.name)
        .map(r => ({
            name: r.name,
            detail: [r.admin2, r.admin1, r.country].filter(Boolean)
                .filter((part, i, all) => all.indexOf(part) === i && part !== r.name)
                .join(', '),
            latitude: r.latitude,
            longitude: r.longitude,
        }));
}

/**
 * Códigos WMO do Open-Meteo → descrição e ícone simbólico do tema.
 * `night` é o ícone quando é noite, se o tema tiver um específico.
 */
const CONDITIONS = [
    [[0], N_('Clear sky'), 'weather-clear-symbolic', 'weather-clear-night-symbolic'],
    [[1], N_('Mainly clear'), 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [[2], N_('Partly cloudy'), 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [[3], N_('Overcast'), 'weather-overcast-symbolic', null],
    [[45, 48], N_('Fog'), 'weather-fog-symbolic', null],
    [[51, 53, 55, 56, 57], N_('Drizzle'), 'weather-showers-scattered-symbolic', null],
    [[61, 63, 66], N_('Rain'), 'weather-showers-symbolic', null],
    [[65, 67], N_('Heavy rain'), 'weather-showers-symbolic', null],
    [[71, 73, 75, 77], N_('Snow'), 'weather-snow-symbolic', null],
    [[80, 81, 82], N_('Rain showers'), 'weather-showers-scattered-symbolic', null],
    [[85, 86], N_('Snow showers'), 'weather-snow-symbolic', null],
    [[95], N_('Thunderstorm'), 'weather-storm-symbolic', null],
    [[96, 99], N_('Thunderstorm with hail'), 'weather-storm-symbolic', null],
];

/**
 * @param {number} code código WMO
 * @param {boolean} [isDay]
 * @returns {{description: string, icon: string}} descrição marcada para tradução
 */
export function describeWeather(code, isDay = true) {
    const entry = CONDITIONS.find(([codes]) => codes.includes(code));
    if (!entry)
        return {description: N_('Unknown'), icon: 'weather-severe-alert-symbolic'};
    const [, description, day, night] = entry;
    return {description, icon: !isDay && night ? night : day};
}

/**
 * @param {number} degrees direção de onde o vento vem
 * @returns {string} ponto cardeal, em inglês (N, NE…), para tradução
 */
export function windDirection(degrees) {
    if (!Number.isFinite(degrees))
        return '';
    const points = [N_('N'), N_('NE'), N_('E'), N_('SE'), N_('S'), N_('SW'), N_('W'), N_('NW')];
    return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** 'AAAA-MM-DDTHH:MM' (hora local do lugar, `timezone=auto`) → partes. */
function localParts(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(text ?? ''));
    if (!m)
        return null;
    return {date: `${m[1]}-${m[2]}-${m[3]}`, hour: m[4] === undefined ? null : Number(m[4]),
        minute: m[5] === undefined ? null : Number(m[5]),
        weekday: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()};
}

const round = value => (Number.isFinite(value) ? Math.round(value) : null);

/**
 * Previsão pronta para exibir.
 *
 * As horas do Open-Meteo vêm na hora local do lugar; a "hora atual" é a de
 * `current.time`, também local — assim o card não depende do fuso da máquina.
 *
 * @param {object} json resposta de `forecastUrl`
 * @returns {?object} null quando a resposta não tem o essencial
 */
export function parseForecast(json) {
    const c = json?.current;
    if (!c || !Number.isFinite(c.temperature_2m))
        return null;

    const units = json.current_units ?? {};
    const now = localParts(c.time);
    const current = {
        time: c.time,
        hour: now?.hour ?? null,
        minute: now?.minute ?? null,
        temperature: round(c.temperature_2m),
        feelsLike: round(c.apparent_temperature),
        humidity: round(c.relative_humidity_2m),
        windSpeed: round(c.wind_speed_10m),
        windDirection: c.wind_direction_10m,
        isDay: c.is_day !== 0,
        ...describeWeather(c.weather_code, c.is_day !== 0),
    };

    const h = json.hourly ?? {};
    const times = h.time ?? [];
    // Primeira hora cheia a partir de agora (a hora corrente, se ainda não acabou).
    const currentHour = String(c.time ?? '').slice(0, 13);
    let start = times.findIndex(t => t.slice(0, 13) >= currentHour);
    if (start < 0)
        start = 0;
    const hourly = times.slice(start + 1, start + 1 + HOURS_SHOWN).map((t, i) => {
        const k = start + 1 + i;
        const isDay = h.is_day?.[k] !== 0;
        return {
            hour: localParts(t)?.hour ?? null,
            temperature: round(h.temperature_2m?.[k]),
            precipitation: round(h.precipitation_probability?.[k]),
            ...describeWeather(h.weather_code?.[k], isDay),
        };
    });

    const d = json.daily ?? {};
    const daily = (d.time ?? []).slice(0, DAYS_SHOWN).map((t, k) => ({
        date: t,
        weekday: localParts(t)?.weekday ?? null,
        max: round(d.temperature_2m_max?.[k]),
        min: round(d.temperature_2m_min?.[k]),
        precipitation: round(d.precipitation_probability_max?.[k]),
        sunrise: d.sunrise?.[k] ?? null,
        sunset: d.sunset?.[k] ?? null,
        ...describeWeather(d.weather_code?.[k], true),
    }));

    return {
        current,
        hourly,
        daily,
        units: {
            temperature: units.temperature_2m ?? '°C',
            wind: units.wind_speed_10m ?? 'km/h',
        },
        timezone: json.timezone ?? '',
    };
}

/**
 * @param {?number} value
 * @returns {string} '19°' (o símbolo da unidade fica no cabeçalho)
 */
export function formatTemperature(value) {
    return Number.isFinite(value) ? `${value}°` : '–';
}

/**
 * @param {?number} hour
 * @param {?number} [minute]
 * @returns {string} '07:00'
 */
export function formatHour(hour, minute = 0) {
    if (!Number.isFinite(hour))
        return '';
    return `${String(hour).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}`;
}

/** Nomes curtos dos dias, domingo primeiro (índice de `getUTCDay`), para tradução. */
export const WEEKDAYS = Object.freeze([N_('Sun'), N_('Mon'), N_('Tue'), N_('Wed'),
    N_('Thu'), N_('Fri'), N_('Sat')]);

/**
 * Coordenadas válidas para pedir a previsão.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {boolean}
 */
export function hasLocation(latitude, longitude) {
    return Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 &&
        !(latitude === 0 && longitude === 0);
}
