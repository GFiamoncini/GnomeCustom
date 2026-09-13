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
 * Seletores usados (GNOME 49, conferidos no gnome-shell-dark.css do gresource):
 *   #panelBox                         caixa que posiciona o painel
 *   #panel / .panel-button            o painel e seus botões
 *   .popup-menu-content               corpo de todo menu pop-up do Shell
 *   .popup-menu-item                  item de menu (:hover/:selected/:checked/:active)
 *   .popup-sub-menu                   submenu expandido
 *   .popup-separator-menu-item-separator
 *   .osd-window / .osd-window .level  OSD e sua barra de nível (-barlevel-*)
 *   .gnomecustom-dock …               o dock desta extensão
 *
 * Cada superfície é um bloco independente, ligado pela própria chave
 * (`panel-style`, `style-menus`, `style-osd`, `style-dock`).
 */

/**
 * @param {object} tokens saída de `buildTokens()`
 * @returns {string} CSS; string vazia quando o módulo está desligado
 */
export function generateStylesheet(tokens) {
    if (!tokens.enabled)
        return '';

    const {panel, accent, menu, osd, dock} = tokens;
    const blocks = [
        '/* Gerado pelo GnomeCustom. Não edite: é reescrito a cada mudança. */',
    ];

    if (panel.enabled) {
        blocks.push(panelBoxBlock(panel));
        blocks.push(panelBlock(panel));
        blocks.push(buttonBlock(panel, accent));
    }
    if (menu?.enabled)
        blocks.push(menuBlocks(menu));
    if (osd?.enabled)
        blocks.push(osdBlocks(osd));
    if (dock?.enabled)
        blocks.push(dockBlocks(dock));

    return `${blocks.filter(Boolean).join('\n\n')}\n`;
}

/**
 * Menus pop-up. Cantos sempre; cores só com fundo resolvido.
 *
 * O item ativo e o marcado usam o destaque, como no tema do GNOME — sem isso o
 * foco de teclado some sobre um fundo que não é o esperado pelo tema.
 */
function menuBlocks(menu) {
    const out = [];

    const content = [`border-radius: ${menu.radius}px !important;`];
    if (menu.background) {
        content.push(`background-color: ${menu.background} !important;`);
        content.push(`border: 1px solid ${menu.border} !important;`);
        content.push(`color: ${menu.foreground} !important;`);
    }
    out.push(block('.popup-menu-content', content));

    const item = [`border-radius: ${menu.itemRadius}px !important;`];
    if (menu.foreground)
        item.push(`color: ${menu.foreground} !important;`);
    out.push(block('.popup-menu-item', item));

    if (menu.background) {
        out.push(block('.popup-menu-item:hover, .popup-menu-item:selected, ' +
            '.popup-menu-item:focus', [
            `background-color: ${menu.hover} !important;`,
            `color: ${menu.foreground} !important;`,
        ]));
        out.push(block('.popup-menu-item:active, .popup-menu-item:checked', [
            `background-color: ${menu.active} !important;`,
            `color: ${menu.activeForeground} !important;`,
        ]));
        out.push(block('.popup-sub-menu', [
            `background-color: ${menu.subMenu} !important;`,
        ]));
        out.push(block('.popup-separator-menu-item .popup-separator-menu-item-separator', [
            `background-color: ${menu.separator} !important;`,
        ]));
    }

    return out.filter(Boolean).join('\n\n');
}

/** OSD de volume e brilho, incluindo o número do módulo de volume. */
function osdBlocks(osd) {
    const out = [];

    const windowRules = [`border-radius: ${osd.radius}px !important;`];
    if (osd.background) {
        windowRules.push(`background-color: ${osd.background} !important;`);
        windowRules.push(`border: 1px solid ${osd.border} !important;`);
        windowRules.push(`color: ${osd.foreground} !important;`);
    }
    out.push(block('.osd-window', windowRules));

    if (osd.background) {
        // A barra de nível é desenhada pelo St a partir destas propriedades,
        // não por background-color.
        out.push(block('.osd-window .level', [
            `-barlevel-background-color: ${osd.levelTrack} !important;`,
            `-barlevel-active-background-color: ${osd.levelFill} !important;`,
        ]));
        out.push(block('.osd-window .gnomecustom-osd-number', [
            `color: ${osd.foreground} !important;`,
        ]));
    }

    return out.filter(Boolean).join('\n\n');
}

/**
 * Dock. O fundo em si não sai aqui: o dock o aplica como estilo próprio (com a
 * opacidade das configurações dele), e estilo próprio vence qualquer folha.
 */
function dockBlocks(dock) {
    const out = [
        block('.gnomecustom-dock #dash .dash-background', [
            `border-radius: ${dock.radius}px !important;`,
        ]),
    ];

    if (dock.dot) {
        out.push(block('.gnomecustom-dock-dot', [
            `background-color: ${dock.dot} !important;`,
        ]));
        out.push(block('.gnomecustom-dock-dots.focused .gnomecustom-dock-dot', [
            `background-color: ${dock.dotFocused} !important;`,
        ]));

        const tile = '.gnomecustom-dock #dash .dash-item-container .overview-tile';
        out.push(block(`${tile} .overview-icon`, [
            'background-color: transparent !important;',
        ]));
        out.push(block(`${tile}:hover .overview-icon`, [
            `background-color: ${dock.tileHover} !important;`,
        ]));
        out.push(block(`${tile}:active .overview-icon, ${tile}:focus .overview-icon`, [
            `background-color: ${dock.tileActive} !important;`,
        ]));
    }

    return out.join('\n\n');
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
