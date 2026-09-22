// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras do dock, sem dependências.
 *
 * O comportamento de clique reproduz os padrões do Dash to Dock que o usuário usa
 * (BASELINE-CONFIG.md §3.1: nenhuma chave de clique alterada): clique alterna
 * entre as janelas do app (com uma só em foco, minimiza — como no WinDock),
 * Shift+clique minimiza, clique do meio abre uma janela
 * nova, Ctrl+clique segue o GNOME. Adaptado do Dash to Dock (© micheleg e
 * colaboradores, GPL-2.0-or-later — reuso permitido, LICENSE-AUDIT.md §4).
 */

/** Tamanhos de ícone do dash do GNOME Shell. */
export const ICON_SIZES = [16, 22, 24, 32, 48, 64];

/** O Dash to Dock desenha no máximo quatro pontos por app. */
export const MAX_DOTS = 4;

/** Por quanto tempo a ordem das janelas de um app é lembrada entre cliques. */
export const CYCLE_MEMORY_US = 3e6;

/**
 * Maior tamanho padrão que cabe no espaço por ícone e não passa do limite.
 *
 * @param {number} maxPixels espaço disponível por ícone, em pixels físicos
 * @param {number} cap limite configurado, em pixels lógicos
 * @param {number} [scaleFactor]
 * @returns {number} tamanho lógico; nunca menor que o primeiro da lista
 */
export function pickIconSize(maxPixels, cap, scaleFactor = 1) {
    let size = ICON_SIZES[0];
    for (const candidate of ICON_SIZES) {
        if (candidate <= cap && candidate * scaleFactor <= maxPixels)
            size = candidate;
    }
    return size;
}

/**
 * @param {number} windows janelas abertas do app
 * @returns {number} pontos a desenhar
 */
export function dotsCount(windows) {
    return Math.max(0, Math.min(MAX_DOTS, Math.trunc(Number(windows) || 0)));
}

/**
 * O que um clique num ícone do dock faz.
 *
 * @param {object} click
 * @param {number} click.button 1 esquerdo, 2 meio
 * @param {boolean} [click.shift]
 * @param {boolean} [click.ctrl]
 * @param {boolean} click.running o app tem janelas
 * @param {number} [click.windows] quantas janelas o app tem
 * @param {boolean} click.focused o app tem o foco
 * @param {boolean} click.inOverview a visão geral está aberta
 * @returns {string} 'default' | 'new-window' | 'minimize' | 'cycle' |
 *     'activate-first' | 'app-activate'
 */
export function decideClick({button, shift = false, ctrl = false, running, windows = 1, focused,
    inOverview}) {
    // Ctrl e app fechado: o comportamento do próprio GNOME (abrir/nova janela).
    if (ctrl || !running)
        return 'default';

    if (button === 2)
        return 'new-window';

    if (button === 1) {
        if (shift)
            return 'minimize';
        if (inOverview)
            return 'app-activate';
        if (!focused)
            return 'activate-first';
        // Como no WinDock: app em foco com uma janela minimiza (pedido do usuário,
        // 2026-09-16 — alternar reativava a mesma janela e o clique parecia morto);
        // com várias, alterna entre elas.
        return windows > 1 ? 'cycle' : 'minimize';
    }

    return 'default';
}

/**
 * Próximo passo do "alternar janelas". A lista de janelas é congelada no
 * primeiro clique (índice 1 = a segunda janela, já que a primeira tem o foco) e
 * vale enquanto os cliques forem no mesmo app, com o mesmo número de janelas,
 * sem pausa maior que `ttl`.
 *
 * @param {?{appId: string, count: number, at: number, index: number}} memory
 * @param {string} appId
 * @param {number} count janelas do app agora
 * @param {number} now relógio monotônico, em microssegundos
 * @param {number} [ttl]
 * @returns {{appId: string, count: number, at: number, index: number}} índice 1
 *     indica que a lista deve ser recapturada
 */
export function advanceCycle(memory, appId, count, now, ttl = CYCLE_MEMORY_US) {
    const fresh = memory !== null && memory !== undefined &&
        memory.appId === appId && memory.count === count && now - memory.at <= ttl;
    return {appId, count, at: now, index: fresh ? memory.index + 1 : 1};
}
