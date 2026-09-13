// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Teste de fumaça das páginas de preferências.
 *
 * Executar com `make test-prefs`. Constrói as páginas de verdade — com Adw, Gtk
 * e um `Gio.Settings` real sobre o esquema compilado — mas nunca chama
 * `present()`, então nada aparece na tela.
 *
 * Precisa de um display disponível (Gtk 4 exige um para inicializar) e do
 * gresource do processo de preferências do GNOME Shell, que é onde vive
 * `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`.
 *
 * O alvo do Makefile roda com `GSETTINGS_BACKEND=memory`, então nada é escrito
 * no dconf do usuário — inclusive as leituras de `org.gnome.shell` feitas pela
 * página Avançado devolvem os valores default, e não a sessão real.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const SHELL_PREFS_RESOURCE =
    '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource';
const SCHEMA_ID = 'org.gnome.shell.extensions.gnomecustom';
const UUID = 'gnomeCustom@gfiamoncini.com';

let failures = 0;

function step(name, fn) {
    try {
        fn();
        print(`  ok    ${name}`);
    } catch (e) {
        failures++;
        print(`  FALHA ${name}`);
        print(`        ${e.message}`);
    }
}

// Registrado porque `Adw`/`Gtk` do processo de preferências do Shell trazem
// estilos e tipos daí; as páginas em si não dependem mais desse recurso.
try {
    Gio.resources_register(Gio.Resource.load(SHELL_PREFS_RESOURCE));
} catch (e) {
    print(`  aviso: gresource do Shell não pôde ser carregado (${e.message})`);
}

/** Tradução identidade: o `.po` é validado por `msgfmt`, não aqui. */
const _ = message => message;

if (!Gtk.init_check())
    throw new Error('sem display disponível; Gtk não pôde inicializar');
Adw.init();

const root = GLib.get_current_dir();
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([root, UUID, 'schemas']),
    Gio.SettingsSchemaSource.get_default(), true);
const schema = schemaSource.lookup(SCHEMA_ID, true);
if (!schema)
    throw new Error(`esquema não encontrado: ${SCHEMA_ID}`);

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory') {
    throw new Error(
        'execute com GSETTINGS_BACKEND=memory (use `make test-prefs`) ' +
        'para não escrever no dconf do usuário');
}

const settings = new Gio.Settings({settings_schema: schema});

const metadata = JSON.parse(new TextDecoder().decode(
    Gio.File.new_for_path(GLib.build_filenamev([root, UUID, 'metadata.json']))
        .load_contents(null)[1]));

const {GeneralPage} = await import(`../${UUID}/prefs/pages/general.js`);
const {ThemePage} = await import(`../${UUID}/prefs/pages/theme.js`);
const Presets = await import(`../${UUID}/theme/presets/presets.js`);
const {applyPreset, readPresetValues} = await import(`../${UUID}/theme/presets/apply.js`);
const {PanelPage} = await import(`../${UUID}/prefs/pages/panel.js`);
const {MenuPage} = await import(`../${UUID}/prefs/pages/menu.js`);
const {MediaPage} = await import(`../${UUID}/prefs/pages/media.js`);
const {BluetoothPage} = await import(`../${UUID}/prefs/pages/bluetooth.js`);
const {DockPage} = await import(`../${UUID}/prefs/pages/dock.js`);
const {OverviewPage} = await import(`../${UUID}/prefs/pages/overview.js`);
const {AnimationPage} = await import(`../${UUID}/prefs/pages/animation.js`);
const {AdvancedPage} = await import(`../${UUID}/prefs/pages/advanced.js`);
const {MODULES_INFO} = await import(`../${UUID}/lib/modules-info.js`);

/** Abre um esquema filho (`…gnomecustom.theme`, etc.) do diretório compilado. */
function childSettings(name) {
    const childSchema = schemaSource.lookup(`${SCHEMA_ID}.${name}`, true);
    if (!childSchema)
        throw new Error(`esquema filho não encontrado: ${name}`);
    return new Gio.Settings({settings_schema: childSchema});
}

let general = null;
let advanced = null;

step('GeneralPage é construída', () => {
    general = new GeneralPage(settings, _);
    if (!(general instanceof Adw.PreferencesPage))
        throw new Error('não é uma Adw.PreferencesPage');
});

step('GeneralPage lista uma linha por módulo', () => {
    const rows = descendants(general).filter(w => w instanceof Adw.SwitchRow).length;
    if (rows !== MODULES_INFO.length)
        throw new Error(`esperava ${MODULES_INFO.length} interruptores, achei ${rows}`);
});

step('módulos não implementados ficam insensíveis', () => {
    const pending = MODULES_INFO.filter(info => !info.implemented).length;
    const insensitive = descendants(general)
        .filter(w => w instanceof Adw.SwitchRow && !w.sensitive).length;
    if (insensitive !== pending)
        throw new Error(`esperava ${pending} insensíveis, achei ${insensitive}`);
});

step('o interruptor do módulo implementado reflete o GSettings', () => {
    settings.set_boolean('diagnostics-enabled', false);
    const row = findSwitchRow(general, 'Diagnostics');
    if (row === null)
        throw new Error('linha do Diagnostics não encontrada');
    if (row.active !== false)
        throw new Error('a linha deveria estar desligada');

    settings.set_boolean('diagnostics-enabled', true);
    if (row.active !== true)
        throw new Error('a linha deveria acompanhar a chave');
});

step('o seletor de nível de log escreve na chave', () => {
    const combo = findComboRow(general);
    if (combo === null)
        throw new Error('Adw.ComboRow não encontrada');

    combo.selected = 4;   // 'debug'
    if (settings.get_string('log-level') !== 'debug')
        throw new Error(`chave ficou '${settings.get_string('log-level')}'`);

    settings.set_string('log-level', 'error');
    if (combo.selected !== 1)
        throw new Error(`combo ficou em ${combo.selected}, esperava 1`);
});

step('ThemePage é construída e liga as linhas ao GSettings', () => {
    const settings = childSettings('theme');
    const page = new ThemePage(settings, _);

    const spins = descendants(page).filter(w => w instanceof Adw.SpinRow);
    if (spins.length < 8)
        throw new Error(`esperava ao menos 8 linhas numéricas, achei ${spins.length}`);

    // A altura do painel precisa refletir o valor do esquema (29 no baseline).
    const height = spins.find(row => row.value === 29);
    if (!height)
        throw new Error('nenhuma linha numérica com o valor 29 (altura do painel)');

    settings.set_uint('panel-height', 40);
    if (height.value !== 40)
        throw new Error(`a linha não acompanhou a chave: ${height.value}`);
    settings.reset('panel-height');
});

step('ThemePage lista a paleta em cache', () => {
    const settings = childSettings('theme');
    settings.set_strv('palette', ['#602011', '#af5d3c']);
    const page = new ThemePage(settings, _);

    const titles = descendants(page)
        .filter(w => w instanceof Adw.ActionRow)
        .map(w => w.title);
    if (!titles.includes('#602011'))
        throw new Error(`a paleta não apareceu: ${titles.join(' | ')}`);
    settings.reset('palette');
});

step('presets: aplicar grava as 24 chaves com o tipo certo e de uma vez', () => {
    const settings = childSettings('theme');
    const fedora = Presets.findPreset('fedora');

    let changes = 0;
    const handler = settings.connect('changed', () => changes++);
    applyPreset(settings, fedora);
    settings.disconnect(handler);

    const values = readPresetValues(settings);
    if (Presets.matchPreset(values) !== 'fedora')
        throw new Error(`depois de aplicar, o preset lido foi '${Presets.matchPreset(values)}'`);
    if (settings.get_uint('panel-height') !== 30 || settings.get_double('panel-margin-sides') !== 9)
        throw new Error('tipos u/d não foram gravados corretamente');
    if (settings.get_string('panel-style') !== 'floating')
        throw new Error('enum não foi gravado');
    if (changes === 0)
        throw new Error('nenhuma notificação de mudança');

    for (const key of Presets.PRESET_KEYS)
        settings.reset(key);
    if (Presets.matchPreset(readPresetValues(settings)) !== 'default')
        throw new Error('os defaults do esquema deveriam casar com o preset "default"');
});

step('presets: aplicar não deixa o objeto de quem chama em modo de atraso', () => {
    const settings = childSettings('theme');
    applyPreset(settings, Presets.findPreset('minimal'));

    // Uma edição comum depois do preset precisa chegar ao backend.
    settings.set_uint('panel-height', 41);
    const other = childSettings('theme');
    if (other.get_uint('panel-height') !== 41)
        throw new Error(`edição ficou pendente: outro objeto leu ${other.get_uint('panel-height')}`);
    if (settings.delay_apply)
        throw new Error('o objeto de quem chama ficou em delay-apply');

    for (const key of Presets.PRESET_KEYS)
        settings.reset(key);
});

step('ThemePage: escolher preset aplica, e editar uma opção vira "Personalizado"', () => {
    const settings = childSettings('theme');
    const page = new ThemePage(settings, _);

    const combo = descendants(page).find(w => w instanceof Adw.ComboRow && w.title === 'Look');
    if (!combo)
        throw new Error('linha de preset não encontrada');

    const ids = [...Presets.PRESETS.map(p => p.id), Presets.CUSTOM_PRESET];
    if (combo.model.get_n_items() !== ids.length)
        throw new Error(`esperava ${ids.length} opções, achei ${combo.model.get_n_items()}`);
    if (ids[combo.selected] !== 'default')
        throw new Error(`com os defaults deveria mostrar "default", mostrou '${ids[combo.selected]}'`);

    combo.selected = ids.indexOf('dark');
    if (settings.get_string('background-color').toUpperCase() !== '#1E1E1E' ||
        !settings.get_boolean('style-menus'))
        throw new Error('escolher "dark" não gravou os valores do preset');

    settings.set_uint('panel-height', 44);
    if (ids[combo.selected] !== Presets.CUSTOM_PRESET)
        throw new Error(`editar a altura deveria virar personalizado, ficou '${ids[combo.selected]}'`);

    // Escolher "Personalizado" não muda nada.
    combo.selected = ids.indexOf(Presets.CUSTOM_PRESET);
    if (settings.get_uint('panel-height') !== 44)
        throw new Error('"Personalizado" não deveria gravar valores');

    for (const key of Presets.PRESET_KEYS)
        settings.reset(key);
});

step('ThemePage traz as linhas de superfícies e de bordas de tiling', () => {
    const page = new ThemePage(childSettings('theme'), _);
    const titles = descendants(page)
        .filter(w => w instanceof Adw.PreferencesRow)
        .map(w => w.title);
    for (const wanted of ['Style popup menus', 'Style on-screen displays', 'Style the dock',
        'Border colour', 'Border corner radius']) {
        if (!titles.includes(wanted))
            throw new Error(`linha ausente: ${wanted}`);
    }
});

step('PanelPage é construída', () => {
    const page = new PanelPage(childSettings('panel'), _);
    const switches = descendants(page).filter(w => w instanceof Adw.SwitchRow);
    if (switches.length < 2)
        throw new Error(`esperava 2 interruptores, achei ${switches.length}`);
});

step('MenuPage lista um interruptor por item de menu', () => {
    const page = new MenuPage(childSettings('menu'), _);
    const switches = descendants(page).filter(w => w instanceof Adw.SwitchRow);
    if (switches.length !== 11)
        throw new Error(`esperava 11 itens de menu, achei ${switches.length}`);
});

step('AnimationPage mostra o fator e o aviso de animações desligadas', () => {
    const settings = childSettings('animation');
    const page = new AnimationPage(settings, _);

    if (Math.abs(page.speedRow.value - 0.25) > 1e-9)
        throw new Error(`o fator padrão deveria ser 0.25, veio ${page.speedRow.value}`);
    if (!page.speedRow.subtitle.includes('4'))
        throw new Error(`descrição inesperada do fator: ${page.speedRow.subtitle}`);

    const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    iface.set_boolean('enable-animations', false);
    if (!page.warningRow.visible)
        throw new Error('o aviso deveria aparecer com as animações desligadas');

    iface.set_boolean('enable-animations', true);
    if (page.warningRow.visible)
        throw new Error('o aviso deveria sumir com as animações ligadas');
    iface.reset('enable-animations');
});

step('OverviewPage liga os quatro interruptores às chaves', () => {
    const settings = childSettings('overview');
    const page = new OverviewPage(settings, _);

    const switches = descendants(page).filter(w => w instanceof Adw.SwitchRow);
    if (switches.length !== 4)
        throw new Error(`esperava 4 interruptores, achei ${switches.length}`);
    if (!switches.every(row => row.active))
        throw new Error('todos os recursos deveriam vir ligados');

    settings.set_boolean('hide-search', false);
    if (switches.filter(row => row.active).length !== 3)
        throw new Error('a linha não acompanhou a chave');
    settings.reset('hide-search');
});

step('DockPage liga as linhas às chaves do dock', () => {
    const settings = childSettings('dock');
    const page = new DockPage(settings, _);

    const spins = descendants(page).filter(w => w instanceof Adw.SpinRow);
    if (spins.length !== 3)
        throw new Error(`esperava 3 linhas numéricas, achei ${spins.length}`);

    const size = spins.find(row => row.value === 24);
    if (!size)
        throw new Error('nenhuma linha com o tamanho de ícone padrão (24)');

    settings.set_uint('icon-size', 32);
    if (size.value !== 32)
        throw new Error('a linha não acompanhou a chave');
    settings.reset('icon-size');
});

step('BluetoothPage liga o limite de bateria à chave', () => {
    const settings = childSettings('bluetooth');
    const page = new BluetoothPage(settings, _);

    const spin = descendants(page).find(w => w instanceof Adw.SpinRow);
    if (!spin)
        throw new Error('linha do limite de bateria não encontrada');
    if (spin.value !== 20)
        throw new Error(`o limite padrão deveria ser 20, veio ${spin.value}`);

    settings.set_uint('low-battery-threshold', 35);
    if (spin.value !== 35)
        throw new Error('a linha não acompanhou a chave');
    settings.reset('low-battery-threshold');
});

step('MediaPage traz o Spotify ligado e acompanha a chave', () => {
    const settings = childSettings('media');
    const page = new MediaPage(settings, _);
    const switches = descendants(page).filter(w => w instanceof Adw.SwitchRow);

    const spotify = switches.find(row => row.subtitle === 'spotify');
    if (!spotify)
        throw new Error('a linha do Spotify (padrão) não apareceu');
    if (!spotify.active)
        throw new Error('o Spotify deveria vir ligado');

    spotify.active = false;
    if (settings.get_strv('allowed-players').includes('spotify'))
        throw new Error('desligar a linha deveria tirar o Spotify da lista');

    settings.set_strv('allowed-players', ['spotify']);
    if (!spotify.active)
        throw new Error('a linha deveria acompanhar a chave');
    settings.reset('allowed-players');

    // Spotify + tempo decorrido + fundo da capa.
    if (switches.length < 3)
        throw new Error(`esperava ao menos 3 interruptores, achei ${switches.length}`);
});

step('AdvancedPage é construída', () => {
    advanced = new AdvancedPage(settings, metadata, _);
    if (!(advanced instanceof Adw.PreferencesPage))
        throw new Error('não é uma Adw.PreferencesPage');
});

step('AdvancedPage monta a lista de extensões', () => {
    const titles = descendants(advanced)
        .filter(w => w instanceof Adw.ActionRow && !(w instanceof Adw.SwitchRow))
        .map(w => w.title);
    if (titles.length === 0)
        throw new Error('nenhuma linha na página');
    print(`        linhas: ${titles.join(' | ')}`);
});

step('as páginas podem entrar em uma janela de preferências', () => {
    const window = new Adw.PreferencesWindow();
    window.add(general);
    window.add(new ThemePage(childSettings('theme'), _));
    window.add(new PanelPage(childSettings('panel'), _));
    window.add(new MenuPage(childSettings('menu'), _));
    window.add(new BluetoothPage(childSettings('bluetooth'), _));
    window.add(new MediaPage(childSettings('media'), _));
    window.add(new DockPage(childSettings('dock'), _));
    window.add(new OverviewPage(childSettings('overview'), _));
    window.add(new AnimationPage(childSettings('animation'), _));
    window.add(advanced);
    // Sem present(): nada é exibido.
    window.destroy();
});

/** Todos os descendentes do widget, em profundidade, sem repetição. */
function descendants(widget) {
    const out = [];
    let child = widget.get_first_child?.();
    while (child) {
        out.push(child, ...descendants(child));
        child = child.get_next_sibling();
    }
    return out;
}

function findSwitchRow(page, title) {
    for (const widget of descendants(page)) {
        if (widget instanceof Adw.SwitchRow && widget.title === title)
            return widget;
    }
    return null;
}

function findComboRow(page) {
    for (const widget of descendants(page)) {
        if (widget instanceof Adw.ComboRow)
            return widget;
    }
    return null;
}

print('');
print(failures === 0
    ? 'preferências: todas as verificações passaram'
    : `preferências: ${failures} falha(s)`);
imports.system.exit(failures === 0 ? 0 : 1);
