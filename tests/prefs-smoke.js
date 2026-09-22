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
import Gdk from 'gi://Gdk?version=4.0';
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

/** Como `step`, para testes que esperam uma promessa; chamar com `await`. */
async function asyncStep(name, fn) {
    try {
        await fn();
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
const {WeatherPage} = await import(`../${UUID}/prefs/pages/weather.js`);
const {captureAccel} = await import(`../${UUID}/prefs/widgets.js`);
const {BluetoothPage} = await import(`../${UUID}/prefs/pages/bluetooth.js`);
const {DockPage} = await import(`../${UUID}/prefs/pages/dock.js`);
const {OverviewPage} = await import(`../${UUID}/prefs/pages/overview.js`);
const {AnimationPage} = await import(`../${UUID}/prefs/pages/animation.js`);
const {TilingPage} = await import(`../${UUID}/prefs/pages/tiling.js`);
const {MigrationPage} = await import(`../${UUID}/prefs/pages/migration.js`);
const Migration = await import(`../${UUID}/lib/migration/importers.js`);
const MigrationApply = await import(`../${UUID}/lib/migration/apply.js`);
const {TILING_ACTIONS} = await import(`../${UUID}/lib/tiling/actions.js`);
const {AdvancedPage} = await import(`../${UUID}/prefs/pages/advanced.js`);
const {buildSidebarWindow} = await import(`../${UUID}/prefs/layout.js`);
const {MODULES_INFO} = await import(`../${UUID}/lib/modules-info.js`);

/** Abre qualquer esquema nosso, '' = base, no backend em memória. */
const openOurs = name => (name ? childSettings(name) : settings);

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
    general = new GeneralPage(settings, _, {openSettings: openOurs});
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

step('ThemePage: cores próprias da barra num grupo com interruptor e opacidade em %', () => {
    const settings = childSettings('theme');
    const page = new ThemePage(settings, _);

    const expander = descendants(page).find(w => w instanceof Adw.ExpanderRow &&
        w.title === 'Choose the bar colours');
    if (!expander)
        throw new Error('grupo "Choose the bar colours" ausente');
    if (expander.enable_expansion)
        throw new Error('deveria nascer desligado');

    expander.enable_expansion = true;
    if (!settings.get_boolean('panel-custom-colors'))
        throw new Error('o interruptor não gravou panel-custom-colors');

    const opacity = descendants(expander).find(w => w instanceof Adw.SpinRow &&
        w.title === 'Background opacity');
    if (!opacity || opacity.value !== 90)
        throw new Error(`opacidade deveria aparecer como 90 %, veio ${opacity?.value}`);
    opacity.value = 65;
    if (Math.abs(settings.get_double('panel-background-alpha') - 0.65) > 1e-9)
        throw new Error(`65 % deveria gravar 0.65, gravou ${settings.get_double('panel-background-alpha')}`);

    settings.reset('panel-custom-colors');
    settings.reset('panel-background-alpha');
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
        'Border colour', 'Window corner radius']) {
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

step('MenuPage lista um interruptor por item de menu, mais o monocromático da galeria', () => {
    const page = new MenuPage(childSettings('menu'), _);
    const switches = descendants(page).filter(w => w instanceof Adw.SwitchRow);
    if (switches.length !== 12)
        throw new Error(`esperava 11 itens de menu + monocromático, achei ${switches.length}`);
});

step('MenuPage: galeria de logotipos escolhe o logo e troca para monocromático', () => {
    const settings = childSettings('menu');
    settings.set_string('icon-source', 'distro');
    const page = new MenuPage(settings, _);

    const gallery = descendants(page).find(w => w instanceof Gtk.FlowBox);
    const count = () => { let n = 0; while (gallery.get_child_at_index(n)) n++; return n; };
    if (count() !== 40)
        throw new Error(`esperava 39 logotipos + "da distribuição", achei ${count()}`);
    if (gallery.get_selected_children()[0]?.get_index() !== 0)
        throw new Error('o padrão vazio deveria selecionar "da distribuição"');

    const archIndex = 1 + 1;   // "da distribuição", AlmaLinux, Arch Linux
    gallery.emit('child-activated', gallery.get_child_at_index(archIndex));
    if (settings.get_string('gallery-logo') !== 'arch' || settings.get_string('icon-source') !== 'gallery')
        throw new Error(`escolher gravou ${settings.get_string('gallery-logo')} / ${settings.get_string('icon-source')}`);

    settings.set_boolean('gallery-monochrome', true);
    const image = descendants(gallery.get_child_at_index(archIndex)).find(w => w instanceof Gtk.Image);
    if (!image.gicon.get_file().get_basename().endsWith('arch-logo-symbolic.svg'))
        throw new Error(`monocromático deveria usar a simbólica, usou ${image.gicon.get_file().get_basename()}`);
    if (gallery.get_selected_children()[0]?.get_index() !== archIndex)
        throw new Error('a seleção deveria sobreviver ao redesenho');

    for (const key of ['icon-source', 'gallery-logo', 'gallery-monochrome'])
        settings.reset(key);
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

step('MediaPage: atalhos de mídia com padrão, limpar, restaurar e aviso de colisão', () => {
    const settings = childSettings('media');
    const tiling = childSettings('tiling.keybindings');
    const page = new MediaPage(settings, _, {openSettings: name => childSettings(name)});

    const rows = descendants(page).filter(w => w instanceof Adw.ActionRow &&
        descendants(w).some(c => c instanceof Gtk.ShortcutLabel));
    if (rows.length !== 3)
        throw new Error(`esperava 3 linhas de atalho, achei ${rows.length}`);

    const row = rows.find(r => r.title === 'Play or pause');
    const label = descendants(row).find(w => w instanceof Gtk.ShortcutLabel);
    if (label.accelerator !== '<Control><Alt><Super>Up')
        throw new Error(`padrão inesperado: ${label.accelerator}`);

    const [reset, clear] = descendants(row).filter(w => w instanceof Gtk.Button &&
        !(w instanceof Gtk.ShortcutLabel));
    if (reset.sensitive)
        throw new Error('restaurar deveria estar desligado no padrão');
    clear.emit('clicked');
    if (settings.get_strv('shortcut-play-pause').length !== 0 || label.accelerator !== '')
        throw new Error('limpar deveria esvaziar a chave e a etiqueta');
    if (!reset.sensitive)
        throw new Error('restaurar deveria ligar depois de mudar');
    reset.emit('clicked');
    if (label.accelerator !== '<Control><Alt><Super>Up')
        throw new Error('restaurar não voltou ao padrão');

    // Mesmo atalho de uma ação do mosaico: a linha avisa.
    settings.set_strv('shortcut-play-pause', tiling.get_strv('window-focus-left'));
    if (!row.has_css_class('warning') || !row.subtitle.includes('window-focus-left'))
        throw new Error(`colisão com o mosaico não avisada: "${row.subtitle}"`);
    settings.reset('shortcut-play-pause');
    if (row.has_css_class('warning'))
        throw new Error('o aviso deveria sumir');
});

step('captura de atalho: Esc cancela, Backspace limpa, modificador espera, letra sozinha recusa', () => {
    const {CONTROL_MASK, ALT_MASK, SUPER_MASK, SHIFT_MASK} = Gdk.ModifierType;
    const check = (keyval, state, expected) => {
        const result = captureAccel(keyval, 0, state);
        if (result.action !== expected.action || (expected.accel && result.accel !== expected.accel))
            throw new Error(`${Gdk.keyval_name(keyval)}: esperava ${JSON.stringify(expected)}, veio ${JSON.stringify(result)}`);
    };
    check(Gdk.KEY_Escape, 0, {action: 'cancel'});
    check(Gdk.KEY_BackSpace, 0, {action: 'clear'});
    check(Gdk.KEY_Super_L, SUPER_MASK, {action: 'wait'});
    check(Gdk.KEY_p, 0, {action: 'invalid'});
    check(Gdk.KEY_P, SHIFT_MASK, {action: 'invalid'});
    check(Gdk.KEY_Up, CONTROL_MASK | ALT_MASK | SUPER_MASK, {action: 'set', accel: '<Control><Alt><Super>Up'});
    check(Gdk.KEY_F9, 0, {action: 'set', accel: 'F9'});
});

await asyncStep('WeatherPage: busca a cidade, escolher grava nome e coordenadas', async () => {
    const settings = childSettings('weather');
    const fake = async text => (text === 'Rio do Sul' ? [
        {name: 'Rio do Sul', detail: 'Santa Catarina, Brasil', latitude: -27.21417, longitude: -49.64306},
        {name: 'Rio do Sul', detail: 'Anitápolis, Santa Catarina, Brasil', latitude: -27.97765, longitude: -49.14109},
    ] : []);
    const base = openOurs('');
    base.set_boolean('weather-enabled', false);
    const page = new WeatherPage(settings, _, {search: fake, baseSettings: base});

    const toggle = descendants(page).find(w => w instanceof Adw.SwitchRow &&
        w.title === 'Show the weather in the top bar');
    if (!toggle || toggle.active)
        throw new Error('a página deveria ter o interruptor do módulo, desligado');

    const current = descendants(page).find(w => w instanceof Adw.ActionRow && w.title === 'Current location');
    if (current.subtitle !== 'Not set')
        throw new Error(`sem cidade deveria dizer "Not set", disse "${current.subtitle}"`);

    const entry = descendants(page).find(w => w instanceof Adw.EntryRow);
    entry.text = 'Rio do Sul';
    await page._runSearch();

    const list = page._resultsBox;
    const results = descendants(list).filter(w => w instanceof Adw.ActionRow && w.activatable);
    if (results.length !== 2)
        throw new Error(`esperava 2 resultados, achei ${results.length}`);
    if (!results[1].subtitle.startsWith('Anitápolis'))
        throw new Error(`o homônimo deveria mostrar o município: ${results[1].subtitle}`);

    results[0].emit('activated');
    if (!base.get_boolean('weather-enabled') || !toggle.active)
        throw new Error('escolher a cidade deveria ligar o módulo');
    if (settings.get_string('location-name') !== 'Rio do Sul' ||
        Math.abs(settings.get_double('latitude') + 27.21417) > 1e-6)
        throw new Error('escolher não gravou a cidade');
    if (!current.subtitle.startsWith('Rio do Sul (-27.2142'))
        throw new Error(`linha atual não acompanhou: ${current.subtitle}`);

    entry.text = 'Lugar Nenhum';
    await page._runSearch();
    const message = descendants(list).find(w => w instanceof Adw.ActionRow);
    if (!message?.title.includes('No place found'))
        throw new Error('busca vazia deveria avisar');

    for (const key of ['location-name', 'latitude', 'longitude'])
        settings.reset(key);
    base.reset('weather-enabled');
});

step('TilingPage: atalhos editáveis, com colisão avisada', () => {
    const bindings = childSettings('tiling.keybindings');
    const page = new TilingPage(childSettings('tiling'), bindings, _);

    const rows = descendants(page).filter(w => w instanceof Adw.ActionRow &&
        descendants(w).some(c => c instanceof Gtk.ShortcutLabel));
    if (rows.length !== 45)
        throw new Error(`esperava 45 linhas de atalho, achei ${rows.length}`);

    const grow = rows.find(r => r.title === 'Grow towards the right');
    const label = descendants(grow).find(w => w instanceof Gtk.ShortcutLabel);
    if (label.accelerator !== '<Shift><Control><Super>Right')
        throw new Error(`padrão inesperado: ${label.accelerator}`);

    // Mesma combinação de "mover para a direita": a linha avisa.
    bindings.set_strv('window-grow-right', bindings.get_strv('window-move-right'));
    if (!grow.has_css_class('warning') || !grow.subtitle.includes('window-move-right'))
        throw new Error(`colisão não avisada: "${grow.subtitle}"`);
    bindings.reset('window-grow-right');
    if (grow.has_css_class('warning'))
        throw new Error('o aviso deveria sumir');
});

step('TilingPage lista as regras padrão e remove uma pelo botão', () => {
    const settings = childSettings('tiling');
    const page = new TilingPage(settings, childSettings('tiling.keybindings'), _);

    const ruleRows = () => descendants(page)
        .filter(w => w instanceof Adw.ActionRow && !(w instanceof Adw.SwitchRow) &&
            (w.subtitle === 'whole application' || w.subtitle?.startsWith('title: ')));
    if (ruleRows().length !== 28)
        throw new Error(`esperava 28 regras, achei ${ruleRows().length}`);

    const calculator = ruleRows().find(row => row.title === 'org.gnome.Calculator');
    if (!calculator)
        throw new Error('regra da Calculadora ausente');
    const trash = descendants(calculator).find(w => w instanceof Gtk.Button);
    trash.emit('clicked');

    const json = settings.get_string('window-rules');
    if (json.includes('org.gnome.Calculator') || JSON.parse(json).length !== 27)
        throw new Error('o botão não removeu a regra');
    if (ruleRows().length !== 27)
        throw new Error('a lista não acompanhou a chave');
    settings.reset('window-rules');
});

step('TilingPage acrescenta regra por classe e título, nunca por id', () => {
    const settings = childSettings('tiling');
    const page = new TilingPage(settings, childSettings('tiling.keybindings'), _);

    const entries = descendants(page).filter(w => w instanceof Adw.EntryRow);
    const [classRow, titleRow] = entries;
    classRow.text = 'google-chrome';
    titleRow.text = 'Picture-in-Picture';
    const add = descendants(titleRow).find(w => w instanceof Gtk.Button && w.label === 'Add rule');
    add.emit('clicked');

    const rules = JSON.parse(settings.get_string('window-rules'));
    const last = rules.at(-1);
    if (last.wmClass !== 'google-chrome' || last.wmTitle !== 'Picture-in-Picture' || 'wmId' in last)
        throw new Error(`regra gravada errada: ${JSON.stringify(last)}`);
    if (classRow.text !== '')
        throw new Error('os campos deveriam ser limpos');
    settings.reset('window-rules');
});

step('TilingPage mostra os atalhos; os indisponíveis ficam insensíveis', () => {
    const page = new TilingPage(childSettings('tiling'), childSettings('tiling.keybindings'), _);
    const labels = descendants(page).filter(w => w instanceof Gtk.ShortcutLabel);
    if (labels.length !== TILING_ACTIONS.length)
        throw new Error(`esperava ${TILING_ACTIONS.length} atalhos, achei ${labels.length}`);

    const split = labels.find(l => l.accelerator === '<Super>v');
    if (!split)
        throw new Error('atalho <Super>v ausente');
    const insensitive = descendants(page)
        .filter(w => w instanceof Adw.ActionRow && !w.sensitive).length;
    if (insensitive !== 3)
        throw new Error(`esperava 3 atalhos indisponíveis, achei ${insensitive}`);
});

step('migração: toVariant ajusta ao intervalo e recusa tipo errado', () => {
    const schema = childSettings('dock').settings_schema;
    const size = MigrationApply.toVariant(schema.get_key('icon-size'), 200);
    if (size.variant.get_uint32() !== 64 || !size.adjusted)
        throw new Error(`esperava 64 ajustado, veio ${size.variant?.print(false)}`);
    const rounded = MigrationApply.toVariant(schema.get_key('icon-size'), 23.6);
    if (rounded.variant.get_uint32() !== 24)
        throw new Error('arredondamento');
    const bad = MigrationApply.toVariant(schema.get_key('icon-size'), 'grande');
    if (bad.variant !== null)
        throw new Error('texto em chave numérica deveria falhar');
});

step('migração: aplicar grava, conta iguais, e desfazer volta exatamente ao anterior', () => {
    const dock = childSettings('dock');
    const theme = childSettings('theme');
    dock.set_uint('icon-size', 32);                 // valor do usuário antes da importação

    const imports = [{
        source: {title: 'Teste'},
        result: {
            writes: [
                {schema: 'dock', key: 'icon-size', value: 48, from: 'dash-max-icon-size'},
                {schema: 'dock', key: 'length-fraction', value: 0.9, from: 'height-fraction'},   // igual ao padrão
                {schema: 'theme', key: 'shell-theme', value: 'Orchis', from: 'name'},
                {schema: 'theme', key: 'nao-existe', value: 1, from: 'x'},
            ],
            notes: [{from: 'dock-fixed', reason: 'sempre fixo'}],
        },
    }];
    const report = MigrationApply.applyImports(imports, openOurs);

    if (report.changed.length !== 2 || report.unchanged !== 1 || report.failed.length !== 1)
        throw new Error(`relatório inesperado: ${JSON.stringify({c: report.changed.length, u: report.unchanged, f: report.failed.length})}`);
    if (dock.get_uint('icon-size') !== 48 || theme.get_string('shell-theme') !== 'Orchis')
        throw new Error('valores não gravados');
    if (settings.get_uint('migration-version') !== Migration.MIGRATION_FORMAT)
        throw new Error('migration-version não gravada');
    if (!MigrationApply.backupDate(openOurs))
        throw new Error('backup ausente');

    MigrationApply.restoreBackup(openOurs);
    if (dock.get_uint('icon-size') !== 32)
        throw new Error('valor do usuário não restaurado');
    if (theme.get_user_value('shell-theme') !== null)
        throw new Error('chave que estava no padrão deveria voltar ao padrão');
    if (MigrationApply.backupDate(openOurs) !== null)
        throw new Error('backup deveria ser consumido');
    dock.reset('icon-size');
});

step('MigrationPage: lista as 11 fontes e importa todas pelo botão', () => {
    // Fontes falsas: todas "instaladas", lendo os padrões declarados de cada uma.
    const opener = source => ({
        installed: true,
        read: (key, schema = 'main') => source.defaults[schema]?.[key],
        file: () => null,
    });
    const page = new MigrationPage(openOurs, _, {openSource: opener, isEnabled: () => true});

    const rows = descendants(page).filter(w => w instanceof Adw.ActionRow &&
        w.subtitle === 'installed, active');
    if (rows.length !== Migration.SOURCES.length)
        throw new Error(`esperava ${Migration.SOURCES.length} fontes, achei ${rows.length}`);

    const importAll = descendants(page).find(w => w instanceof Gtk.Button && w.label === 'Import all');
    importAll.emit('clicked');

    const report = page.lastReport;
    if (!report || report.failed.length !== 0)
        throw new Error(`importação falhou: ${JSON.stringify(report?.failed)}`);
    // Padrões do Dash to Dock (ícone 48) chegaram ao nosso dock.
    if (childSettings('dock').get_uint('icon-size') !== 48)
        throw new Error('valor importado não gravado');
    if (report.notes.length === 0)
        throw new Error('as notas deveriam aparecer no relatório');

    const undo = descendants(page).find(w => w instanceof Gtk.Button && w.label === 'Undo');
    if (!undo.sensitive)
        throw new Error('desfazer deveria estar disponível');
    undo.emit('clicked');
    if (childSettings('dock').get_user_value('icon-size') !== null)
        throw new Error('desfazer não voltou ao padrão');
});

step('GeneralPage: perfil Desktop liga tudo, e editar vira Personalizado', () => {
    const page = new GeneralPage(settings, _, {openSettings: openOurs});
    const combo = descendants(page).find(w => w instanceof Adw.ComboRow && w.title === 'Profile');
    if (!combo)
        throw new Error('seletor de perfil ausente');

    const ids = ['off', 'desktop', 'developer', 'laptop', 'minimal', 'gaming', 'custom'];
    if (ids[combo.selected] !== 'off')
        throw new Error(`esperava "off", mostrou '${ids[combo.selected]}'`);

    combo.selected = ids.indexOf('developer');
    if (!settings.get_boolean('tiling-enabled') || settings.get_boolean('dock-enabled'))
        throw new Error('módulos do perfil Desenvolvedor não aplicados');
    if (childSettings('theme').get_string('background-color').toUpperCase() !== '#1E1E1E')
        throw new Error('preset escuro do perfil não aplicado');
    if (!childSettings('tiling').get_boolean('auto-split'))
        throw new Error('ajuste do perfil não aplicado');
    if (ids[combo.selected] !== 'developer')
        throw new Error('depois de aplicar deveria continuar em "developer"');

    settings.set_boolean('media-enabled', true);
    if (ids[combo.selected] !== 'custom')
        throw new Error('ligar um módulo à mão deveria virar personalizado');

    for (const name of ['', 'theme', 'tiling', 'animation']) {
        const s = openOurs(name);
        for (const key of s.settings_schema.list_keys())
            s.reset(key);
    }
});

step('GeneralPage: com extensão original ativa, pergunta antes; cancelar não aplica', () => {
    let asked = null;
    const page = new GeneralPage(settings, _, {
        openSettings: openOurs,
        isEnabled: uuid => uuid === 'forge@jmmaranan.com',
        confirm: (conflicts, apply, cancel) => {
            asked = conflicts.map(c => c.name);
            cancel();
        },
    });
    const combo = descendants(page).find(w => w instanceof Adw.ComboRow && w.title === 'Profile');
    combo.selected = 1;   // desktop

    if (JSON.stringify(asked) !== JSON.stringify(['Forge']))
        throw new Error(`deveria perguntar sobre o Forge, perguntou ${JSON.stringify(asked)}`);
    if (settings.get_boolean('tiling-enabled'))
        throw new Error('cancelar não deveria aplicar');
    if (combo.selected !== 0)
        throw new Error('o seletor deveria voltar ao perfil atual');
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

step('menu lateral: uma linha por página, escolher mostra a página, busca filtra pelo conteúdo', () => {
    const window = new Adw.PreferencesWindow();
    const pages = [
        new ThemePage(childSettings('theme'), _),
        new BluetoothPage(childSettings('bluetooth'), _),
        new MediaPage(childSettings('media'), _),
    ];
    const {split, list, stack, search, select} = buildSidebarWindow(window, pages, _);

    if (window.get_content() !== split)
        throw new Error('a janela deveria exibir o menu lateral');
    const rows = [];
    for (let row = list.get_row_at_index(0), i = 0; row; row = list.get_row_at_index(++i))
        rows.push(row);
    if (rows.length !== 3)
        throw new Error(`esperava 3 linhas, achei ${rows.length}`);
    if (stack.visible_child !== pages[0])
        throw new Error('a primeira página deveria abrir sozinha');

    select(rows[2]);
    if (stack.visible_child !== pages[2] || split.content.title !== 'Media')
        throw new Error('escolher a linha deveria mostrar a página de mídia');

    // "Hide when nothing is connected" só existe na página do Bluetooth.
    search.text = 'nothing is connected';
    list.invalidate_filter();
    const visible = rows.filter(row => row.get_child_visible());
    if (visible.length !== 1 || visible[0] !== rows[1])
        throw new Error(`a busca deveria deixar só o Bluetooth, deixou ${visible.length}`);

    search.text = '';
    list.invalidate_filter();
    if (rows.some(row => !row.get_child_visible()))
        throw new Error('busca vazia deveria mostrar todas');
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

function findComboRow(page, title = 'Detail level') {
    for (const widget of descendants(page)) {
        if (widget instanceof Adw.ComboRow && widget.title === title)
            return widget;
    }
    return null;
}

print('');
print(failures === 0
    ? 'preferências: todas as verificações passaram'
    : `preferências: ${failures} falha(s)`);
imports.system.exit(failures === 0 ? 0 : 1);
