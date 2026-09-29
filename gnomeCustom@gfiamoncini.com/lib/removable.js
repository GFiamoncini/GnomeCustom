// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras do botão de remover dispositivo externo, sem GIO: quem entra na lista
 * e como as montagens viram aparelhos. A leitura mora em
 * `services/system/removable.js`.
 *
 * Ideia do WinDock (2026-09-25), com as mesmas decisões:
 *
 * - **a lista é do aparelho, não da montagem.** Um HD externo com duas
 *   partições aparece uma vez, com as duas ao lado: quem sai da máquina é o
 *   aparelho inteiro;
 * - **só entra o que é externo.** O critério é o do GIO, que vem do UDisks:
 *   drive removível (pen-drive, cartão, e também o HD externo por USB, que o
 *   UDisks marca pelo barramento), ou que se ejeta, ou que se desliga. Os
 *   discos internos montados pelo fstab têm drive sem nada disso e ficam fora —
 *   é o caso da partição de dados desta máquina.
 */

/**
 * @typedef {object} MountEntry uma montagem, já lida do GIO
 * @property {string} driveId identificador estável do aparelho ('/dev/sdb')
 * @property {string} driveName nome do aparelho ('SanDisk Cruzer Blade')
 * @property {boolean} removable `g_drive_is_removable`
 * @property {boolean} canEject
 * @property {boolean} canStop
 * @property {string} name nome da montagem ('KINGSTON')
 * @property {string} uri raiz montada ('file:///run/media/…')
 * @property {?number} size bytes do sistema de arquivos, quando já se sabe
 */

/**
 * @typedef {object} Device um aparelho, como o card mostra
 * @property {string} id
 * @property {string} name
 * @property {string[]} mounts nomes das montagens
 * @property {string[]} uris raízes, na ordem de `mounts`
 * @property {?number} size soma dos tamanhos conhecidos; null se nenhum é
 */

/**
 * @param {{removable?: boolean, canEject?: boolean, canStop?: boolean}} drive
 * @returns {boolean} o aparelho sai da máquina (e não é um disco interno)
 */
export function isExternal(drive) {
    return Boolean(drive?.removable || drive?.canEject || drive?.canStop);
}

/**
 * Agrupa as montagens por aparelho, deixando de fora as internas.
 *
 * @param {MountEntry[]} entries
 * @returns {Device[]} em ordem de nome, e cada aparelho com as montagens em ordem
 */
export function groupDevices(entries) {
    const devices = new Map();
    for (const entry of entries) {
        if (!entry?.driveId || !isExternal(entry))
            continue;
        let device = devices.get(entry.driveId);
        if (!device) {
            device = {id: entry.driveId, name: entry.driveName || entry.name || entry.driveId, parts: []};
            devices.set(entry.driveId, device);
        }
        device.parts.push(entry);
    }

    const byName = (a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
    return [...devices.values()]
        .map(({id, name, parts}) => {
            parts.sort((a, b) => byName(a.name ?? '', b.name ?? ''));
            const sizes = parts.map(p => p.size).filter(size => Number.isFinite(size) && size > 0);
            return {
                id,
                name,
                mounts: parts.map(p => p.name || name),
                uris: parts.map(p => p.uri),
                size: sizes.length > 0 ? sizes.reduce((sum, size) => sum + size, 0) : null,
            };
        })
        .sort((a, b) => byName(a.name, b.name) || byName(a.id, b.id));
}

/**
 * A segunda linha de cada aparelho: as montagens e o tamanho. O nome da
 * montagem que repete o do aparelho não é repetido.
 *
 * @param {Device} device
 * @param {Function} formatSize bytes => texto (o `GLib.format_size` fica com quem chama)
 * @returns {string}
 */
export function describeDevice(device, formatSize) {
    const mounts = device.mounts.filter(name => name && name !== device.name);
    const parts = [];
    if (mounts.length > 0)
        parts.push(mounts.join(', '));
    if (device.size)
        parts.push(formatSize(device.size));
    return parts.join('  ·  ');
}

/**
 * Como um aparelho sai. A ordem é a do painel lateral do GTK (Nautilus):
 *
 * - ejetar, quando o drive se ejeta — o GVfs desmonta tudo, ejeta a mídia e,
 *   se der, desliga o aparelho;
 * - parar, quando só isso existe (HD externo que o UDisks sabe desligar);
 * - desmontar cada montagem, no último caso. O aparelho continua ligado, mas
 *   nada fica por gravar.
 *
 * @param {{canEject?: boolean, canStop?: boolean}} drive
 * @returns {'eject'|'stop'|'unmount'}
 */
export function removalMethod(drive) {
    if (drive?.canEject)
        return 'eject';
    if (drive?.canStop)
        return 'stop';
    return 'unmount';
}

/**
 * O resumo da barra, para a dica e para o log.
 *
 * @param {Device[]} devices
 * @returns {string} 'nenhum', 'SanDisk (KINGSTON)', …
 */
export function summarize(devices) {
    if (devices.length === 0)
        return 'nenhum';
    return devices.map(d => `${d.name} (${d.mounts.join(', ')})`).join('; ');
}
