// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Processador, memória e rede: as contas, sem tocar no sistema.
 *
 * Do WinDock (pedido do usuário, 2026-10-07): CPU e memória na barra, em
 * porcentagem, e um cartão com o gráfico dos últimos instantes de processador,
 * memória e rede. Aqui entra o texto de `/proc/stat`, `/proc/meminfo` e
 * `/proc/net/dev`, e saem números; quem lê os arquivos é
 * `services/system/sysstats.js`.
 *
 * A placa de vídeo do WinDock ficou de fora: no Linux não há um contador único
 * para Intel, AMD e Nvidia, e o desta máquina (nouveau) não publica uso.
 */

/** Quantas amostras o gráfico guarda. */
export const HISTORY_SIZE = 60;

/**
 * A linha agregada de `/proc/stat`.
 *
 * @param {string} text
 * @returns {?{total: number, idle: number}} em jiffies; null se não houver a linha
 */
export function parseCpuStat(text) {
    const line = String(text ?? '').split('\n').find(l => l.startsWith('cpu '));
    if (!line)
        return null;
    const fields = line.trim().split(/\s+/).slice(1).map(Number);
    if (fields.length < 4 || fields.some(n => !Number.isFinite(n)))
        return null;
    // user nice system idle iowait irq softirq steal; guest e guest_nice já
    // estão contados em user e nice.
    const total = fields.slice(0, 8).reduce((sum, n) => sum + n, 0);
    const idle = fields[3] + (fields[4] ?? 0);
    return {total, idle};
}

/**
 * Uso do processador entre duas leituras.
 *
 * @param {?{total: number, idle: number}} previous
 * @param {?{total: number, idle: number}} current
 * @returns {?number} de 0 a 100; null sem duas leituras válidas
 */
export function cpuPercent(previous, current) {
    if (!previous || !current)
        return null;
    const total = current.total - previous.total;
    if (total <= 0)
        return null;
    const busy = total - (current.idle - previous.idle);
    return clampPercent(busy / total * 100);
}

/**
 * @param {string} text conteúdo de `/proc/meminfo`
 * @returns {?{total: number, used: number, percent: number,
 *     swapTotal: number, swapUsed: number}} em bytes
 */
export function parseMeminfo(text) {
    const values = new Map();
    for (const line of String(text ?? '').split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match)
            values.set(match[1], Number(match[2]) * 1024);
    }
    const total = values.get('MemTotal');
    if (!total)
        return null;
    // MemAvailable é a conta do próprio kernel do que ainda dá para usar; "livre"
    // deixaria de fora o cache, e a memória pareceria sempre cheia.
    const available = values.get('MemAvailable') ?? values.get('MemFree') ?? 0;
    const used = Math.max(0, total - available);
    const swapTotal = values.get('SwapTotal') ?? 0;
    return {
        total,
        used,
        percent: clampPercent(used / total * 100),
        swapTotal,
        swapUsed: Math.max(0, swapTotal - (values.get('SwapFree') ?? 0)),
    };
}

/**
 * Bytes recebidos e enviados por todas as interfaces de verdade.
 *
 * @param {string} text conteúdo de `/proc/net/dev`
 * @returns {{rx: number, tx: number}}
 */
export function parseNetDev(text) {
    let rx = 0;
    let tx = 0;
    for (const line of String(text ?? '').split('\n')) {
        const match = line.match(/^\s*([^:\s]+):\s*(.+)$/);
        if (!match)
            continue;
        // O laço local e as interfaces virtuais contariam o mesmo tráfego duas
        // vezes (a ponte e o que passa por ela) ou tráfego que não saiu da máquina.
        if (/^(lo|veth|docker|br-|virbr|vnet|tun|tap)/.test(match[1]))
            continue;
        const fields = match[2].trim().split(/\s+/).map(Number);
        if (fields.length < 9)
            continue;
        rx += fields[0];
        tx += fields[8];
    }
    return {rx, tx};
}

/**
 * Velocidade entre duas leituras.
 *
 * @param {?{rx: number, tx: number}} previous
 * @param {?{rx: number, tx: number}} current
 * @param {number} seconds entre as duas
 * @returns {?{down: number, up: number}} bytes por segundo
 */
export function netRate(previous, current, seconds) {
    if (!previous || !current || !(seconds > 0))
        return null;
    // Contador que volta atrás é interface que saiu ou reiniciou: melhor zero
    // que um número negativo.
    return {
        down: Math.max(0, current.rx - previous.rx) / seconds,
        up: Math.max(0, current.tx - previous.tx) / seconds,
    };
}

/**
 * Acrescenta uma amostra, guardando só as últimas `size`.
 *
 * @param {number[]} history
 * @param {number} value
 * @param {number} [size]
 * @returns {number[]} a mesma lista
 */
export function pushSample(history, value, size = HISTORY_SIZE) {
    history.push(value);
    while (history.length > size)
        history.shift();
    return history;
}

/** @param {?number} percent @returns {string} "37%", ou "–" sem leitura */
export function formatPercent(percent) {
    return Number.isFinite(percent) ? `${Math.round(percent)}%` : '–';
}

/**
 * @param {number} bytes
 * @returns {string} "7.4 GiB"; `decimal` troca o ponto pela vírgula da tradução
 */
export function formatBytes(bytes, decimal = '.') {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let value = Math.max(0, Number(bytes) || 0);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace('.', decimal);
    return `${text} ${units[unit]}`;
}

/** @param {number} bytesPerSecond @returns {string} "1.2 MiB/s" */
export function formatRate(bytesPerSecond, decimal = '.') {
    return `${formatBytes(bytesPerSecond, decimal)}/s`;
}

/**
 * A faixa de cor do número na barra, no espírito da pilha: só muda quando diz
 * alguma coisa.
 *
 * @param {?number} percent
 * @returns {'calm'|'warning'|'critical'}
 */
export function severity(percent) {
    if (percent >= 90)
        return 'critical';
    if (percent >= 75)
        return 'warning';
    return 'calm';
}

/**
 * Pontos do gráfico, do mais antigo ao mais novo, encostados à direita: com
 * poucas amostras a linha nasce no canto e cresce para a esquerda.
 *
 * @param {number[]} history
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {number} [options.max] teto fixo (100 para porcentagem); sem ele, o maior valor
 * @param {number} [options.size]
 * @returns {Array<[number, number]>}
 */
export function sparklinePoints(history, width, height, {max = null, size = HISTORY_SIZE} = {}) {
    if (history.length === 0 || width <= 0 || height <= 0)
        return [];
    const top = max ?? Math.max(1, ...history);
    const step = width / Math.max(1, size - 1);
    const first = size - history.length;
    return history.map((value, index) => [
        (first + index) * step,
        height - Math.min(1, Math.max(0, value / top)) * height,
    ]);
}

function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
}
