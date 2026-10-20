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
    if (tokens.notifications?.compact)
        blocks.push(compactNotificationBlocks());
    if (tokens.menus?.compact)
        blocks.push(compactMenuBlocks());

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

/**
 * Recuo da barra flutuante: `padding` no #panelBox, e não `margin`. O
 * LayoutManager dá ao #panelBox a largura exata do monitor; uma margem esquerda
 * só empurrava a caixa, e a barra passava da borda direita (visto em 2026-09-16:
 * vão de 5 px à esquerda e corte à direita). Por dentro, a largura continua a do
 * monitor e o recuo vale dos dois lados.
 */
function panelBoxBlock(panel) {
    if (!panel.floating)
        return `#panelBox {\n    margin: 0 !important;\n    padding: 0 !important;\n}`;

    const {top, sides, bottom} = panel.margin;
    return [
        '#panelBox {',
        '    margin: 0 !important;',
        `    padding: ${top}px ${sides}px ${bottom}px ${sides}px !important;`,
        '}',
    ].join('\n');
}

function panelBlock(panel) {
    const rules = [
        `height: ${panel.height}px !important;`,
        `min-height: ${panel.height}px !important;`,
        // A margem é só do #panelBox. Temas como o Orchis dão margem ao próprio
        // #panel (2 px), e a barra "colada" ficava descolada da borda.
        'margin: 0 !important;',
    ];

    // Colada à borda, só os cantos de baixo: o topo encosta na tela, e arredondá-lo
    // deixaria um vinco contra a moldura (decisão de 2026-09-20).
    rules.push(panel.floating
        ? `border-radius: ${panel.radius}px !important;`
        : `border-radius: 0 0 ${panel.radius}px ${panel.radius}px !important;`);

    const surface = [];
    if (panel.background) {
        surface.push(`background-color: ${panel.background} !important;`);
        surface.push(panel.borderWidth > 0 && panel.border
            ? `border: ${panel.borderWidth}px solid ${panel.border} !important;`
            : 'border: none !important;');
    }

    if (panel.foreground)
        rules.push(`color: ${panel.foreground} !important;`);

    if (!panel.islands)
        return block('#panel', [...rules, ...surface]);

    // Em ilhas (do WinDock, pedido de 2026-10-07): a faixa fica transparente e o
    // fundo e a borda descem para os três trechos da barra. O vão entre o centro
    // e os lados é o que sobrar da tela; `islandGap` só vale quando eles se
    // encostam.
    rules.push('background-color: transparent !important;');
    rules.push('border: none !important;');
    rules.push('box-shadow: none !important;');
    const half = panel.islandGap / 2;
    return [
        block('#panel', rules),
        block('#panel #panelLeft, #panel #panelCenter, #panel #panelRight', [
            ...surface,
            `border-radius: ${panel.radius}px !important;`,
        ]),
        block('#panel #panelLeft', [`margin-right: ${half}px !important;`]),
        block('#panel #panelCenter', [`margin: 0 ${half}px !important;`]),
        block('#panel #panelRight', [`margin-left: ${half}px !important;`]),
    ].join('\n\n');
}

/**
 * Cards de notificação compactos no menu da data (pedido do usuário, 2026-09-16).
 * Seletores do GNOME 49; valem sobre temas que partem da mesma folha (Orchis).
 */
function compactNotificationBlocks() {
    return [
        block('.message-list', ['width: 26em !important;']),
        block('.message-view', ['spacing: 2px !important;']),
        block('.message', ['padding: 2px !important;', 'border-radius: 8px !important;']),
        block('.message .message-header .message-header-content', [
            'min-height: 1.3em !important;',
            'padding-bottom: 2px !important;',
        ]),
        block('.message .message-box', [
            'padding: 2px 4px !important;',
            'margin: 2px !important;',
            'spacing: 8px !important;',
        ]),
        block('.message .message-box:first-child', ['margin-top: 4px !important;']),
        block('.message .message-box .message-icon', ['icon-size: 32px !important;']),
        block('.message .message-box .message-icon.message-themed-icon', [
            'icon-size: 14px !important;',
            'min-width: 32px !important;',
            'min-height: 32px !important;',
        ]),
        block('.message .message-box .message-content', ['spacing: 0 !important;']),
        block('.message .message-box .message-content .message-body', ['font-size: 0.9em !important;']),
    ].join('\n\n');
}

/** Os itens que só embrulham um cartão nosso: sem respiro, com ou sem menus compactos. */
const CARD_ITEMS = ['media', 'bt', 'weather', 'aiusage', 'removable', 'updates', 'sysmon']
    .map(name => `.gnomecustom-${name}-item`).join(', ');

/**
 * Menus do Shell compactos (pedido do usuário, 2026-10-11): o menu da data com o
 * calendário, os ajustes rápidos e os itens de menu pop-up.
 *
 * A letra encolhe na raiz do menu da data e dos ajustes rápidos, e o que está em
 * `em` vai junto; o resto são as medidas em px do tema do GNOME, por volta de
 * 30% menores. Os itens de menu pop-up só perdem respiro: a letra deles fica,
 * porque os nossos cartões moram em itens assim e têm interruptor próprio
 * (`cards-compact`).
 *
 * Os seletores do dia aparecem nas duas formas: `.calendar .calendar-day` é a
 * do GNOME, `.calendar-day-base` a dos temas derivados de folhas antigas.
 */
function compactMenuBlocks() {
    return [
        block('.datemenu-popover, .quick-settings', ['font-size: 0.9em !important;']),

        // Menu da data.
        block('.datemenu-calendar-column', ['spacing: 4px !important;']),
        block('.datemenu-calendar-column .datemenu-displays-box', ['spacing: 4px !important;']),
        block('.datemenu-today-button', ['padding: 6px !important;']),
        block('.datemenu-today-button .date-label', ['font-size: 1.2em !important;']),
        block('.calendar, .world-clocks-button, .weather-button, .events-button', [
            'padding: 6px !important;',
            'margin: 2px !important;',
        ]),
        block('.calendar .calendar-month-header .calendar-month-label, .calendar-month-label', [
            'padding: 4px 0 !important;',
        ]),
        block('.calendar .calendar-month-header .pager-button', [
            'width: 2.1em !important;',
            'height: 2.1em !important;',
        ]),
        block('.calendar .calendar-day, .calendar-day-base, .calendar-day', [
            'font-size: 0.8em !important;',
            'width: 2.5em !important;',
            'height: 2.5em !important;',
            'margin: 1px !important;',
            'padding: 0 !important;',
        ]),
        block('.calendar .calendar-day-heading, .calendar-day-heading', [
            'font-size: 0.75em !important;',
            'margin: 2px !important;',
            'padding: 2px 4px !important;',
        ]),
        block('.calendar .calendar-week-number, .calendar-week-number', [
            'font-size: 0.75em !important;',
            'margin: 3px !important;',
        ]),
        block('.events-button .events-box .events-list, .weather-button .weather-box, ' +
            '.weather-button .weather-box .weather-header-box', ['spacing: 4px !important;']),
        block('.weather-button .weather-box .weather-grid, .world-clocks-button .world-clocks-grid', [
            'spacing-rows: 3px !important;',
            'spacing-columns: 8px !important;',
        ]),
        block('.weather-button .weather-box .weather-grid .weather-forecast-time', [
            'padding-top: 3px !important;',
            'padding-bottom: 3px !important;',
        ]),
        block('.message-list-controls', [
            'padding: 6px 8px !important;',
            'spacing: 4px !important;',
        ]),

        // Ajustes rápidos.
        block('.quick-settings', ['padding: 12px !important;']),
        block('.quick-settings-grid', [
            'spacing-rows: 8px !important;',
            'spacing-columns: 8px !important;',
        ]),
        block('.quick-toggle, .quick-toggle-has-menu', ['min-height: 2.8em !important;']),
        block('.quick-toggle > StBoxLayout', ['spacing: 6px !important;']),
        block('.quick-settings .icon-button', ['padding: 7px !important;']),
        // Captura, configurações, bloqueio e desligar esticavam até a altura da
        // pílula da bateria, e o redondo do tema virava oval (29 × 36 px, pedido
        // de 2026-10-20). Quadrados da altura da linha, ficam círculos.
        block('.quick-settings-system-item .icon-button', [
            'width: 2.8em !important;',
            'height: 2.8em !important;',
            'padding: 0 !important;',
            'border-radius: 999px !important;',
        ]),
        block('.quick-slider .icon-button, .quick-slider .slider-bin', ['padding: 4px !important;']),
        block('.quick-toggle-menu', ['padding: 8px !important;']),
        block('.quick-toggle-menu .header', ['padding-bottom: 8px !important;']),
        block('.quick-toggle-menu .header .icon', ['padding: 6px !important;']),

        // Menus pop-up em geral.
        block('.popup-menu-content', ['padding: 4px !important;']),
        block('.popup-menu-item', [
            'padding: 5px 9px !important;',
            'spacing: 5px !important;',
        ]),
        block(CARD_ITEMS, ['padding: 0 !important;']),
        block('.popup-separator-menu-item', [
            'padding-top: 2px !important;',
            'padding-bottom: 2px !important;',
        ]),
    ].join('\n\n');
}

/**
 * Regras dos botões do painel.
 *
 * As cores só entram quando há um fundo resolvido, isto é, quando o engine
 * realmente assumiu a cor da barra. Sem isso o painel continua inteiramente com
 * as cores do tema do usuário, e nós mexemos apenas na geometria.
 */
/**
 * Tamanho do texto da barra para um tamanho de ícone, em px com uma casa.
 *
 * @param {number} iconSize
 * @returns {number}
 */
export function panelFontSize(iconSize) {
    return Math.round(iconSize * 11 / 12 * 10) / 10;
}

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

    // Ícones de status com tamanho próprio, qualquer que seja o tema: numa barra
    // baixa com fonte compacta, os 16 px do GNOME pareciam enormes (2026-09-17).
    out.push(block('#panel .panel-button .system-status-icon, #panel .gnomecustom-media-control-icon', [
        `icon-size: ${panel.iconSize}px !important;`,
    ]));
    // O texto acompanha os ícones, na proporção do GNOME (11 pt para 16 px):
    // percentuais, sigla do teclado e relógio ficam todos do mesmo tamanho
    // (pedido do usuário, 2026-10-11). O relógio e a sigla têm regra própria em
    // alguns temas, por isso são citados.
    const text = panelFontSize(panel.iconSize);
    out.push(block('#panel .panel-button, #panel .panel-button .clock, ' +
        '#panel .panel-button .clock-display, #panel .panel-button .panel-status-indicators-box StLabel', [
        `font-size: ${text}px !important;`,
    ]));
    // A mini capa da faixa: 18 px ao lado de ícones de 16.
    const thumb = panel.iconSize + 2;
    out.push(block('#panel .gnomecustom-media-thumb', [
        `width: ${thumb}px !important;`,
        `height: ${thumb}px !important;`,
    ]));
    out.push(block('#panel .gnomecustom-media-thumb-icon', [
        `icon-size: ${Math.max(8, panel.iconSize - 4)}px !important;`,
    ]));

    if (panel.buttonPadding !== null) {
        // O tema dá 12 px de cada lado a cada botão: 24 px de vão entre dois
        // ícones. `-minimum-hpadding` é o que vale quando a barra aperta, e não
        // pode ficar acima do natural.
        const pad = panel.buttonPadding;
        out.push(block('#panel .panel-button', [
            `-natural-hpadding: ${pad}px !important;`,
            `-minimum-hpadding: ${Math.min(pad, 6)}px !important;`,
        ]));
        // Os nossos botões com vários itens (um aparelho ao lado do outro, a capa
        // e o nome da faixa) acompanham, senão ficam folgados ao lado dos demais.
        if (pad < 8) {
            // Os ícones do menu rápido dividem um botão só, e o vão entre eles é o
            // respiro de cada ícone (3 px de cada lado no tema, mais margem).
            out.push(block('#panel .panel-button .system-status-icon', [
                `padding: 0 ${Math.min(3, Math.ceil(pad / 2))}px !important;`,
                'margin: 0 !important;',
            ]));
            out.push(block('#panel .gnomecustom-bt-panel', [`spacing: ${Math.max(4, pad)}px !important;`]));
            out.push(block('#panel .gnomecustom-media-panel', [`spacing: ${Math.max(4, pad)}px !important;`]));
            // O logotipo colorido não tem a classe dos ícones de status e o nome
            // "Aplicações" é texto puro: lado a lado na mesma ilha, só os 2 × pad
            // dos botões os separavam e ficavam colados (pedido de 2026-10-20).
            // Respiro só nos lados que se encaram; 3 px de cada lado ficou largo.
            out.push(block('#panel .panel-button.gnomecustom-logo-button StIcon', [
                'padding: 0 1px 0 0 !important;',
            ]));
            out.push(block('#panel .panel-button.gnomecustom-apps-button .panel-button-label', [
                'padding: 0 0 0 1px !important;',
            ]));
        }
    }

    if (panel.buttonHover || stylingColors) {
        // Temas como o Orchis realçam com `box-shadow: inset` — no relógio, no filho
        // `.clock`, com outro raio. Somado ao nosso fundo, aparecia um contorno
        // duplo. Quando o realce é nosso, o do tema sai.
        out.push(block('#panel .panel-button, #panel .panel-button .clock', [
            'box-shadow: none !important;',
        ]));
        out.push(block('#panel .panel-button:hover .clock, #panel .panel-button:focus .clock, ' +
            '#panel .panel-button:active .clock, #panel .panel-button:checked .clock', [
            'box-shadow: none !important;',
            'background-color: transparent !important;',
        ]));
    }

    if (panel.buttonHover) {
        out.push(block('#panel .panel-button:hover, #panel .panel-button:focus', [
            `background-color: ${panel.buttonHover} !important;`,
            'box-shadow: none !important;',
            `border-radius: ${buttonRadius(panel)}px !important;`,
        ]));
    }

    if (stylingColors) {
        out.push(block('#panel .panel-button:active, #panel .panel-button:checked, ' +
            '#panel .panel-button:overview', [
            `background-color: ${panel.buttonActive} !important;`,
            'box-shadow: none !important;',
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
