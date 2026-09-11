// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras da visão geral, sem dependências.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4).
 */

/**
 * A janela picture-in-picture do Firefox fica fora da visão geral porque é marcada
 * para não aparecer na barra de tarefas (`skip_taskbar`) — é esse o critério do
 * Shell. Ela é reconhecida justamente assim: uma janela do Firefox com essa marca.
 * O GNOME UI Tune compara o título com uma lista de traduções; o critério aqui é
 * outro e não depende do idioma.
 *
 * @param {{wmClass: string, skipTaskbar: boolean}} window
 * @returns {boolean}
 */
export function isFirefoxPip({wmClass, skipTaskbar}) {
    return Boolean(skipTaskbar) && /firefox/i.test(String(wmClass ?? ''));
}
