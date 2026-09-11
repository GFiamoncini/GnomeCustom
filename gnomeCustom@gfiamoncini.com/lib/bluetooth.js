// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras sobre dispositivos Bluetooth, sem dependências.
 *
 * O estado espelha o ObjectManager do BlueZ: um mapa de caminho de objeto para as
 * interfaces que interessam (`Device1` e `Battery1`), com as propriedades já
 * desempacotadas. As funções que alteram o estado recebem os mesmos dados dos
 * sinais `InterfacesAdded`, `InterfacesRemoved` e `PropertiesChanged`, o que deixa
 * a lógica testável sem barramento.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4): nada vem do Bluetooth
 * Battery Indicator, que lê o UPower por um script externo.
 */

export const DEVICE_IFACE = 'org.bluez.Device1';
export const BATTERY_IFACE = 'org.bluez.Battery1';

const TRACKED = [DEVICE_IFACE, BATTERY_IFACE];

/** Nomes que o BlueZ usa e cujo equivalente simbólico tem outro nome. */
const ICON_ALIASES = {'audio-card': 'audio-speakers'};

/**
 * @param {?string} icon valor de `Device1.Icon`, ex. 'audio-headset'
 * @returns {string} nome de ícone simbólico
 */
export function symbolicIcon(icon) {
    const name = typeof icon === 'string' ? icon.trim() : '';
    if (!name)
        return 'bluetooth-active-symbolic';
    return `${ICON_ALIASES[name] ?? name}-symbolic`;
}

/**
 * Aplica `InterfacesAdded` (ou uma entrada de `GetManagedObjects`).
 * Interfaces que não interessam são ignoradas.
 *
 * @param {Map<string, object>} state
 * @param {string} path
 * @param {object} interfaces nome da interface → propriedades
 * @returns {Map<string, object>} o mesmo estado
 */
export function addInterfaces(state, path, interfaces) {
    for (const [name, properties] of Object.entries(interfaces ?? {})) {
        if (!TRACKED.includes(name))
            continue;
        const entry = state.get(path) ?? {};
        entry[name] = {...properties};
        state.set(path, entry);
    }
    return state;
}

/**
 * Aplica `InterfacesRemoved`.
 *
 * @param {Map<string, object>} state
 * @param {string} path
 * @param {string[]} names
 * @returns {Map<string, object>} o mesmo estado
 */
export function removeInterfaces(state, path, names) {
    const entry = state.get(path);
    if (!entry)
        return state;

    for (const name of names)
        delete entry[name];
    if (!entry[DEVICE_IFACE] && !entry[BATTERY_IFACE])
        state.delete(path);
    return state;
}

/**
 * Aplica `PropertiesChanged`. Só atualiza interfaces já conhecidas: as
 * propriedades completas chegam pelo `InterfacesAdded`.
 *
 * @returns {boolean} algo mudou no estado
 */
export function changeProperties(state, path, iface, changed, invalidated = []) {
    const properties = state.get(path)?.[iface];
    if (!properties)
        return false;

    Object.assign(properties, changed);
    for (const key of invalidated)
        delete properties[key];
    return true;
}

/**
 * @param {string} path
 * @param {object} entry interfaces do objeto, com `Device1` presente
 * @returns {{path: string, address: string, name: string, icon: string,
 *     paired: boolean, connected: boolean, battery: ?number}}
 */
export function normalizeDevice(path, entry) {
    const device = entry[DEVICE_IFACE];
    const percentage = entry[BATTERY_IFACE]?.Percentage;

    return {
        path,
        address: String(device.Address ?? ''),
        name: device.Alias || device.Name || device.Address || path,
        icon: symbolicIcon(device.Icon),
        paired: Boolean(device.Paired || device.Bonded),
        connected: Boolean(device.Connected),
        battery: Number.isFinite(percentage)
            ? Math.min(100, Math.max(0, Math.round(percentage)))
            : null,
    };
}

/** @returns {object[]} todos os dispositivos do estado, normalizados */
export function devicesFromState(state) {
    return [...state]
        .filter(([, entry]) => entry[DEVICE_IFACE])
        .map(([path, entry]) => normalizeDevice(path, entry));
}

/**
 * Dispositivos do card e da barra: pareados e conectados, mais os que o usuário
 * acabou de desconectar pelo card (`kept`). Conectados primeiro, depois por nome.
 *
 * @param {object[]} devices
 * @param {Set<string>} [kept] caminhos mantidos mesmo desconectados
 * @returns {object[]}
 */
export function visibleDevices(devices, kept = new Set()) {
    return devices
        .filter(device => device.paired && (device.connected || kept.has(device.path)))
        .sort((a, b) =>
            Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}

/**
 * @param {?number} battery
 * @param {number} threshold 0 desliga o aviso
 * @returns {boolean} a bateria está no limite ou abaixo dele
 */
export function isLowBattery(battery, threshold) {
    return battery !== null && threshold > 0 && battery <= threshold;
}
