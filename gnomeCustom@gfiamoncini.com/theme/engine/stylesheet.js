// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Gera a folha de estilo do Shell a partir dos tokens.
 *
 * A folha é **somada** ao tema de Shell do usuário, nunca o substitui (AD-8).
 * Como o tema do usuário já define esses seletores com especificidade alta, as
 * declarações saem com `!important` — é o mesmo caminho que o Open Bar usa, e
 * sem isso um tema como o Orchis simplesmente ignora o que geramos.
 *
 * Só emite regras para tokens resolvidos: quando não há cor de fundo definida
 * nem paleta disponível, a folha contém apenas geometria, e as cores continuam
 * sendo as do tema do usuário.
 *
 * Seletores usados (GNOME 49):
 *   #panelBox         caixa que posiciona o painel
 *   #panel            o painel em si
 *   .panel-button     cada botão do painel
 */

/**
 * @param {object} tokens saída de `buildTokens()`
 * @returns {string} CSS; string vazia quando o módulo está desligado
 */
export function generateStylesheet(tokens) {
    if (!tokens.enabled)
        return '';

    const {panel, accent} = tokens;
    const blocks = [
        '/* Gerado pelo GnomeCustom. Não edite: é reescrito a cada mudança. */',
    ];

    blocks.push(panelBoxBlock(panel));
    blocks.push(panelBlock(panel));
    blocks.push(buttonBlock(panel, accent));

    return `${blocks.filter(Boolean).join('\n\n')}\n`;
}

function panelBoxBlock(panel) {
    if (!panel.floating)
        return `#panelBox {\n    margin: 0 !important;\n}`;

    const {top, sides, bottom} = panel.margin;
    return [
        '#panelBox {',
        `    margin: ${top}px ${sides}px ${bottom}px ${sides}px !important;`,
        '}',
    ].join('\n');
}

function panelBlock(panel) {
    const rules = [
        `height: ${panel.height}px !important;`,
        `min-height: ${panel.height}px !important;`,
    ];

    if (panel.floating)
        rules.push(`border-radius: ${panel.radius}px !important;`);
    else
        rules.push('border-radius: 0 !important;');

    if (panel.background) {
        rules.push(`background-color: ${panel.background} !important;`);
        rules.push(panel.borderWidth > 0 && panel.border
            ? `border: ${panel.borderWidth}px solid ${panel.border} !important;`
            : 'border: none !important;');
    }

    if (panel.foreground)
        rules.push(`color: ${panel.foreground} !important;`);

    return block('#panel', rules);
}

/**
 * Regras dos botões do painel.
 *
 * As cores só entram quando há um fundo resolvido, isto é, quando o engine
 * realmente assumiu a cor da barra. Sem isso o painel continua inteiramente com
 * as cores do tema do usuário, e nós mexemos apenas na geometria.
 */
function buttonBlock(panel, accent) {
    const out = [];
    const stylingColors = Boolean(panel.background);

    const base = [];
    if (panel.foreground)
        base.push(`color: ${panel.foreground} !important;`);
    if (panel.fitts) {
        // Sem padding vertical o botão ocupa toda a altura da barra, então o
        // clique acerta em qualquer ponto da faixa. Com a barra flutuante a
        // borda física da tela continua inalcançável, por definição.
        base.push('padding-top: 0 !important;');
        base.push('padding-bottom: 0 !important;');
        base.push(`height: ${panel.height}px !important;`);
    }
    if (base.length > 0)
        out.push(block('#panel .panel-button', base));

    if (panel.buttonHover) {
        out.push(block('#panel .panel-button:hover, #panel .panel-button:focus', [
            `background-color: ${panel.buttonHover} !important;`,
            `border-radius: ${buttonRadius(panel)}px !important;`,
        ]));
    }

    if (stylingColors) {
        out.push(block('#panel .panel-button:active, #panel .panel-button:checked, ' +
            '#panel .panel-button:overview', [
            `background-color: ${panel.buttonActive} !important;`,
            `color: ${panel.buttonActiveForeground} !important;`,
            `border-radius: ${buttonRadius(panel)}px !important;`,
        ]));

        out.push(block('#panel .panel-button .selected-indicator', [
            `background-color: ${accent.hex} !important;`,
        ]));
    }

    return out.filter(Boolean).join('\n\n');
}

/**
 * Cantos dos botões proporcionais aos da barra, sem passar de metade da altura
 * (o que viraria uma pílula desalinhada em barras baixas).
 */
function buttonRadius(panel) {
    const limit = Math.floor(panel.height / 2);
    const wanted = panel.floating ? Math.max(4, panel.radius - 6) : 6;
    return Math.min(wanted, limit);
}

function block(selector, rules) {
    if (rules.length === 0)
        return '';
    return [`${selector} {`, ...rules.map(rule => `    ${rule}`), '}'].join('\n');
}
