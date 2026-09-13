// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Importadores: configuração das 11 extensões originais → chaves do GnomeCustom.
 *
 * Tudo aqui é puro. Cada importador recebe uma função `read(chave, esquema?)` que
 * devolve o **valor efetivo** na extensão original (o que o usuário vê hoje,
 * padrão incluído) e uma função `file(nome)` para os arquivos que o Forge guarda
 * fora do GSettings. Devolve gravações e notas; quem grava é `apply.js`.
 *
 * Por que o valor efetivo, e não só o que o usuário mudou: os padrões das
 * extensões nem sempre são os nossos. O Logo Menu esconde "bloquear" e
 * "energia" por padrão e o nosso menu mostra; importar só o que foi alterado
 * mudaria o comportamento sem o usuário ter pedido.
 *
 * Princípios (docs/MIGRATION.md):
 *  1. nunca escrever nas extensões originais — daqui só sai leitura;
 *  2. o que não tem equivalente vira nota, nunca é descartado em silêncio;
 *  3. importar não liga módulos: isso é decisão separada (perfis, preferências).
 *
 * Cada fonte declara os padrões da extensão na versão instalada no baseline
 * (`defaults`). Eles servem aos testes, que montam `read` a partir dos dumps em
 * `baseline/` sem depender do que estiver instalado; um teste confere os
 * padrões declarados contra os esquemas reais quando eles existem.
 */

import {toHex} from '../../theme/engine/color.js';
import {parseRules, serializeRules} from '../tiling/rules.js';
import {TILING_ACTIONS} from '../tiling/actions.js';

/** Versão do formato de migração, gravada em `migration-version`. */
export const MIGRATION_FORMAT = 1;

const N_ = message => message;

/**
 * @typedef {object} Write
 * @property {string} schema esquema filho ('theme', 'tiling.keybindings'…), '' = base
 * @property {string} key
 * @property {*} value valor em JS; o tipo GVariant vem do esquema de destino
 * @property {string} from chave de origem, para o relatório
 * @property {string} [note]
 */

/**
 * @typedef {object} Note
 * @property {string} from
 * @property {string} reason
 */

class Result {
    constructor() {
        /** @type {Write[]} */
        this.writes = [];
        /** @type {Note[]} */
        this.notes = [];
    }

    set(schema, key, value, from, note = undefined) {
        if (value === undefined) {
            this.notes.push({from, reason: 'valor ausente na origem'});
            return;
        }
        this.writes.push({schema, key, value, from, ...(note ? {note} : {})});
    }

    note(from, reason) {
        this.notes.push({from, reason});
    }
}

/** '0.110' ×3 do Open Bar → '#1C71D8'. */
export function openBarColorToHex(parts) {
    if (!Array.isArray(parts) || parts.length < 3)
        return null;
    const rgb = parts.slice(0, 3).map(Number);
    if (rgb.some(v => !Number.isFinite(v)))
        return null;
    return toHex(rgb.map(v => v * 255)).toUpperCase();
}

/**
 * Espessura, cor e raio de `.window-tiled-border` na folha do Forge.
 *
 * @param {string} css
 * @returns {?{color: string, width: number, radius: number}}
 */
export function parseForgeBorder(css) {
    const block = /\.window-tiled-border\s*\{([^}]*)\}/.exec(css ?? '');
    if (!block)
        return null;

    const prop = name => new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`).exec(block[1])?.[1].trim();
    const width = Number.parseFloat(prop('border-width'));
    const radius = Number.parseFloat(prop('border-radius'));
    const colorText = prop('border-color') ?? '';

    let color = null;
    const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(colorText);
    if (rgb)
        color = toHex(rgb.slice(1, 4).map(Number)).toUpperCase();
    else if (/^#[0-9a-f]{3,6}$/i.test(colorText))
        color = colorText.toUpperCase();

    if (!color || !Number.isFinite(width) || !Number.isFinite(radius))
        return null;
    return {color, width: Math.round(width), radius: Math.round(radius)};
}

/** Comandos do Logo Menu → identificadores .desktop. */
const LOGO_MENU_COMMANDS = Object.freeze({
    'gnome-software': 'org.gnome.Software.desktop',
    'gnome-system-monitor': 'org.gnome.SystemMonitor.desktop',
    'gnome-usage': 'org.gnome.Usage.desktop',
    'resources': 'net.nokyan.Resources.desktop',
    'gnome-terminal': 'org.gnome.Terminal.desktop',
    'kgx': 'org.gnome.Console.desktop',
    'ptyxis': 'org.gnome.Ptyxis.desktop',
    'konsole': 'org.kde.konsole.desktop',
    'plasma-discover': 'org.kde.discover.desktop',
});

/** @type {Array<object>} */
export const SOURCES = Object.freeze([
    {
        id: 'dash-to-dock',
        uuid: 'dash-to-dock@micxgx.gmail.com',
        title: N_('Dash to Dock'),
        schemas: {main: 'org.gnome.shell.extensions.dash-to-dock'},
        defaults: {main: {
            'dash-max-icon-size': 48, 'height-fraction': 0.9, 'background-opacity': 0.8,
            'transparency-mode': 'DEFAULT', 'dock-fixed': false, 'dock-position': 'BOTTOM',
            'preferred-monitor-by-connector': 'primary', 'running-indicator-style': 'DEFAULT',
            'show-show-apps-button': true, 'show-trash': true, 'show-mounts': true,
        }},
        run({read}) {
            const r = new Result();
            r.set('dock', 'icon-size', read('dash-max-icon-size'), 'dash-max-icon-size');
            r.set('dock', 'length-fraction', read('height-fraction'), 'height-fraction');

            const mode = read('transparency-mode');
            if (mode === 'FIXED') {
                r.set('dock', 'background-opacity', read('background-opacity'), 'background-opacity');
            } else if (mode === 'DYNAMIC') {
                r.set('dock', 'background-opacity', read('background-opacity'), 'background-opacity',
                    'opacidade dinâmica virou fixa');
            } else {
                r.note('transparency-mode', 'o Dash to Dock usava a opacidade do tema; a do GnomeCustom foi mantida');
            }

            if (read('dock-fixed') === false)
                r.note('dock-fixed', 'o dock do GnomeCustom é sempre fixo (sem ocultar automaticamente)');
            if (read('dock-position') !== 'BOTTOM')
                r.note('dock-position', 'o dock do GnomeCustom fica sempre embaixo');
            r.note('preferred-monitor-by-connector', 'o dock do GnomeCustom fica sempre no monitor principal');
            if (read('running-indicator-style') !== 'DOTS')
                r.note('running-indicator-style', 'o indicador de janelas abertas é sempre de pontos');
            for (const key of ['show-show-apps-button', 'show-trash', 'show-mounts']) {
                if (read(key) === true)
                    r.note(key, 'item não disponível no dock do GnomeCustom');
            }
            return r;
        },
    },
    {
        id: 'forge',
        uuid: 'forge@jmmaranan.com',
        title: N_('Forge'),
        schemas: {
            main: 'org.gnome.shell.extensions.forge',
            keybindings: 'org.gnome.shell.extensions.forge.keybindings',
        },
        files: ['forge-windows', 'forge-stylesheet'],
        defaults: {main: {
            'tiling-mode-enabled': true, 'auto-split-enabled': true, 'window-gap-size': 4,
            'window-gap-size-increment': 1, 'window-gap-hidden-on-single': false,
            'float-always-on-top-enabled': true, 'focus-border-toggle': true,
            'quick-settings-enabled': true, 'preview-hint-enabled': true, 'workspace-skip-tile': '',
            'stacked-tiling-mode-enabled': true, 'tabbed-tiling-mode-enabled': true,
            'focus-on-hover-enabled': false, 'move-pointer-focus-enabled': false,
        }},
        run({read, file}) {
            const r = new Result();
            const pairs = [
                ['tiling-mode', 'tiling-mode-enabled'],
                ['auto-split', 'auto-split-enabled'],
                ['gap-size', 'window-gap-size'],
                ['gap-increment', 'window-gap-size-increment'],
                ['gap-hidden-on-single', 'window-gap-hidden-on-single'],
                ['float-always-on-top', 'float-always-on-top-enabled'],
                ['focus-border', 'focus-border-toggle'],
                ['quick-settings-toggle', 'quick-settings-enabled'],
            ];
            for (const [ours, theirs] of pairs)
                r.set('tiling', ours, read(theirs), theirs);

            r.set('tiling', 'drag-swap', read('preview-hint-enabled'), 'preview-hint-enabled',
                'a troca por arrasto existe; a prévia durante o arrasto ainda não');

            const skip = String(read('workspace-skip-tile') ?? '')
                .split(',').map(s => Number.parseInt(s, 10)).filter(Number.isInteger);
            r.set('tiling', 'skip-workspaces', skip, 'workspace-skip-tile');

            if (read('stacked-tiling-mode-enabled') === true || read('tabbed-tiling-mode-enabled') === true)
                r.note('stacked/tabbed-tiling-mode-enabled', 'layouts em pilha e em abas não estão disponíveis');
            if (read('focus-on-hover-enabled') === true)
                r.note('focus-on-hover-enabled', 'foco ao passar o ponteiro não está disponível');
            if (read('move-pointer-focus-enabled') === true)
                r.note('move-pointer-focus-enabled', 'mover o ponteiro com o foco não está disponível');

            for (const spec of TILING_ACTIONS) {
                const accels = read(spec.key, 'keybindings');
                if (accels !== undefined)
                    r.set('tiling.keybindings', spec.key, accels, `keybindings/${spec.key}`);
            }

            const windows = file('forge-windows');
            if (windows === null) {
                r.note('windows.json', 'arquivo não encontrado; regras padrão mantidas');
            } else {
                const {rules, droppedById, invalid} = parseRules(windows);
                r.set('tiling', 'window-rules', serializeRules(rules), 'windows.json',
                    `${rules.length} regra(s)`);
                if (droppedById > 0)
                    r.note('windows.json', `${droppedById} regra(s) por id de janela descartada(s) — eram as que quebravam o Super+C`);
                if (invalid > 0)
                    r.note('windows.json', `${invalid} regra(s) inválida(s) ignorada(s)`);
            }

            const border = parseForgeBorder(file('forge-stylesheet'));
            if (border) {
                r.set('theme', 'tiling-border-color', border.color, 'stylesheet.css');
                r.set('theme', 'tiling-border-width', border.width, 'stylesheet.css');
                r.set('theme', 'tiling-border-radius', border.radius, 'stylesheet.css');
            } else {
                r.note('stylesheet.css', 'sem folha personalizada; borda padrão mantida');
            }
            return r;
        },
    },
    {
        id: 'openbar',
        uuid: 'openbar@neuromorph',
        title: N_('Open Bar'),
        schemas: {main: 'org.gnome.shell.extensions.openbar'},
        defaults: {main: {
            'bartype': 'Floating', 'height': 35, 'margin': 6.5, 'bottom-margin': 6.5,
            'bradius': 30, 'bwidth': 2, 'balpha': 0.85, 'bgalpha': 0.95,
            'bgcolor': ['0.125', '0.125', '0.125'], 'hcolor': ['0', '0.7', '0.9'],
            'bg-change': false, 'fitts-widgets': true, 'menustyle': true,
            'dashdock-style': 'Default', 'dbradius': 100,
        }},
        run({read}) {
            const r = new Result();
            const bartype = read('bartype');
            const style = {Floating: 'floating', Mainland: 'attached', Trilands: 'floating', Islands: 'floating'}[bartype];
            if (style) {
                r.set('theme', 'panel-style', style, 'bartype',
                    bartype === 'Trilands' || bartype === 'Islands' ? `“${bartype}” aproximado como barra flutuante` : undefined);
            } else {
                r.note('bartype', `tipo de barra “${bartype}” sem equivalente`);
            }

            const height = read('height');
            r.set('theme', 'panel-height', height === undefined ? undefined : Math.round(height), 'height');
            const margin = read('margin');
            r.set('theme', 'panel-margin-top', margin, 'margin');
            r.set('theme', 'panel-margin-bottom', read('bottom-margin'), 'bottom-margin');
            if (margin !== undefined) {
                // Na barra flutuante do Open Bar as laterais são o triplo da margem.
                r.set('theme', 'panel-margin-sides', Math.round(margin * 3 * 100) / 100, 'margin',
                    'laterais = 3 × margem, como no Open Bar');
            }
            r.set('theme', 'panel-radius', read('bradius'), 'bradius');
            r.set('theme', 'panel-border-width', read('bwidth'), 'bwidth');
            r.set('theme', 'panel-border-alpha', read('balpha'), 'balpha');
            r.set('theme', 'panel-background-alpha', read('bgalpha'), 'bgalpha');

            const fromWallpaper = read('bg-change') === true;
            r.set('theme', 'palette-from-wallpaper', fromWallpaper, 'bg-change');
            if (fromWallpaper) {
                r.set('theme', 'background-color', '', 'bg-change', 'cor vem do papel de parede');
            } else {
                const bg = openBarColorToHex(read('bgcolor'));
                if (bg)
                    r.set('theme', 'background-color', bg, 'bgcolor');
                else
                    r.note('bgcolor', 'cor de fundo ilegível');
            }

            const accent = openBarColorToHex(read('hcolor'));
            if (accent)
                r.set('theme', 'accent-color', accent, 'hcolor');
            r.set('theme', 'fitts-widgets', read('fitts-widgets'), 'fitts-widgets');
            r.set('theme', 'style-menus', read('menustyle'), 'menustyle');

            if (read('dashdock-style') === 'Default') {
                r.set('theme', 'style-dock', false, 'dashdock-style');
            } else {
                r.set('theme', 'style-dock', true, 'dashdock-style', 'as cores do dock seguem a barra');
                r.set('theme', 'dock-radius', read('dbradius'), 'dbradius');
            }

            r.note('(demais ~270 chaves)', 'neon, sombras, cores por item, GTK/Flatpak e afins não têm equivalente');
            return r;
        },
    },
    {
        id: 'user-theme',
        uuid: 'user-theme@gnome-shell-extensions.gcampax.github.com',
        title: N_('User Themes'),
        schemas: {main: 'org.gnome.shell.extensions.user-theme'},
        defaults: {main: {name: ''}},
        run({read}) {
            const r = new Result();
            r.set('theme', 'shell-theme', read('name'), 'name');
            return r;
        },
    },
    {
        id: 'impatience',
        uuid: 'impatience@gfxmonk.net',
        title: N_('Impatience'),
        schemas: {main: 'org.gnome.shell.extensions.net.gfxmonk.impatience'},
        defaults: {main: {'speed-factor': 0.75}},
        run({read}) {
            const r = new Result();
            r.set('animation', 'speed-factor', read('speed-factor'), 'speed-factor');
            return r;
        },
    },
    {
        id: 'gnome-ui-tune',
        uuid: 'gnome-ui-tune@itstime.tech',
        title: N_('GNOME UI Tune'),
        schemas: {main: 'org.gnome.shell.extensions.gnome-ui-tune'},
        defaults: {main: {
            'always-show-thumbnails': true, 'hide-search': true, 'increase-thumbnails-size': '200%',
            'overview-firefox-pip': true, 'restore-thumbnails-background': true,
        }},
        run({read}) {
            const r = new Result();
            r.set('overview', 'always-show-thumbnails', read('always-show-thumbnails'), 'always-show-thumbnails');
            r.set('overview', 'hide-search', read('hide-search'), 'hide-search');
            r.set('overview', 'thumbnails-background', read('restore-thumbnails-background'), 'restore-thumbnails-background');
            r.set('overview', 'show-firefox-pip', read('overview-firefox-pip'), 'overview-firefox-pip');
            if (read('increase-thumbnails-size') !== '100%')
                r.note('increase-thumbnails-size', 'miniaturas maiores não estão disponíveis; o tamanho é o padrão do GNOME');
            return r;
        },
    },
    {
        id: 'logomenu',
        uuid: 'logomenu@aryan_k',
        title: N_('Logo Menu'),
        schemas: {main: 'org.gnome.shell.extensions.logo-menu'},
        defaults: {main: {
            'custom-icon-path': '', 'hide-forcequit': false, 'hide-softwarecentre': false,
            'menu-button-extensions-app': 'org.gnome.Extensions.desktop', 'menu-button-icon-image': 0,
            'menu-button-icon-size': 25, 'menu-button-software-center': 'gnome-software',
            'menu-button-system-monitor': 'gnome-system-monitor', 'menu-button-terminal': 'gnome-terminal',
            'show-activities-button': true, 'show-lockscreen': false, 'show-power-options': false,
            'symbolic-icon': true, 'use-custom-icon': false,
        }},
        run({read}) {
            const r = new Result();
            // O esquema do Logo Menu grava o caminho vazio como a string "''".
            const path = String(read('custom-icon-path') ?? '').replace(/^''$/, '');

            if (read('use-custom-icon') === true && path) {
                r.set('menu', 'icon-source', 'custom', 'use-custom-icon');
                r.set('menu', 'custom-icon-path', path, 'custom-icon-path');
            } else if (read('symbolic-icon') === true) {
                r.set('menu', 'icon-source', 'symbolic', 'symbolic-icon');
            } else {
                r.set('menu', 'icon-source', 'distro', 'symbolic-icon');
                if (read('menu-button-icon-image') !== 0)
                    r.note('menu-button-icon-image', 'o logotipo vem da distribuição; a galeria do Logo Menu não é embarcada');
            }

            r.set('menu', 'icon-size', read('menu-button-icon-size'), 'menu-button-icon-size');
            r.set('panel', 'show-activities', read('show-activities-button'), 'show-activities-button');

            const negate = value => (value === undefined ? undefined : !value);
            r.set('menu', 'show-force-quit', negate(read('hide-forcequit')), 'hide-forcequit');
            r.set('menu', 'show-software', negate(read('hide-softwarecentre')), 'hide-softwarecentre');
            r.set('menu', 'show-lock', read('show-lockscreen'), 'show-lockscreen');
            r.set('menu', 'show-power', read('show-power-options'), 'show-power-options');
            r.set('menu', 'extensions-app', read('menu-button-extensions-app'), 'menu-button-extensions-app');

            const commands = [
                ['software-app', 'menu-button-software-center'],
                ['monitor-app', 'menu-button-system-monitor'],
                ['terminal-app', 'menu-button-terminal'],
            ];
            for (const [ours, theirs] of commands) {
                const command = read(theirs);
                if (ours === 'terminal-app' && command === 'gnome-terminal') {
                    // É o padrão do Logo Menu, não uma escolha — e o Fedora
                    // atual nem traz o GNOME Terminal. Segue o do sistema.
                    r.set('menu', ours, '', theirs, 'padrão do Logo Menu; segue o terminal do sistema');
                    continue;
                }
                const desktop = LOGO_MENU_COMMANDS[command];
                if (desktop)
                    r.set('menu', ours, desktop, theirs);
                else
                    r.note(theirs, `comando “${command}” sem aplicação correspondente conhecida`);
            }
            return r;
        },
    },
    {
        id: 'apps-menu',
        uuid: 'apps-menu@gnome-shell-extensions.gcampax.github.com',
        title: N_('Apps Menu'),
        schemas: {main: 'org.gnome.shell.extensions.apps-menu'},
        defaults: {main: {'apps-menu-toggle-menu': ['<Alt>F1']}},
        run({read}) {
            const r = new Result();
            r.set('panel', 'apps-menu-shortcut', read('apps-menu-toggle-menu'), 'apps-menu-toggle-menu');
            return r;
        },
    },
    {
        id: 'bluetooth-battery',
        uuid: 'bluetooth-battery@michalw.github.com',
        title: N_('Bluetooth Battery Indicator'),
        schemas: {main: 'org.gnome.shell.extensions.bluetooth_battery_indicator'},
        defaults: {main: {'hide-indicator': false, 'interval': 5, 'devices': []}},
        run() {
            const r = new Result();
            r.note('interval', 'o BlueZ avisa as mudanças de bateria; não há intervalo de consulta');
            r.note('hide-indicator', 'a barra mostra os dispositivos conectados, como decidido na fase 3');
            r.note('devices', 'os dispositivos são descobertos pelo BlueZ; a lista não é necessária');
            return r;
        },
    },
    {
        id: 'osd-volume-number',
        uuid: 'osd-volume-number@deminder',
        title: N_('OSD Volume Number'),
        schemas: {main: 'org.gnome.shell.extensions.osd-volume-number'},
        defaults: {main: {'adapt-panel-menu': false, 'icon-position': 'hidden', 'number-position': 'left'}},
        run({read}) {
            const r = new Result();
            if (read('icon-position') !== 'hidden' || read('number-position') !== 'left')
                r.note('icon/number-position', 'o número sempre substitui o ícone');
            if (read('adapt-panel-menu') === true)
                r.note('adapt-panel-menu', 'o menu do painel não é alterado');
            return r;
        },
    },
    {
        id: 'spotify-controls',
        uuid: 'spotify-controls@Sonath21',
        title: N_('Spotify Controls'),
        schemas: {main: 'org.gnome.shell.extensions.spotify-controls'},
        defaults: {main: {
            'position': 'rightmost-left', 'max-width': 0, 'show-playback-controls': true,
            'controls-position': 'right', 'show-spotify-icon': true, 'show-track-info': true,
            'enable-volume-control': true, 'enable-middle-click': true, 'minimize-on-second-click': true,
        }},
        run({read}) {
            const r = new Result();
            const position = String(read('position') ?? '');
            const box = position.startsWith('left') ? 'left' : position === 'center' ? 'center' : 'right';
            r.set('media', 'panel-position', box, 'position');

            const width = read('max-width');
            if (width > 0)
                r.set('media', 'panel-max-width', width, 'max-width');
            else
                r.note('max-width', 'sem limite de largura não existe; o limite do GnomeCustom foi mantido');

            r.note('show-playback-controls', 'o card de mídia não tem controles de reprodução, como decidido na fase 3');
            return r;
        },
    },
]);

/** @returns {?object} */
export function findSource(id) {
    return SOURCES.find(source => source.id === id) ?? null;
}
