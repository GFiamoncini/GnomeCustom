// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras do botão de atualizações pendentes, sem GIO: como as respostas do
 * PackageKit e do `flatpak` viram a lista do card. A leitura mora em
 * `services/system/updates.js`.
 *
 * Ideia do WinDock (Windows Update + winget), pedida em 2026-09-29, com as
 * mesmas decisões:
 *
 * - **o ícone só existe com pendência**, como o dos dispositivos externos;
 * - **quem atualiza é o GNOME Software.** O botão só avisa: a senha, o
 *   download e o reinício ficam com quem já sabe fazer isso;
 * - **o cache só confirma o que sumiu.** Para achar atualização nova é preciso
 *   baixar as listas de novo; reler o que está guardado serve para tirar do card
 *   o que já foi instalado.
 */

/** Linhas por seção antes do "e mais N". */
export const LIST_LIMIT = 8;

/** Categorias do PackageKit que o card destaca. */
const SECURITY = new Set(['security', 'important', 'critical']);

/**
 * @typedef {object} Package uma atualização do sistema (dnf, pelo PackageKit)
 * @property {string} name
 * @property {string} version
 * @property {boolean} security
 */

/**
 * @typedef {object} FlatpakRef uma atualização do Flatpak
 * @property {string} id 'org.qbittorrent.qBittorrent'
 * @property {string} name 'qBittorrent'
 * @property {string} version '5.2.3', ou o ramo quando o app não diz a versão
 */

/**
 * Os pacotes do PackageKit, um por nome. O mesmo pacote em duas arquiteturas
 * (x86_64 e i686) é uma atualização só para quem lê.
 *
 * @param {Array<{name: string, version?: string, info?: string}>} entries
 * @returns {Package[]} os de segurança primeiro, depois em ordem de nome
 */
export function systemPackages(entries) {
    const byName = new Map();
    for (const entry of entries ?? []) {
        const name = String(entry?.name ?? '').trim();
        if (!name)
            continue;
        const security = SECURITY.has(String(entry.info ?? '').toLowerCase());
        const known = byName.get(name);
        if (known) {
            known.security ||= security;
            continue;
        }
        byName.set(name, {name, version: String(entry.version ?? ''), security});
    }
    return [...byName.values()].sort((a, b) =>
        Number(b.security) - Number(a.security) || compareNames(a.name, b.name));
}

/**
 * A saída de `flatpak remote-ls --updates --columns=application,name,version,branch`:
 * uma linha por ref, colunas separadas por tabulação. A mesma ref instalada no
 * sistema e no usuário aparece uma vez.
 *
 * @param {string} text
 * @returns {FlatpakRef[]} em ordem de nome
 */
export function parseFlatpakList(text) {
    const refs = new Map();
    for (const line of String(text ?? '').split('\n')) {
        const [id = '', name = '', version = '', branch = ''] = line.split('\t').map(s => s.trim());
        if (!id || id.includes(' '))
            continue;   // linha em branco, ou aviso do flatpak no meio da lista
        if (!refs.has(id))
            refs.set(id, {id, name: name || id, version: version || branch});
    }

    // Extensões do runtime repetem o nome: "Mesa" é o GL.default e o CL.default.
    const list = [...refs.values()];
    const names = new Map();
    for (const ref of list)
        names.set(ref.name, (names.get(ref.name) ?? 0) + 1);
    for (const ref of list) {
        if (names.get(ref.name) > 1 && ref.name !== ref.id)
            ref.name = `${ref.name} (${ref.id.split('.').slice(-2).join('.')})`;
    }
    return list.sort((a, b) => compareNames(a.name, b.name) || compareNames(a.id, b.id));
}

/**
 * @param {{system?: Package[], flatpak?: FlatpakRef[]}} updates
 * @returns {number}
 */
export function countPending(updates) {
    return (updates?.system?.length ?? 0) + (updates?.flatpak?.length ?? 0);
}

/**
 * O número ao lado do ícone. Três dígitos não cabem na barra sem empurrar os
 * vizinhos, e "99+" já diz o que importa.
 *
 * @param {number} count
 * @returns {string} '' sem pendência
 */
export function panelCount(count) {
    if (!Number.isFinite(count) || count <= 0)
        return '';
    return count > 99 ? '99+' : String(count);
}

/**
 * O que cabe na seção e quantos ficam de fora.
 *
 * @template T
 * @param {T[]} items
 * @param {number} [limit]
 * @returns {{shown: T[], hidden: number}}
 */
export function visibleItems(items, limit = LIST_LIMIT) {
    const list = items ?? [];
    // Esconder um só não economiza linha: a do "e mais 1" ocuparia o lugar dele.
    if (list.length <= limit + 1)
        return {shown: list, hidden: 0};
    return {shown: list.slice(0, limit), hidden: list.length - limit};
}

/**
 * O resumo para o log.
 *
 * @param {{system?: Package[], flatpak?: FlatpakRef[]}} updates
 * @returns {string} 'nenhuma', 'dnf 5 (2 de segurança), flatpak 3', …
 */
export function summarize(updates) {
    const system = updates?.system ?? [];
    const flatpak = updates?.flatpak ?? [];
    if (system.length === 0 && flatpak.length === 0)
        return 'nenhuma';
    const parts = [];
    if (system.length > 0) {
        const security = system.filter(p => p.security).length;
        parts.push(security > 0 ? `dnf ${system.length} (${security} de segurança)` : `dnf ${system.length}`);
    }
    if (flatpak.length > 0)
        parts.push(`flatpak ${flatpak.length}`);
    return parts.join(', ');
}

/**
 * Milissegundos até a próxima verificação. Mudar o intervalo nas preferências
 * conta a partir da última verificação, e não do momento da mudança: trocar 6 h
 * por 2 h cinco horas depois verifica já.
 *
 * @param {?number} lastMs quando foi a última (null: nunca)
 * @param {number} hours intervalo
 * @param {number} nowMs
 * @param {number} [soonMs] o mínimo, para não verificar no mesmo instante
 * @returns {number}
 */
export function nextCheckDelay(lastMs, hours, nowMs, soonMs = 0) {
    const interval = Math.max(1, hours) * 60 * 60 * 1000;
    if (!Number.isFinite(lastMs))
        return soonMs;
    return Math.max(soonMs, lastMs + interval - nowMs);
}

function compareNames(a, b) {
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
}
