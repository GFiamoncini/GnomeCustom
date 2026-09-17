// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Suíte do núcleo. Executar com `make test` (ou `gjs -m tests/run.js`).
 *
 * O critério de aceite da Fase 1 é o último bloco: habilitar e desabilitar
 * repetidamente não pode deixar sinal, fonte do loop ou patch para trás.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {test, assert, assertEqual, assertThrows, run} from './harness.js';
import {FakeEmitter, FakeSettings, FakeInjectionManager, FakeExtension, FakeSink, FakeWindowSystem} from './fakes.js';

const EXT = '../gnomeCustom@gfiamoncini.com';

const {Logger, LogLevel, toLogLevel, logLevelNick} = await import(`${EXT}/core/logger.js`);
const {SignalTracker} = await import(`${EXT}/core/signals.js`);
const {Patcher} = await import(`${EXT}/core/patcher.js`);
const {Compatibility} = await import(`${EXT}/core/compatibility.js`);
const {SettingsManager} = await import(`${EXT}/core/settings.js`);
const {ServiceRegistry} = await import(`${EXT}/core/services.js`);
const {Context} = await import(`${EXT}/core/context.js`);
const {Module} = await import(`${EXT}/core/module.js`);
const {ModuleManager, ModuleState} = await import(`${EXT}/core/module-manager.js`);
const {Lifecycle} = await import(`${EXT}/core/lifecycle.js`);
const {MODULES_INFO} = await import(`${EXT}/lib/modules-info.js`);
const {KNOWN_EXTENSIONS} = await import(`${EXT}/lib/known-extensions.js`);
const Color = await import(`${EXT}/theme/engine/color.js`);
const {quantize} = await import(`${EXT}/theme/engine/quantize.js`);
const {buildTokens, DEFAULT_CONFIG, SETTINGS_KEYS} = await import(`${EXT}/theme/engine/tokens.js`);
const {generateStylesheet} = await import(`${EXT}/theme/engine/stylesheet.js`);
const Presets = await import(`${EXT}/theme/presets/presets.js`);
const {StyleService} = await import(`${EXT}/services/theme/style.js`);
const {WallpaperService} = await import(`${EXT}/services/system/wallpaper.js`);
const {TilingTree, leavesOf} = await import(`${EXT}/lib/tiling/tree.js`);
const {computeLayout, distribute, inset} = await import(`${EXT}/lib/tiling/layout.js`);
const Rules = await import(`${EXT}/lib/tiling/rules.js`);
const Geometry = await import(`${EXT}/lib/tiling/geometry.js`);
const {TILING_ACTIONS, normalizeAccel, findCollisions} = await import(`${EXT}/lib/tiling/actions.js`);
const {TilingController, keyFor, GAP_INCREMENT_MAX} = await import(`${EXT}/lib/tiling/controller.js`);
const Migration = await import(`${EXT}/lib/migration/importers.js`);
const Profiles = await import(`${EXT}/lib/profiles.js`);
const {parseOsRelease} = await import(`${EXT}/services/system/distro.js`);
const {VolumeModule, formatLevel} = await import(`${EXT}/modules/volume/module.js`);
const Mpris = await import(`${EXT}/lib/mpris.js`);
const Shortcuts = await import(`${EXT}/lib/shortcuts.js`);
const Bt = await import(`${EXT}/lib/bluetooth.js`);
const Dock = await import(`${EXT}/lib/dock.js`);
const {isFirefoxPip} = await import(`${EXT}/lib/overview.js`);
const {OverviewModule, FEATURES: OVERVIEW_FEATURES} = await import(`${EXT}/modules/overview/module.js`);
const Animation = await import(`${EXT}/lib/animation.js`);
const {AnimationModule} = await import(`${EXT}/modules/animation/module.js`);

const BASE_SCHEMA = 'org.gnome.shell.extensions.gnomecustom';

/** Valores default equivalentes ao esquema, para os dublês. */
function defaultValues(overrides = {}) {
    const values = {
        'log-level': 'silent',
        'migration-version': 0,
        'conflict-warnings': true,
        'strict-cleanup-check': false,
    };
    for (const info of MODULES_INFO)
        values[info.key] = info.id === 'diagnostics';
    return {...values, ...overrides};
}

// ---------------------------------------------------------------- logger

test('logger: níveis filtram mensagens', () => {
    const sink = new FakeSink();
    const logger = new Logger({level: 'warn', sink});

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assertEqual(sink.count('log'), 0, 'debug/info não deviam sair em nível warn:');
    assertEqual(sink.count('warn'), 1, 'warn:');
    assertEqual(sink.count('error'), 1, 'error:');
});

test('logger: prefixo e escopo derivado', () => {
    const sink = new FakeSink();
    const logger = new Logger({level: 'debug', sink});
    logger.child('tiling').debug('x');

    assert(sink.text.includes('[GnomeCustom/tiling]'), `prefixo errado: ${sink.text}`);
});

test('logger: setLevelRecursive alcança os filhos', () => {
    const sink = new FakeSink();
    const logger = new Logger({level: 'silent', sink});
    const child = logger.child('dock');

    child.warn('não sai');
    assertEqual(sink.count('warn'), 0, 'silencioso:');

    logger.setLevelRecursive('debug');
    child.warn('sai');
    assertEqual(sink.count('warn'), 1, 'após elevar o nível:');
});

test('logger: conversão de nick e valor', () => {
    assertEqual(toLogLevel('debug'), LogLevel.DEBUG);
    assertEqual(toLogLevel('inexistente'), LogLevel.WARN, 'nick inválido cai em warn:');
    assertEqual(toLogLevel(99), LogLevel.DEBUG, 'valor acima do máximo é limitado:');
    assertEqual(toLogLevel(-5), LogLevel.SILENT, 'valor negativo é limitado:');
    assertEqual(logLevelNick(LogLevel.INFO), 'info');
});

// --------------------------------------------------------------- signals

test('signals: destroy desconecta tudo', () => {
    const emitter = new FakeEmitter();
    const tracker = new SignalTracker({name: 't'});

    tracker.connect(emitter, 'a', () => {});
    tracker.connect(emitter, 'b', () => {});
    assertEqual(emitter.handlerCount, 2, 'conectados:');
    assertEqual(tracker.pending.signals, 2, 'rastreados:');

    tracker.destroy();
    assertEqual(emitter.handlerCount, 0, 'após destroy:');
    assert(tracker.isClean, 'tracker deveria estar limpo');
});

test('signals: destroy é idempotente', () => {
    const emitter = new FakeEmitter();
    const tracker = new SignalTracker({name: 't'});
    tracker.connect(emitter, 'a', () => {});

    tracker.destroy();
    tracker.destroy();
    assertEqual(emitter.disconnectCount, 1, 'não deve desconectar duas vezes:');
});

test('signals: connectSetting com fireNow dispara uma vez', () => {
    const settings = new FakeSettings({x: true});
    const tracker = new SignalTracker({name: 't'});
    let calls = 0;

    tracker.connectSetting(settings, 'x', () => calls++, {fireNow: true});
    assertEqual(calls, 1, 'chamada inicial:');

    settings.set('x', false);
    assertEqual(calls, 2, 'após mudança:');

    tracker.destroy();
    settings.set('x', true);
    assertEqual(calls, 2, 'após destroy não deve mais chamar:');
});

test('signals: objeto nulo em connect é rejeitado', () => {
    const tracker = new SignalTracker({name: 't'});
    assertThrows(() => tracker.connect(null, 'a', () => {}));
});

test('signals: fonte que se encerra sai do registro', () => {
    const tracker = new SignalTracker({name: 't'});
    const loop = new GLib.MainLoop(null, false);

    tracker.addTimeout(1, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    assertEqual(tracker.pending.sources, 1, 'antes de disparar:');

    loop.run();
    assertEqual(tracker.pending.sources, 0, 'após a fonte se encerrar:');
    assert(tracker.isClean, 'deveria estar limpo');
    tracker.destroy();
});

test('signals: destroy remove fonte ainda viva', () => {
    const tracker = new SignalTracker({name: 't'});
    tracker.addTimeout(60000, () => GLib.SOURCE_CONTINUE);
    assertEqual(tracker.pending.sources, 1);

    tracker.destroy();
    assertEqual(tracker.pending.sources, 0, 'após destroy:');
});

// --------------------------------------------------------------- patcher

function patchTarget() {
    class Target {
        greet() {
            return 'original';
        }
    }
    return Target.prototype;
}

test('patcher: override e revertAll restauram o método', () => {
    const proto = patchTarget();
    const injections = new FakeInjectionManager();
    const patcher = new Patcher({injectionManager: injections, scope: 'test'});

    patcher.override(proto, 'greet', () => function () {
        return 'patched';
    }, {api: 'Target.greet'});

    assertEqual(proto.greet(), 'patched', 'com patch:');
    assertEqual(patcher.pending, 1);
    assertEqual(patcher.patchedApis, ['Target.greet']);

    patcher.revertAll();
    assertEqual(proto.greet(), 'original', 'após reverter:');
    assert(patcher.isClean, 'patcher deveria estar limpo');
});

test('patcher: restore individual', () => {
    const proto = patchTarget();
    const patcher = new Patcher({injectionManager: new FakeInjectionManager()});

    patcher.override(proto, 'greet', () => () => 'p');
    assert(patcher.restore(proto, 'greet'), 'restore deveria achar o patch');
    assertEqual(proto.greet(), 'original');
    assertEqual(patcher.restore(proto, 'greet'), false, 'segundo restore:');
});

test('patcher: revertAll é idempotente', () => {
    const proto = patchTarget();
    const injections = new FakeInjectionManager();
    const patcher = new Patcher({injectionManager: injections});

    patcher.override(proto, 'greet', () => () => 'p');
    patcher.revertAll();
    patcher.revertAll();
    assertEqual(injections.restoreCount, 1, 'não deve reverter duas vezes:');
});

test('patcher: método inexistente é rejeitado', () => {
    const proto = patchTarget();
    const patcher = new Patcher({injectionManager: new FakeInjectionManager()});
    assertThrows(() => patcher.override(proto, 'naoExiste', () => () => 1));
});

test('patcher: exige InjectionManager', () => {
    assertThrows(() => new Patcher({injectionManager: null}));
});

// --------------------------------------------------------- compatibility

test('compatibility: interpreta a versão', () => {
    const compat = new Compatibility('49.9');
    assertEqual(compat.major, 49);
    assertEqual(compat.minor, 9);
    assert(compat.isTested, '49 deveria ser tida como testada');
    assert(compat.atLeast(49), 'atLeast(49):');
    assert(compat.atLeast(49, 9), 'atLeast(49,9):');
    assert(!compat.atLeast(49, 10), 'atLeast(49,10) deveria ser falso');
    assert(!compat.atLeast(50), 'atLeast(50) deveria ser falso');
});

test('compatibility: versão sem minor e versão inválida', () => {
    assertEqual(new Compatibility('50').minor, 0);
    assertEqual(new Compatibility('lixo').major, 0);
    assert(!new Compatibility('lixo').isTested, 'versão inválida não é testada');
});

test('compatibility: versão não testada é sinalizada', () => {
    const compat = new Compatibility('51.0');
    assert(!compat.isTested, '51 não foi testada');
    assertEqual(compat.missingRequirements, [], 'requisitos ainda presentes em 51:');
});

test('compatibility: capacidades', () => {
    const compat = new Compatibility('49.9');
    assert(compat.supports('injection-manager'), 'injection-manager:');
    assert(!new Compatibility('44.0').supports('injection-manager'),
        'GNOME 44 não tem InjectionManager');
    assertEqual(new Compatibility('44.0').missingRequirements, ['injection-manager']);
});

// -------------------------------------------------------------- services

test('services: criação tardia e destruição', () => {
    let created = 0;
    let destroyed = 0;
    const registry = new ServiceRegistry({
        factories: {
            a: () => {
                created++;
                return {destroy: () => destroyed++};
            },
        },
    });

    assertEqual(created, 0, 'nada criado antes do primeiro get:');
    const first = registry.get('a');
    assertEqual(created, 1);
    assert(registry.get('a') === first, 'get deveria devolver a mesma instância');

    registry.destroyAll();
    assertEqual(destroyed, 1);
    assertEqual(registry.activeNames, []);
});

test('services: fábrica recebe nome e logger', () => {
    let received = null;
    const registry = new ServiceRegistry({
        factories: {svc: args => {
            received = args;
            return {};
        }},
        logger: new Logger({level: 'silent', sink: new FakeSink()}),
    });

    registry.get('svc');
    assertEqual(received.name, 'svc');
    assert(received.logger !== null, 'a fábrica deveria receber um logger');
});

test('services: serviço desconhecido falha', () => {
    const registry = new ServiceRegistry({factories: {}});
    assertThrows(() => registry.get('inexistente'));
    assertEqual(registry.has('inexistente'), false);
});

test('services: falha em destroy não interrompe as demais', () => {
    let destroyed = 0;
    const registry = new ServiceRegistry({
        factories: {
            bad: () => ({destroy: () => {
                throw new Error('boom');
            }}),
            good: () => ({destroy: () => destroyed++}),
        },
        logger: new Logger({level: 'silent', sink: new FakeSink()}),
    });

    registry.get('bad');
    registry.get('good');
    registry.destroyAll();
    assertEqual(destroyed, 1, 'o serviço bom deveria ter sido destruído:');
    assertEqual(registry.activeNames, []);
});

// -------------------------------------------------------------- settings

test('settings: base, filhos e observação', () => {
    const extension = new FakeExtension({values: defaultValues()});
    const manager = new SettingsManager({
        getSettings: id => extension.getSettings(id),
        baseSchemaId: BASE_SCHEMA,
    });

    assert(manager.base === extension.base, 'base deveria ser o esquema base');
    const dock = manager.child('dock');
    assert(manager.child('dock') === dock, 'filho deveria vir do cache');

    let calls = 0;
    manager.watch('dock-enabled', () => calls++);
    extension.base.set('dock-enabled', true);
    assertEqual(calls, 1);

    manager.destroy();
    extension.base.set('dock-enabled', false);
    assertEqual(calls, 1, 'após destroy não deve observar:');
    assertEqual(extension.base.handlerCount, 0, 'sinais restantes:');
});

// --------------------------------------------------------- module manager

/** Módulo de teste, com contadores e falha opcional. */
function makeModule(id, {failOnEnable = false, leakSignal = false} = {}) {
    const stats = {enabled: 0, disabled: 0, destroyed: 0};

    class TestModule extends Module {
        static get id() {
            return id;
        }

        enable() {
            stats.enabled++;
            if (leakSignal)
                this.signals.connect(new FakeEmitter(), 'x', () => {});
            if (failOnEnable)
                throw new Error(`falha proposital em ${id}`);
        }

        disable() {
            stats.disabled++;
        }

        destroy() {
            stats.destroyed++;
        }
    }

    return {TestModule, stats};
}

function makeContext(values) {
    const extension = new FakeExtension({values});
    const sink = new FakeSink();
    const logger = new Logger({level: 'silent', sink});
    const settings = new SettingsManager({
        getSettings: id => extension.getSettings(id),
        baseSchemaId: BASE_SCHEMA,
        logger,
    });
    const services = new ServiceRegistry({factories: {}, logger});
    const context = new Context({
        extension,
        logger,
        settings,
        compat: new Compatibility('49.9', {logger}),
        services,
        createInjectionManager: () => new FakeInjectionManager(),
    });
    return {context, extension, settings, services, sink, logger};
}

test('module-manager: ativa só o que está ligado', () => {
    const a = makeModule('alpha');
    const b = makeModule('beta');
    const {context} = makeContext({'alpha-enabled': true, 'beta-enabled': false});

    const manager = new ModuleManager({context});
    manager.register(a.TestModule);
    manager.register(b.TestModule);
    manager.enableAll();

    assertEqual(a.stats.enabled, 1, 'alpha:');
    assertEqual(b.stats.enabled, 0, 'beta:');
    assertEqual(manager.enabledIds, ['alpha']);
});

test('module-manager: desativa na ordem inversa do registro', () => {
    const order = [];
    const {context} = makeContext({'a-enabled': true, 'b-enabled': true});

    const build = id => class extends Module {
        static get id() {
            return id;
        }

        enable() {
            order.push(`+${id}`);
        }

        disable() {
            order.push(`-${id}`);
        }
    };

    const manager = new ModuleManager({context});
    manager.register(build('a'));
    manager.register(build('b'));
    manager.enableAll();
    manager.disableAll();

    assertEqual(order, ['+a', '+b', '-b', '-a']);
});

test('module-manager: mudança de chave liga e desliga a quente', () => {
    const mod = makeModule('alpha');
    const {context, extension} = makeContext({'alpha-enabled': false});

    const manager = new ModuleManager({context});
    manager.register(mod.TestModule);
    manager.enableAll();
    assertEqual(mod.stats.enabled, 0, 'começa desligado:');

    extension.base.set('alpha-enabled', true);
    assertEqual(mod.stats.enabled, 1, 'após ligar:');

    extension.base.set('alpha-enabled', false);
    assertEqual(mod.stats.disabled, 1, 'após desligar:');

    extension.base.set('alpha-enabled', false);
    assertEqual(mod.stats.disabled, 1, 'chave repetida não deve redesativar:');
});

test('module-manager: falha em um módulo não impede os outros', () => {
    const bad = makeModule('bad', {failOnEnable: true});
    const good = makeModule('good');
    const {context, sink, logger} = makeContext({'bad-enabled': true, 'good-enabled': true});
    logger.setLevelRecursive('error');

    const manager = new ModuleManager({context, logger});
    manager.register(bad.TestModule);
    manager.register(good.TestModule);
    manager.enableAll();

    assertEqual(good.stats.enabled, 1, 'o módulo bom deveria ter sido ativado:');
    assertEqual(manager.enabledIds, ['good']);
    const badEntry = manager.report.find(r => r.id === 'bad');
    assertEqual(badEntry.state, ModuleState.FAILED);
    assert(sink.count('error') > 0, 'a falha deveria ter sido registrada');
});

test('module-manager: escopo de um módulo que falhou é limpo', () => {
    const bad = makeModule('bad', {failOnEnable: true, leakSignal: true});
    const {context, logger} = makeContext({'bad-enabled': true});
    logger.setLevelRecursive('silent');

    const manager = new ModuleManager({context});
    manager.register(bad.TestModule);
    manager.enableAll();

    assertEqual(bad.stats.destroyed, 1, 'destroy deveria ter sido chamado:');
    assertEqual(manager.collectLeaks(), [], 'nada deveria ter vazado:');
});

test('module-manager: serviço não declarado é rejeitado', () => {
    class Needy extends Module {
        static get id() {
            return 'needy';
        }

        enable() {
            this.service('inexistente');
        }
    }

    const {context, logger} = makeContext({'needy-enabled': true});
    logger.setLevelRecursive('silent');
    const manager = new ModuleManager({context});
    manager.register(Needy);
    manager.enableAll();

    assertEqual(manager.report[0].state, ModuleState.FAILED);
});

test('module-manager: requires ausente marca o módulo como não suportado', () => {
    class WantsService extends Module {
        static get id() {
            return 'wants';
        }

        static get requires() {
            return ['naoRegistrado'];
        }
    }

    const {context, logger} = makeContext({'wants-enabled': true});
    logger.setLevelRecursive('silent');
    const manager = new ModuleManager({context});
    manager.register(WantsService);
    manager.enableAll();

    assertEqual(manager.report[0].state, ModuleState.UNSUPPORTED);
});

test('module-manager: registro duplicado falha', () => {
    const mod = makeModule('dup');
    const {context} = makeContext({'dup-enabled': false});
    const manager = new ModuleManager({context});
    manager.register(mod.TestModule);
    assertThrows(() => manager.register(mod.TestModule));
});

// ------------------------------------------------------------- lifecycle

/** Monta um Lifecycle completo sobre dublês. */
function makeLifecycle(values, {modules = [], serviceFactories = {}} = {}) {
    const extension = new FakeExtension({values});
    const injections = [];
    const sink = new FakeSink();
    const lifecycle = new Lifecycle({
        extension,
        sink,
        shellVersion: '49.9',
        createInjectionManager: () => {
            const manager = new FakeInjectionManager();
            injections.push(manager);
            return manager;
        },
        serviceFactories,
        modules,
    });
    return {lifecycle, extension, injections, sink};
}

test('lifecycle: enable e disable completos', () => {
    const mod = makeModule('alpha');
    const {lifecycle, extension} = makeLifecycle(
        defaultValues({'alpha-enabled': true}), {modules: [mod.TestModule]});

    lifecycle.enable();
    assertEqual(mod.stats.enabled, 1);
    assert(lifecycle.status !== null, 'status deveria existir enquanto ativo');

    lifecycle.disable();
    assertEqual(mod.stats.disabled, 1);
    assertEqual(lifecycle.status, null, 'status após disable:');
    assertEqual(extension.base.handlerCount, 0, 'sinais no esquema base:');
});

test('lifecycle: nível de log vem do GSettings e acompanha mudanças', () => {
    const {lifecycle, extension} = makeLifecycle(defaultValues({'log-level': 'debug'}));
    lifecycle.enable();
    assertEqual(lifecycle.logger.level, 4, 'nível inicial:');

    extension.base.set('log-level', 'error');
    assertEqual(lifecycle.logger.level, 1, 'após mudança:');
    lifecycle.disable();
});

test('lifecycle: ambiente incompatível aborta sem montar nada', () => {
    const extension = new FakeExtension({values: defaultValues()});
    const sink = new FakeSink();
    const lifecycle = new Lifecycle({
        extension,
        sink,
        shellVersion: '42.0',
        createInjectionManager: () => new FakeInjectionManager(),
        serviceFactories: {},
        modules: [],
    });

    lifecycle.enable();
    assertEqual(lifecycle.status, null, 'não deveria montar módulos:');
    assert(sink.text.includes('incompatível'), 'deveria registrar a incompatibilidade');
    assertEqual(extension.base.handlerCount, 0, 'não deveria conectar sinais:');
    lifecycle.disable();
});

test('lifecycle: serviço só é criado se um módulo o exigir', () => {
    let created = 0;
    class Consumer extends Module {
        static get id() {
            return 'consumer';
        }

        static get requires() {
            return ['probe'];
        }

        enable() {
            this.service('probe');
        }
    }

    const factories = {probe: () => {
        created++;
        return {destroy: () => {}};
    }};

    const off = makeLifecycle(defaultValues({'consumer-enabled': false}),
        {modules: [Consumer], serviceFactories: factories});
    off.lifecycle.enable();
    assertEqual(created, 0, 'módulo desligado não deveria criar o serviço:');
    off.lifecycle.disable();

    const on = makeLifecycle(defaultValues({'consumer-enabled': true}),
        {modules: [Consumer], serviceFactories: factories});
    on.lifecycle.enable();
    assertEqual(created, 1, 'módulo ligado deveria criar o serviço:');
    on.lifecycle.disable();
});

// Critério de aceite da Fase 1.
test('CRITÉRIO: 20 ciclos enable/disable não vazam nada', () => {
    const mod = makeModule('alpha', {leakSignal: true});
    const values = defaultValues({'alpha-enabled': true});
    const extension = new FakeExtension({values});
    const injections = [];

    for (let i = 0; i < 20; i++) {
        const lifecycle = new Lifecycle({
            extension,
            sink: new FakeSink(),
            shellVersion: '49.9',
            createInjectionManager: () => {
                const manager = new FakeInjectionManager();
                injections.push(manager);
                return manager;
            },
            serviceFactories: {},
            modules: [mod.TestModule],
        });
        lifecycle.enable();
        lifecycle.disable();
    }

    assertEqual(mod.stats.enabled, 20, 'ativações:');
    assertEqual(mod.stats.disabled, 20, 'desativações:');
    assertEqual(extension.base.handlerCount, 0,
        'nenhum sinal deveria sobrar no GSettings após 20 ciclos:');
    assertEqual(extension.base.connectCount, extension.base.disconnectCount,
        'connect e disconnect deveriam empatar:');
    const stuck = injections.filter(m => m.pending > 0).length;
    assertEqual(stuck, 0, 'InjectionManagers com patch pendente:');
});

// ------------------------------------------------------------------ cor

test('cor: interpreta hexadecimal em todas as formas', () => {
    assertEqual(Color.parseHex('#1C71D8'), [28, 113, 216]);
    assertEqual(Color.parseHex('1c71d8'), [28, 113, 216], 'sem cerquilha:');
    assertEqual(Color.parseHex('#abc'), [170, 187, 204], 'forma curta:');
    assertEqual(Color.parseHex('não é cor'), null);
    assertEqual(Color.parseHex(''), null);
    assertEqual(Color.parseHex(null), null);
});

test('cor: ida e volta para hexadecimal', () => {
    assertEqual(Color.toHex([28, 113, 216]), '#1c71d8');
    assertEqual(Color.toHex([-5, 300, 0]), '#00ff00', 'componentes fora da faixa:');
});

test('cor: rgba para CSS', () => {
    assertEqual(Color.rgba([28, 113, 216], 0.9), 'rgba(28, 113, 216, 0.9)');
    assertEqual(Color.rgba([0, 0, 0], 5), 'rgba(0, 0, 0, 1)', 'alfa é limitado:');
});

test('cor: luminância e contraste seguem a WCAG', () => {
    assert(Color.relativeLuminance([255, 255, 255]) > 0.99, 'branco:');
    assert(Color.relativeLuminance([0, 0, 0]) < 0.001, 'preto:');
    const ratio = Color.contrastRatio([255, 255, 255], [0, 0, 0]);
    assert(ratio > 20.9 && ratio < 21.1, `contraste branco/preto foi ${ratio}`);
    assertEqual(Color.contrastRatio([50, 50, 50], [50, 50, 50]), 1, 'cor com ela mesma:');
});

test('cor: texto escolhido tem o maior contraste', () => {
    assertEqual(Color.bestForeground([20, 20, 20]), [255, 255, 255], 'fundo escuro:');
    assertEqual(Color.bestForeground([240, 240, 240]), [0, 0, 0], 'fundo claro:');

    // O caso real do baseline: o fundo extraído do papel de parede.
    const fg = Color.bestForeground([96, 32, 17]);
    assert(Color.contrastRatio([96, 32, 17], fg) >= 4.5,
        'o texto escolhido deveria passar do mínimo AA da WCAG');
});

test('cor: mistura e deslocamento', () => {
    assertEqual(Color.mix([0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128]);
    assertEqual(Color.mix([10, 20, 30], [200, 200, 200], 0), [10, 20, 30], 'amount 0:');

    const darkShifted = Color.shiftAwayFromBackground([20, 20, 20], 0.5);
    assert(Color.relativeLuminance(darkShifted) > Color.relativeLuminance([20, 20, 20]),
        'cor escura deveria clarear');
    const lightShifted = Color.shiftAwayFromBackground([240, 240, 240], 0.5);
    assert(Color.relativeLuminance(lightShifted) < Color.relativeLuminance([240, 240, 240]),
        'cor clara deveria escurecer');
});

// ------------------------------------------------------------ quantização

/** Gera pixels com proporções conhecidas, para conferir a ordenação. */
function syntheticPixels(spec) {
    const pixels = [];
    for (const [color, count] of spec) {
        for (let i = 0; i < count; i++)
            pixels.push([...color]);
    }
    return pixels;
}

test('quantize: imagem de uma só cor devolve uma cor', () => {
    const result = quantize(syntheticPixels([[[200, 30, 40], 500]]), 8);
    assertEqual(result.length, 1, 'nº de cores:');
    assertEqual(result[0].count, 500, 'contagem:');

    const [r, g, b] = result[0].color;
    assert(Math.abs(r - 200) <= 4 && Math.abs(g - 30) <= 4 && Math.abs(b - 40) <= 4,
        `cor devolvida foi ${result[0].color}`);
});

test('quantize: ordena da cor mais frequente para a menos', () => {
    const result = quantize(syntheticPixels([
        [[10, 10, 200], 100],
        [[200, 10, 10], 400],
        [[10, 200, 10], 250],
    ]), 3);

    assertEqual(result.length, 3);
    assertEqual(result.map(e => e.count), [400, 250, 100], 'contagens em ordem:');
    // A mais frequente é a vermelha.
    assert(result[0].color[0] > 150 && result[0].color[2] < 60,
        `esperava vermelho dominante, veio ${result[0].color}`);
});

test('quantize: nunca devolve mais que maxColors', () => {
    const pixels = [];
    for (let i = 0; i < 4000; i++)
        pixels.push([i % 256, (i * 7) % 256, (i * 13) % 256]);

    for (const max of [1, 2, 5, 12, 16]) {
        const result = quantize(pixels, max);
        assert(result.length <= max, `${max} cores pedidas, ${result.length} devolvidas`);
        assert(result.length > 0, 'deveria devolver algo');
    }
});

test('quantize: a soma das contagens é o total de pixels', () => {
    const pixels = syntheticPixels([
        [[12, 200, 70], 130],
        [[240, 20, 90], 77],
        [[9, 9, 180], 43],
    ]);
    const total = quantize(pixels, 6).reduce((sum, e) => sum + e.count, 0);
    assertEqual(total, pixels.length);
});

test('quantize: lista vazia devolve vazio e maxColors inválido falha', () => {
    assertEqual(quantize([], 8), []);
    assertThrows(() => quantize([[0, 0, 0]], 0));
});

// ------------------------------------------------------------------ tokens

test('tokens: os defaults reproduzem o baseline do usuário', () => {
    const t = buildTokens({palette: ['#602011']});

    assertEqual(t.panel.height, 29, 'altura:');
    assertEqual(t.panel.radius, 15, 'raio:');
    assertEqual(t.panel.borderWidth, 2, 'borda:');
    assertEqual(t.panel.margin, {top: 1.5, bottom: 2.1, sides: 4.5}, 'margens:');
    assertEqual(t.panel.background, 'rgba(96, 32, 17, 0.9)', 'fundo:');
    assert(t.panel.floating, 'a barra deveria ser flutuante');
    assertEqual(t.accent.hex, '#1c71d8', 'destaque:');
    assert(t.panel.fitts, 'fitts deveria estar ligado');
});

test('tokens: estilo "none" desliga o engine', () => {
    const t = buildTokens({panelStyle: 'none'});
    assertEqual(t.enabled, false);
    assertEqual(generateStylesheet(t), '', 'CSS deveria ser vazio:');
});

test('tokens: estilo "attached" zera margens e raio', () => {
    const t = buildTokens({panelStyle: 'attached', palette: ['#602011']});
    assert(t.enabled, 'deveria estar ligado');
    assertEqual(t.panel.floating, false);
    assertEqual(t.panel.radius, 0);
    assertEqual(t.panel.margin, {top: 0, bottom: 0, sides: 0});
});

test('tokens: cor explícita tem precedência sobre a paleta', () => {
    const t = buildTokens({palette: ['#602011'], backgroundColor: '#123456'});
    assertEqual(t.panel.backgroundHex, '#123456');
});

test('tokens: sem paleta e sem cor, o tema do usuário fica no comando', () => {
    const t = buildTokens({palette: []});
    assertEqual(t.panel.background, null, 'fundo:');
    assertEqual(t.panel.foreground, null, 'texto:');

    const css = generateStylesheet(t);
    assert(!css.includes('background-color'),
        'o CSS não deveria mexer em cor de fundo');
    assert(css.includes('height: 29px'), 'mas deveria trazer geometria');
});

test('tokens: paleta desligada ignora a paleta em cache', () => {
    const t = buildTokens({palette: ['#602011'], paletteFromWallpaper: false});
    assertEqual(t.panel.background, null);
});

test('tokens: palette-slot escolhe a cor e é limitado à lista', () => {
    const palette = ['#602011', '#af5d3c', '#180404'];
    assertEqual(buildTokens({palette, paletteSlot: 1}).panel.backgroundHex, '#af5d3c');
    assertEqual(buildTokens({palette, paletteSlot: 99}).panel.backgroundHex, '#180404',
        'índice acima do fim deveria cair no último:');
});

test('tokens: o texto resolvido contrasta com o fundo', () => {
    for (const color of ['#602011', '#eeeeee', '#7f7f7f', '#1c71d8']) {
        const t = buildTokens({palette: [color]});
        const ratio = Color.contrastRatio(
            Color.parseHex(t.panel.backgroundHex), Color.parseHex(t.panel.foreground));
        assert(ratio >= 4.5, `contraste de ${color} foi ${ratio.toFixed(2)}`);
    }
});

test('tokens: cor de destaque inválida cai no default', () => {
    const t = buildTokens({accentColor: 'lixo'});
    assertEqual(t.accent.hex, '#1c71d8');
});

// --------------------------------------------------------------- stylesheet

test('stylesheet: reproduz a geometria do baseline', () => {
    const css = generateStylesheet(buildTokens({palette: ['#602011']}));

    assert(css.includes('margin: 1.5px 4.5px 2.1px 4.5px !important;'),
        'margens do painelBox ausentes');
    assert(css.includes('height: 29px !important;'), 'altura ausente');
    assert(css.includes('border-radius: 15px !important;'), 'raio ausente');
    assert(css.includes('border: 2px solid'), 'borda ausente');
    assert(css.includes('background-color: rgba(96, 32, 17, 0.9) !important;'),
        'fundo ausente');
});

test('stylesheet: usa !important para vencer o tema do usuário', () => {
    const css = generateStylesheet(buildTokens({palette: ['#602011']}));
    const declarations = css.split('\n').filter(line => line.trim().endsWith(';'));
    const without = declarations.filter(line => !line.includes('!important'));
    assertEqual(without, [], 'declarações sem !important:');
});

test('stylesheet: borda zero não emite borda', () => {
    const css = generateStylesheet(buildTokens({palette: ['#602011'], borderWidth: 0}));
    assert(css.includes('border: none !important;'), 'esperava border: none');
});

test('stylesheet: fitts desligado não mexe na altura dos botões', () => {
    const on = generateStylesheet(buildTokens({palette: ['#602011'], fittsWidgets: true}));
    const off = generateStylesheet(buildTokens({palette: ['#602011'], fittsWidgets: false}));
    assert(on.includes('padding-top: 0 !important;'), 'ligado deveria zerar o padding');
    assert(!off.includes('padding-top: 0 !important;'), 'desligado não deveria');
});

test('stylesheet: DEFAULT_CONFIG e o esquema não divergem', () => {
    const path = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_current_dir(),
            'gnomeCustom@gfiamoncini.com', 'schemas',
            'org.gnome.shell.extensions.gnomecustom.theme.gschema.xml']));
    const [, bytes] = path.load_contents(null);
    const xml = new TextDecoder().decode(bytes);

    const expected = {
        'panel-height': DEFAULT_CONFIG.panelHeight,
        'panel-margin-top': DEFAULT_CONFIG.marginTop,
        'panel-margin-bottom': DEFAULT_CONFIG.marginBottom,
        'panel-margin-sides': DEFAULT_CONFIG.marginSides,
        'panel-radius': DEFAULT_CONFIG.radius,
        'panel-border-width': DEFAULT_CONFIG.borderWidth,
        'panel-border-alpha': DEFAULT_CONFIG.borderAlpha,
        'panel-background-alpha': DEFAULT_CONFIG.backgroundAlpha,
    };

    for (const [key, value] of Object.entries(expected)) {
        const match = new RegExp(
            `name="${key}"[^>]*>\\s*<default>([^<]+)</default>`).exec(xml);
        assert(match !== null, `chave ${key} não encontrada no esquema`);
        assertEqual(Number(match[1]), value, `default de ${key}:`);
    }
});

// ------------------------------------------------- theme engine: fase 7

/** Lê os defaults do esquema do tema, já convertidos para JS. */
function themeSchemaDefaults() {
    const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(),
        'gnomeCustom@gfiamoncini.com', 'schemas',
        'org.gnome.shell.extensions.gnomecustom.theme.gschema.xml']));
    const xml = new TextDecoder().decode(file.load_contents(null)[1]);

    const keys = {};
    const re = /<key name="([^"]+)"(?: type="([^"]+)")?(?: enum="[^"]+")?>([\s\S]*?)<\/key>/g;
    for (const [, name, type, body] of xml.matchAll(re)) {
        const raw = /<default>([\s\S]*?)<\/default>/.exec(body)[1].trim();
        const range = /<range min="([^"]+)" max="([^"]+)"\/>/.exec(body);
        let value;
        if (type === 'b')
            value = raw === 'true';
        else if (type === 'u' || type === 'd' || type === 'i')
            value = Number(raw);
        else if (type === 'as')
            value = [];
        else
            value = raw.replace(/^'|'$/g, '');   // 's' e enum
        keys[name] = {
            type: type ?? 'enum',
            value,
            min: range ? Number(range[1]) : null,
            max: range ? Number(range[2]) : null,
        };
    }

    // Nicks aceitos por cada enum referenciado.
    const enums = {};
    for (const [, id, body] of xml.matchAll(/<enum id="([^"]+)">([\s\S]*?)<\/enum>/g))
        enums[id] = [...body.matchAll(/nick="([^"]+)"/g)].map(m => m[1]);
    for (const [, name, enumId] of xml.matchAll(/<key name="([^"]+)" enum="([^"]+)"/g))
        keys[name].nicks = enums[enumId];

    return keys;
}

/** Converte valores por chave do esquema em configuração do engine. */
function configFromKeys(values) {
    const config = {};
    for (const [key, name] of Object.entries(SETTINGS_KEYS)) {
        if (key in values)
            config[name] = values[key];
    }
    return config;
}

test('fase 7: superfícies novas nascem desligadas (baseline intacto)', () => {
    const t = buildTokens({palette: ['#602011']});
    assertEqual([t.menu.enabled, t.osd.enabled, t.dock.enabled], [false, false, false]);

    const css = generateStylesheet(t);
    for (const selector of ['.popup-menu-content', '.osd-window', '.gnomecustom-dock'])
        assert(!css.includes(selector), `o baseline não deveria estilizar ${selector}`);
});

test('fase 7: menus, OSD e dock partem da mesma cor base da barra', () => {
    const t = buildTokens({
        palette: ['#294172'], styleMenus: true, styleOsd: true, styleDock: true,
    });

    assertEqual(t.dock.backgroundRgb, Color.parseHex(t.panel.backgroundHex),
        'o dock deveria usar exatamente a cor da barra:');

    // Menus e OSD ficam um passo afastados, mas próximos da base.
    for (const surface of [t.menu.background, t.osd.background]) {
        const [r, g, b] = /rgba\((\d+), (\d+), (\d+)/.exec(surface).slice(1).map(Number);
        const base = Color.parseHex(t.panel.backgroundHex);
        const distance = Math.max(Math.abs(r - base[0]), Math.abs(g - base[1]), Math.abs(b - base[2]));
        assert(distance > 0 && distance < 40, `superfície ${surface} longe demais da base`);
    }
    assertEqual(t.osd.levelFill, t.accent.hex, 'a barra de nível usa o destaque:');
    assertEqual(t.dock.dotFocused, t.accent.hex, 'o ponto focado usa o destaque:');
});

test('fase 7: texto de menus e OSD passa do contraste AA', () => {
    for (const color of ['#602011', '#eeeeee', '#7f7f7f', '#1c71d8', '#294172', '#000000']) {
        const t = buildTokens({palette: [color], styleMenus: true, styleOsd: true});
        for (const [name, section] of [['menu', t.menu], ['osd', t.osd]]) {
            const bg = /rgba\((\d+), (\d+), (\d+)/.exec(section.background).slice(1).map(Number);
            const ratio = Color.contrastRatio(bg, Color.parseHex(section.foreground));
            assert(ratio >= 4.5, `${name} sobre ${color}: contraste ${ratio.toFixed(2)}`);
        }
    }
});

test('fase 7: sem cor resolvida, menus e OSD recebem só geometria (AD-14)', () => {
    const t = buildTokens({palette: [], styleMenus: true, styleOsd: true, styleDock: true});
    assert(t.menu.enabled && t.menu.background === null, 'menu sem cor');
    assertEqual(t.dock.backgroundRgb, null, 'dock sem cor:');

    const css = generateStylesheet(t);
    assert(css.includes('.popup-menu-content'), 'o raio do menu deveria sair');
    const colorLines = css.split('\n').filter(line =>
        /background-color|-barlevel|(^|\s)color:/.test(line) &&
        !line.includes('#panel'));
    assertEqual(colorLines, [], 'nenhuma cor fora da barra deveria sair:');
});

test('fase 7: OSD usa as propriedades -barlevel e o dock não emite fundo', () => {
    const css = generateStylesheet(buildTokens({
        palette: ['#294172'], styleOsd: true, styleDock: true,
    }));
    assert(css.includes('-barlevel-active-background-color'), 'barra de nível ausente');

    const dockBackground = /\.gnomecustom-dock #dash \.dash-background \{([^}]*)\}/.exec(css);
    assert(dockBackground !== null, 'bloco do fundo do dock ausente');
    assert(!dockBackground[1].includes('background-color'),
        'o fundo do dock é estilo próprio do ator; a folha não deve disputá-lo');
});

test('fase 7: com cor, os ícones do dock perdem o disco cinza do tema', () => {
    const colored = generateStylesheet(buildTokens({palette: ['#294172'], styleDock: true}));
    assert(/\.overview-tile \.overview-icon \{\s*background-color: transparent !important;/.test(colored),
        'o disco do tema deveria ficar transparente');
    assert(colored.includes('.overview-tile:hover .overview-icon'), 'realce de hover ausente');

    const plain = generateStylesheet(buildTokens({palette: [], styleDock: true}));
    assert(!plain.includes('.overview-icon'), 'sem cor resolvida o tema continua decidindo (AD-14)');
});

test('fase 7: barra desligada não impede menus estilizados', () => {
    const css = generateStylesheet(buildTokens({
        panelStyle: 'none', palette: ['#294172'], styleMenus: true,
    }));
    assert(css.includes('.popup-menu-content'), 'menus deveriam sair');
    assert(!css.includes('#panel'), 'a barra não deveria sair');
});

test('fase 7: todas as superfícies ligadas continuam com !important', () => {
    const css = generateStylesheet(buildTokens({
        palette: ['#294172'], styleMenus: true, styleOsd: true, styleDock: true,
    }));
    const without = css.split('\n')
        .filter(line => line.trim().endsWith(';') && !line.includes('!important'));
    assertEqual(without, [], 'declarações sem !important:');
});

test('fase 7: borda do tiling segue o baseline e, vazia, o destaque', () => {
    const baseline = buildTokens({});
    assertEqual([baseline.tiling.border, baseline.tiling.width, baseline.tiling.radius],
        ['#9a9996', 3, 14], 'baseline do Forge:');
    assertEqual(baseline.tiling.followsAccent, false);

    const follow = buildTokens({tilingBorderColor: '', accentColor: '#51A2DA'});
    assertEqual(follow.tiling.border, '#51a2da');
    assert(follow.tiling.followsAccent, 'deveria seguir o destaque');
});

test('fase 7: SETTINGS_KEYS, PRESET_KEYS e o esquema concordam', () => {
    const schema = themeSchemaDefaults();
    for (const key of Object.keys(SETTINGS_KEYS))
        assert(key in schema, `chave do engine ausente no esquema: ${key}`);

    for (const key of Presets.PRESET_KEYS)
        assert(key in SETTINGS_KEYS, `chave de preset fora do engine: ${key}`);

    const notInPresets = Object.keys(SETTINGS_KEYS)
        .filter(key => !Presets.PRESET_KEYS.includes(key));
    assertEqual(notInPresets, ['palette'], 'só o cache da paleta fica fora dos presets:');

    // Toda chave de estilo do esquema é conhecida pelo engine (exceto o tema de Shell).
    const unknown = Object.keys(schema)
        .filter(key => !(key in SETTINGS_KEYS) && key !== 'shell-theme');
    assertEqual(unknown, [], 'chaves do esquema que o engine ignora:');
});

test('fase 7: DEFAULT_CONFIG reproduz todos os defaults do esquema', () => {
    const schema = themeSchemaDefaults();
    for (const [key, name] of Object.entries(SETTINGS_KEYS)) {
        const expected = schema[key].value;
        const actual = DEFAULT_CONFIG[name];
        assertEqual(typeof actual === 'string' ? actual.toLowerCase() : actual,
            typeof expected === 'string' ? expected.toLowerCase() : expected,
            `default de ${key}:`);
    }
});

test('presets: o preset "default" é exatamente o esquema (e o baseline)', () => {
    const schema = themeSchemaDefaults();
    const preset = Presets.findPreset('default');
    for (const key of Presets.PRESET_KEYS) {
        const a = preset.values[key];
        const b = schema[key].value;
        assertEqual(typeof a === 'string' ? a.toLowerCase() : a,
            typeof b === 'string' ? b.toLowerCase() : b, `preset default, ${key}:`);
    }
});

test('presets: cada preset define todas as chaves com valores válidos', () => {
    const schema = themeSchemaDefaults();
    const ids = new Set();

    for (const preset of Presets.PRESETS) {
        assert(!ids.has(preset.id), `id repetido: ${preset.id}`);
        ids.add(preset.id);

        assertEqual(Object.keys(preset.values).sort(), [...Presets.PRESET_KEYS].sort(),
            `chaves do preset ${preset.id}:`);

        for (const [key, value] of Object.entries(preset.values)) {
            const spec = schema[key];
            const where = `${preset.id}.${key}`;
            if (spec.type === 'b') {
                assertEqual(typeof value, 'boolean', `${where} tipo:`);
            } else if (['u', 'd', 'i'].includes(spec.type)) {
                assertEqual(typeof value, 'number', `${where} tipo:`);
                if (spec.type === 'u')
                    assert(Number.isInteger(value) && value >= 0, `${where} não é uint`);
                if (spec.min !== null)
                    assert(value >= spec.min && value <= spec.max,
                        `${where}=${value} fora de [${spec.min}, ${spec.max}]`);
            } else if (spec.nicks) {
                assert(spec.nicks.includes(value), `${where}='${value}' não é nick válido`);
            } else {
                assertEqual(typeof value, 'string', `${where} tipo:`);
                if (key.endsWith('color') && value !== '')
                    assert(Color.parseHex(value) !== null, `${where} cor inválida: ${value}`);
            }
        }
    }
    assert(!ids.has(Presets.CUSTOM_PRESET), 'nenhum preset pode usar o id reservado');
});

test('presets: matchPreset reconhece, detecta edição e ignora caixa das cores', () => {
    const fedora = {...Presets.findPreset('fedora').values};
    assertEqual(Presets.matchPreset(fedora), 'fedora');

    assertEqual(Presets.matchPreset({...fedora, 'accent-color': '#51a2da'}), 'fedora',
        'cor em minúsculas:');
    assertEqual(Presets.matchPreset({...fedora, 'panel-height': 31}), Presets.CUSTOM_PRESET,
        'um valor editado vira personalizado:');
    assertEqual(Presets.matchPreset({}), Presets.CUSTOM_PRESET, 'valores ausentes:');
});

test('CRITÉRIO fase 7: presets alteram barra, dock, menus e OSD de forma coerente', () => {
    for (const id of ['dark', 'minimal', 'fedora']) {
        const t = buildTokens(configFromKeys(Presets.findPreset(id).values));

        assert(t.panel.enabled && t.menu.enabled && t.osd.enabled && t.dock.enabled,
            `${id}: as quatro superfícies deveriam estar ligadas`);
        assert(t.panel.background && t.menu.background && t.osd.background,
            `${id}: todas deveriam ter cor resolvida`);
        assertEqual(t.dock.backgroundRgb, Color.parseHex(t.panel.backgroundHex),
            `${id}: dock e barra com a mesma base:`);

        // Mesmo destaque em todo lugar onde ele aparece.
        const accentUses = [t.osd.levelFill, t.dock.dotFocused];
        assert(accentUses.every(hex => hex === t.accent.hex), `${id}: destaque divergente`);

        // Legibilidade em cada superfície.
        const ratio = (bg, fg) => Color.contrastRatio(
            typeof bg === 'string' && bg.startsWith('#') ? Color.parseHex(bg)
                : /rgba\((\d+), (\d+), (\d+)/.exec(bg).slice(1).map(Number),
            Color.parseHex(fg));
        assert(ratio(t.panel.backgroundHex, t.panel.foreground) >= 4.5, `${id}: barra ilegível`);
        assert(ratio(t.menu.background, t.menu.foreground) >= 4.5, `${id}: menu ilegível`);
        assert(ratio(t.osd.background, t.osd.foreground) >= 4.5, `${id}: OSD ilegível`);

        const css = generateStylesheet(t);
        for (const selector of ['#panel {', '.popup-menu-content', '.osd-window', '.gnomecustom-dock-dot'])
            assert(css.includes(selector), `${id}: ${selector} ausente no CSS`);
    }

    // E o preset Adwaita devolve tudo ao tema: nada é gerado.
    const adwaita = buildTokens(configFromKeys(Presets.findPreset('adwaita').values));
    assertEqual(generateStylesheet(adwaita), '', 'Adwaita não deveria gerar CSS:');
});

// ----------------------------------------------------------------- estilo

test('style: publicar, observar, retirar e isolar falha de observador', () => {
    const service = new StyleService({logger: new Logger({level: 'silent', sink: new FakeSink()})});
    const seen = [];
    service.onChanged(() => {
        throw new Error('observador quebrado');
    });
    const unsubscribe = service.onChanged(tokens => seen.push(tokens));

    assertEqual(service.tokens, null, 'começa vazio:');
    service.publish({dock: {backgroundRgb: [1, 2, 3]}});
    assertEqual(service.tokens.dock.backgroundRgb, [1, 2, 3]);

    service.clear();
    assertEqual(service.tokens, null, 'após clear:');
    service.clear();
    assertEqual(seen.length, 2, 'clear repetido não notifica de novo:');

    unsubscribe();
    service.publish({});
    assertEqual(seen.length, 2, 'observador removido:');
    service.destroy();
});

// ------------------------------------------------------------- papel de parede

function makeWallpaper() {
    const background = new FakeSettings({
        'picture-uri': 'file:///fake/a.png', 'picture-uri-dark': 'file:///fake/a.png',
    });
    const iface = new FakeSettings({'color-scheme': 'prefer-dark'});
    const service = new WallpaperService({
        logger: new Logger({level: 'silent', sink: new FakeSink()}),
        backgroundSettings: background,
        interfaceSettings: iface,
    });
    return {service, background, iface};
}

test('papel de parede: rajada de mudanças agenda uma única extração', () => {
    const {service, background} = makeWallpaper();

    for (let i = 0; i < 5; i++)
        background.set('picture-uri-dark', `file:///fake/${i}.png`);

    assertEqual(service._signals.pending.sources, 1, 'temporizadores pendentes:');
    service.destroy();
    assertEqual(background.handlerCount, 0, 'sinais após destroy:');
});

test('papel de parede: troca durante a extração não é descartada', async () => {
    const {service} = makeWallpaper();

    // Extração controlada: só termina quando o teste manda.
    let finish;
    service._samplePixels = () => new Promise(resolve => {
        finish = () => resolve([[200, 30, 40], [10, 10, 10], [200, 30, 40]]);
    });
    let rescheduled = 0;
    service._schedule = () => rescheduled++;

    const first = service.extract({force: true});

    // Pedido que chega no meio da primeira extração.
    await service.extract({force: true});
    assertEqual(rescheduled, 0, 'ainda não deveria reagendar:');

    finish();
    const palette = await first;
    assert(palette.length > 0, 'a primeira extração deveria produzir paleta');
    assertEqual(rescheduled, 1, 'o pedido do meio deveria virar uma nova rodada:');
    service.destroy();
});

test('papel de parede: extração sem mudanças não roda de novo', async () => {
    const {service} = makeWallpaper();
    let calls = 0;
    service._samplePixels = () => {
        calls++;
        return Promise.resolve([[120, 60, 30]]);
    };

    await service.extract({force: true});
    await service.extract();

    assertEqual(calls, 1, 'a mesma URI não deveria ser relida:');
    service.destroy();
});

// ------------------------------------------------------------ tiling: árvore

const K = '0:0';

/** Árvore com as janelas inseridas em sequência, cada uma depois da anterior. */
function treeWith(...ids) {
    const tree = new TilingTree();
    let previous = null;
    for (const id of ids) {
        tree.insert(id, K, {after: previous});
        previous = id;
    }
    return tree;
}

test('árvore: inserir segue a janela de referência e cai no fim sem ela', () => {
    const tree = treeWith(1, 2, 3);
    assertEqual(tree.describe(K), 'h[1 2 3]');

    tree.insert(4, K, {after: 1});
    assertEqual(tree.describe(K), 'h[1 4 2 3]', 'depois da janela 1:');

    tree.insert(5, K);
    assertEqual(tree.describe(K), 'h[1 4 2 3 5]', 'sem referência vai para o fim:');

    assertEqual(tree.insert(5, K), false, 'id repetido é recusado:');
    assertEqual(tree.size, 5);
});

test('árvore: split com uma janela só muda a orientação; com várias, aninha', () => {
    const tree = treeWith(1);
    tree.split(1, 'v');
    assertEqual(tree.describe(K), 'v[1]', 'única janela:');

    tree.insert(2, K, {after: 1});
    assertEqual(tree.describe(K), 'v[1 2]');

    tree.split(2, 'h');
    tree.insert(3, K, {after: 2});
    assertEqual(tree.describe(K), 'v[1 h[2 3]]', 'a janela nova entra na divisão pedida:');
});

test('árvore: remover achata contêineres de um filho só', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});
    assertEqual(tree.describe(K), 'h[1 v[2 3]]');

    tree.remove(3);
    assertEqual(tree.describe(K), 'h[1 2]', 'contêiner com um filho some:');

    tree.remove(1);
    tree.remove(2);
    assertEqual(tree.describe(K), 'h[]', 'a raiz fica, vazia:');
    assertEqual(tree.remove(99), false, 'id desconhecido:');
});

test('árvore: raiz com um único contêiner herda a orientação dele', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]
    tree.remove(1);
    assertEqual(tree.describe(K), 'v[2 3]');
});

test('árvore: vizinho por direção em layout aninhado', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]

    assertEqual(tree.neighbor(1, 'right'), 2, '1 → direita:');
    assertEqual(tree.neighbor(3, 'left'), 1, '3 → esquerda sobe até a raiz:');
    assertEqual(tree.neighbor(2, 'down'), 3);
    assertEqual(tree.neighbor(3, 'up'), 2);
    assertEqual(tree.neighbor(1, 'up'), null, 'borda:');
    assertEqual(tree.neighbor(2, 'right'), null, 'borda direita:');
});

test('árvore: vizinho prefere a janela usada mais recentemente', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]

    assertEqual(tree.neighbor(1, 'right'), 2, 'sem histórico, a primeira:');
    assertEqual(tree.neighbor(1, 'right', {recent: [3, 2]}), 3, 'com histórico, a mais recente:');
});

test('árvore: swap troca lugares e tamanhos', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]
    tree.leaf(1).weight = 3;

    assert(tree.swap(1, 3), 'swap deveria funcionar');
    assertEqual(tree.describe(K), 'h[3 v[2 1]]');
    assertEqual([tree.leaf(3).weight, tree.leaf(1).weight], [3, 1], 'pesos acompanham o lugar:');
    assertEqual(tree.swap(1, 1), false, 'consigo mesma:');
});

test('árvore: mover troca com a vizinha e entra em contêineres', () => {
    const tree = treeWith(1, 2, 3);
    assertEqual(tree.move(1, 'right'), {moved: true, edge: false});
    assertEqual(tree.describe(K), 'h[2 1 3]', 'troca com a vizinha:');

    tree.split(3, 'v');
    tree.insert(4, K, {after: 3});   // h[2 1 v[3 4]]
    tree.move(1, 'right');
    assertEqual(tree.describe(K), 'h[2 v[1 3 4]]', 'entra no contêiner pela ponta de onde veio:');
});

test('árvore: mover sai do contêiner perpendicular', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]

    tree.move(3, 'right');
    assertEqual(tree.describe(K), 'h[1 2 3]', 'sai pela direita:');

    const other = treeWith(1, 2);
    other.split(2, 'v');
    other.insert(3, K, {after: 2});  // h[1 v[2 3]]
    other.move(2, 'left');
    assertEqual(other.describe(K), 'h[1 2 3]', 'sai pela esquerda, ficando ao lado do ramo:');
});

test('árvore: mover na ponta de raiz perpendicular envolve a raiz', () => {
    const tree = treeWith(1, 2);
    tree.split(1, 'v');              // raiz com uma janela vira v… depois 2 entra
    const fresh = new TilingTree();
    fresh.insert(1, K);
    fresh.split(1, 'v');
    fresh.insert(2, K, {after: 1});  // v[1 2]

    assertEqual(fresh.move(2, 'right'), {moved: true, edge: false});
    assertEqual(fresh.describe(K), 'h[1 2]', 'a janela vai para o lado:');

    void tree;
});

test('árvore: borda real é reportada, e aninhamento na mesma orientação não engana', () => {
    const tree = treeWith(1, 2);
    assertEqual(tree.move(2, 'right'), {moved: false, edge: true}, 'ponta da raiz:');
    assertEqual(treeWith(1).move(1, 'left'), {moved: false, edge: true}, 'janela única:');

    // h[1 h[2 3]]: mover 3 para a direita não muda nada visualmente → borda.
    const nested = treeWith(1, 2);
    nested.split(2, 'h');
    nested.insert(3, K, {after: 2});
    assertEqual(nested.describe(K), 'h[1 h[2 3]]');
    assertEqual(nested.move(3, 'right'), {moved: false, edge: true});
    assertEqual(nested.describe(K), 'h[1 h[2 3]]', 'a árvore não deveria mudar:');
});

test('árvore: sair de contêiner aninhado não deixa contêiner vazio', () => {
    // h[1 v[h[2] 3]]: a janela 2 está num contêiner de um filho só, dentro de v.
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});   // h[1 v[2 3]]
    tree.split(2, 'h');              // h[1 v[h[2] 3]]
    assertEqual(tree.describe(K), 'h[1 v[h[2] 3]]');

    tree.move(2, 'left');
    assertEqual(tree.describe(K), 'h[1 2 3]', 'sem contêiner vazio nem de um filho no caminho:');

    // Mesmo caso pela raiz perpendicular: v[h[1] 2] movendo 1 para a direita.
    const root = new TilingTree();
    root.insert(1, K);
    root.split(1, 'v');
    root.insert(2, K, {after: 1});   // v[1 2]
    root.split(1, 'h');              // v[h[1] 2]
    root.move(1, 'right');
    assertEqual(root.describe(K), 'h[2 1]');
});

for (const seed of [7, 42, 1234, 98765]) test(`árvore: mover preserva todas as janelas (invariante, semente ${seed})`, () => {
    runRandomInvariant(seed);
});

function runRandomInvariant(initialSeed) {
    const tree = treeWith(1, 2, 3, 4, 5, 6);
    const directions = ['left', 'right', 'up', 'down'];
    let seed = initialSeed;
    const rand = n => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
    };

    for (let step = 0; step < 1500; step++) {
        const id = 1 + rand(6);
        const op = rand(4);
        if (op === 0)
            tree.split(id, rand(2) ? 'h' : 'v');
        else if (op === 1)
            tree.move(id, directions[rand(4)]);
        else if (op === 2)
            tree.swap(id, 1 + rand(6));
        else
            tree.toggleLayout(id);

        const ids = tree.ids(K).sort((a, b) => a - b);
        assertEqual(ids, [1, 2, 3, 4, 5, 6], `passo ${step}: janelas perdidas ou duplicadas:`);

        // Nenhum contêiner vazio abaixo da raiz, e pais coerentes. (Contêiner de
        // um filho só é legítimo: é o que o split deixa à espera da próxima janela.)
        const check = (node, parent) => {
            if (node.parent !== parent)
                throw new Error(`passo ${step}: ponteiro de pai incoerente em ${tree.describe(K)}`);
            if (node.kind === 'split') {
                if (parent && node.children.length === 0)
                    throw new Error(`passo ${step}: contêiner vazio: ${tree.describe(K)}`);
                node.children.forEach(child => check(child, node));
            }
        };
        check(tree.root(K), null);
    }
}

test('árvore: moveToKey leva a janela para outro monitor', () => {
    const tree = treeWith(1, 2);
    assert(tree.moveToKey(2, '1:0'), 'deveria mover');
    assertEqual(tree.keyOf(2), '1:0');
    assertEqual(tree.describe(K), 'h[1]');
    assertEqual(tree.describe('1:0'), 'h[2]');
    assertEqual(tree.moveToKey(2, '1:0'), false, 'mesma chave:');
});

test('árvore: redimensionar passa espaço ao vizinho e respeita o mínimo', () => {
    const tree = treeWith(1, 2);
    const area = {x: 0, y: 0, width: 1000, height: 500};
    let layout = computeLayout(tree, K, area);

    assert(tree.resize(1, 'right', 100, layout.containers), 'deveria redimensionar');
    layout = computeLayout(tree, K, area);
    assertEqual([layout.windows.get(1).width, layout.windows.get(2).width], [600, 400]);

    // Borda esquerda da janela 1 está na tela: o espaço vem do outro lado.
    assert(tree.resize(1, 'left', 100, layout.containers), 'deveria usar o lado oposto');
    layout = computeLayout(tree, K, area);
    assertEqual(layout.windows.get(1).width, 700);

    // Encolher muito para no mínimo de 10%.
    tree.resize(1, 'right', -5000, layout.containers);
    layout = computeLayout(tree, K, area);
    assertEqual(layout.windows.get(1).width, 100, 'mínimo de 10% do contêiner:');

    assertEqual(tree.resize(1, 'up', 50, layout.containers), false, 'sem vizinho vertical:');
});

// ----------------------------------------------------------- tiling: layout

test('layout: distribuição soma exatamente o total', () => {
    assertEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
    assertEqual(distribute(1000, [1, 1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0), 1000);
    assertEqual(distribute(10, [0, 0]), [5, 5], 'pesos inválidos viram iguais:');
    for (const total of [1, 7, 333, 1599, 2560]) {
        const sizes = distribute(total, [0.3, 1.7, 1, 2.2]);
        assertEqual(sizes.reduce((a, b) => a + b, 0), total, `total ${total}:`);
    }
});

test('layout: fórmula de gaps do Forge (2·gap entre janelas e na borda)', () => {
    const tree = treeWith(1, 2);
    const area = {x: 0, y: 32, width: 1600, height: 868};
    const {windows} = computeLayout(tree, K, area, {gap: 2, smartGaps: true});

    assertEqual(windows.get(1), {x: 4, y: 36, width: 794, height: 860});
    assertEqual(windows.get(2), {x: 802, y: 36, width: 794, height: 860});
    const between = windows.get(2).x - (windows.get(1).x + windows.get(1).width);
    assertEqual(between, 4, 'espaço entre janelas:');
});

test('layout: janela única sem gaps, e sem a opção, com gaps', () => {
    const tree = treeWith(1);
    const area = {x: 0, y: 32, width: 1600, height: 868};
    assertEqual(computeLayout(tree, K, area, {gap: 2}).windows.get(1), area, 'smart gaps:');
    assertEqual(computeLayout(tree, K, area, {gap: 2, smartGaps: false}).windows.get(1),
        {x: 4, y: 36, width: 1592, height: 860});
});

test('layout: janelas fora do tiling não ocupam espaço', () => {
    const tree = treeWith(1, 2, 3);
    const area = {x: 0, y: 0, width: 900, height: 600};
    const {windows} = computeLayout(tree, K, area, {isTiled: id => id !== 2});
    assertEqual(windows.has(2), false);
    assertEqual([windows.get(1).width, windows.get(3).width], [450, 450]);

    const empty = computeLayout(tree, K, area, {isTiled: () => false});
    assertEqual(empty.windows.size, 0, 'tudo minimizado:');
});

test('layout: layout aninhado cobre a área sem sobreposição', () => {
    const tree = treeWith(1, 2);
    tree.split(2, 'v');
    tree.insert(3, K, {after: 2});
    tree.split(3, 'h');
    tree.insert(4, K, {after: 3});  // h[1 v[2 h[3 4]]]
    const area = {x: 10, y: 20, width: 1001, height: 777};
    const {windows} = computeLayout(tree, K, area);

    const cells = [...windows.values()];
    assertEqual(cells.reduce((sum, r) => sum + r.width * r.height, 0), area.width * area.height,
        'as áreas somam a área útil:');
    for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
            const [a, b] = [cells[i], cells[j]];
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
                a.y < b.y + b.height && b.y < a.y + a.height;
            assert(!overlap, `janelas ${i} e ${j} se sobrepõem`);
        }
    }
});

test('layout: inset não some com janelas minúsculas', () => {
    assertEqual(inset({x: 0, y: 0, width: 3, height: 50}, 2), {x: 0, y: 0, width: 3, height: 50});
});

// ----------------------------------------------------------- tiling: regras

const win = (over = {}) => ({
    wmClass: 'org.gnome.TextEditor', title: 'Documento', type: 'normal',
    transient: false, allowsResize: true, ...over,
});

test('regras: tipo da janela decide antes das regras', () => {
    assert(Rules.floatsByType(win({type: 'dialog'})), 'diálogo');
    assert(Rules.floatsByType(win({type: 'modal-dialog'})), 'diálogo modal');
    assert(Rules.floatsByType(win({transient: true})), 'transitória');
    assert(Rules.floatsByType(win({title: ''})), 'sem título');
    assert(Rules.floatsByType(win({wmClass: null})), 'sem classe');
    assert(Rules.floatsByType(win({allowsResize: false})), 'tamanho fixo');
    assert(!Rules.floatsByType(win()), 'janela comum');
});

test('regras: semântica de correspondência do Forge', () => {
    const splash = {wmClass: 'jetbrains-idea', wmTitle: 'splash', mode: 'float'};
    assert(Rules.ruleMatches(splash, win({wmClass: 'jetbrains-idea', title: 'splash'})), 'título contém');
    assert(!Rules.ruleMatches(splash, win({wmClass: 'jetbrains-idea', title: 'Projeto'})), 'título diferente');

    const list = {wmClass: 'firefox', wmTitle: 'About Mozilla Firefox,Library', mode: 'float'};
    assert(Rules.ruleMatches(list, win({wmClass: 'firefox', title: 'Library'})), 'item da lista');

    const negated = {wmClass: 'code', wmTitle: '!Visual Studio Code', mode: 'float'};
    assert(Rules.ruleMatches(negated, win({wmClass: 'code', title: 'Abrir pasta'})), 'negação casa');
    assert(!Rules.ruleMatches(negated, win({wmClass: 'code', title: 'x - Visual Studio Code'})), 'negação não casa');

    const space = {wmClass: 'zoom', wmTitle: ' ', mode: 'float'};
    assert(Rules.ruleMatches(space, win({wmClass: 'zoom', title: ' '})), 'título espaço');
    assert(!Rules.ruleMatches(space, win({wmClass: 'zoom', title: 'Reunião'})), 'espaço é exato');

    // A classe da regra *contém* a classe da janela (comportamento do Forge).
    assert(Rules.ruleMatches({wmClass: 'org.gnome.Calculator', mode: 'float'},
        win({wmClass: 'org.gnome.Calculator'})), 'classe exata');
});

test('regras: as padrão são as 28 do Forge, sem nenhum wmId', () => {
    const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(),
        'reference', 'forge', 'config', 'windows.json']));
    if (!file.query_exists(null)) {
        print('        (reference/forge ausente: comparação com o Forge ignorada)');
    } else {
        const forge = JSON.parse(new TextDecoder().decode(file.load_contents(null)[1])).overrides;
        assertEqual(Rules.DEFAULT_RULES.map(r => [r.wmClass, r.wmTitle ?? null]),
            forge.map(r => [r.wmClass, r.wmTitle ?? null]), 'regras padrão:');
    }
    assertEqual(Rules.DEFAULT_RULES.length, 28);
    assert(Rules.DEFAULT_RULES.every(r => !('wmId' in r)), 'nenhuma regra por id');
});

test('regras: ler descarta wmId, aceita o formato do Forge e rejeita lixo', () => {
    const forgeFormat = JSON.stringify({overrides: [
        {wmClass: 'org.gnome.Calculator', mode: 'float'},
        {wmClass: 'google-chrome', wmId: 2694494745, mode: 'float'},
        {wmClass: 'org.gnome.Ptyxis', wmId: 2694494746, mode: 'float'},
        {wmTitle: 'sem classe', mode: 'float'},
    ]});
    const parsed = Rules.parseRules(forgeFormat);
    assertEqual(parsed.rules, [{wmClass: 'org.gnome.Calculator', mode: 'float'}]);
    assertEqual([parsed.droppedById, parsed.invalid], [2, 1]);

    assertEqual(Rules.parseRules('isto não é json'), {rules: [], droppedById: 0, invalid: 1});
    assertEqual(Rules.parseRules(Rules.serializeRules([...Rules.DEFAULT_RULES])).rules.length, 28,
        'ida e volta:');
});

test('regras: sempre-flutuar alterna por classe e nunca grava id', () => {
    const base = [{wmClass: 'jetbrains-idea', wmTitle: 'splash', mode: 'float'}];

    const on = Rules.toggleClassRule(base, 'google-chrome');
    assertEqual(on.floating, true);
    assertEqual(on.rules.at(-1), {wmClass: 'google-chrome', mode: 'float'});
    assert(!Rules.serializeRules(on.rules).includes('wmId'), 'sem wmId no JSON');

    const off = Rules.toggleClassRule(on.rules, 'google-chrome');
    assertEqual([off.floating, off.rules], [false, base]);

    const titled = Rules.toggleClassRule(base, 'jetbrains-idea');
    assertEqual(titled.rules.length, 2, 'regra com título não conta como regra de classe:');
});

// --------------------------------------------------------- tiling: geometria

test('geometria: snaps de 1/3 e 2/3 com gap, centro e flutuante', () => {
    const area = {x: 0, y: 32, width: 1500, height: 868};
    assertEqual(Geometry.snapRect(area, 'left', 1 / 3, 2), {x: 2, y: 34, width: 496, height: 864});
    assertEqual(Geometry.snapRect(area, 'right', 2 / 3, 0), {x: 500, y: 32, width: 1000, height: 868});
    assertThrows(() => Geometry.snapRect(area, 'up', 0.5));

    assertEqual(Geometry.centerRect(area, {x: 5, y: 5, width: 500, height: 300}),
        {x: 500, y: 316, width: 500, height: 300});
    assertEqual(Geometry.centerRect(area, {width: 9000, height: 9000}), area, 'limitado à área:');

    assertEqual(Geometry.floatRect(area), {x: 263, y: 141, width: 975, height: 651});
    assert(Geometry.containsPoint(area, 0, 32) && !Geometry.containsPoint(area, 1500, 32), 'contém');
});

// ------------------------------------------------ tiling: atalhos e esquema

test('tiling: catálogo, esquema de atalhos e baseline do Forge concordam', () => {
    const read = name => new TextDecoder().decode(Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_current_dir(), ...name])).load_contents(null)[1]);

    const schema = read(['gnomeCustom@gfiamoncini.com', 'schemas',
        'org.gnome.shell.extensions.gnomecustom.tiling.keybindings.gschema.xml']);
    const inSchema = [...schema.matchAll(/<key name="([^"]+)" type="as">\s*<default>([^<]*)<\/default>/g)]
        .map(([, key, value]) => [key, value.replace(/&lt;/g, '<').replace(/&gt;/g, '>')]);
    assertEqual(inSchema.map(([key]) => key), TILING_ACTIONS.map(spec => spec.key), 'chaves:');

    const keys = new Set();
    for (const spec of TILING_ACTIONS) {
        assert(!keys.has(spec.key), `chave repetida: ${spec.key}`);
        keys.add(spec.key);
    }

    // Baseline: todo atalho do Forge do usuário existe, com o mesmo valor —
    // exceto "sempre flutuar", que o usuário desligou depois da captura.
    const baseline = read(['baseline', 'dconf-ext-forge.ini']);
    const section = baseline.slice(baseline.indexOf('[keybindings]'));
    const forgeKeys = [...section.matchAll(/^([a-z-]+)=(\[.*\])$/gm)];
    assertEqual(forgeKeys.length, 39, 'atalhos no baseline:');

    for (const [, key, value] of forgeKeys) {
        const spec = TILING_ACTIONS.find(s => s.key === key);
        assert(spec, `atalho do baseline sem ação: ${key}`);
        const baselineAccels = [...value.matchAll(/'([^']+)'/g)].map(m => m[1]);
        if (key === 'window-toggle-always-float')
            assertEqual(spec.accels, [], 'sempre flutuar nasce sem atalho (decisão do usuário):');
        else
            assertEqual(spec.accels, baselineAccels, `${key}:`);
    }
});

test('tiling: o padrão de window-rules do esquema é o das regras padrão', () => {
    const xml = new TextDecoder().decode(Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_current_dir(), 'gnomeCustom@gfiamoncini.com', 'schemas',
        'org.gnome.shell.extensions.gnomecustom.tiling.gschema.xml'])).load_contents(null)[1]);
    const raw = /<key name="window-rules" type="s">\s*<default>'([\s\S]*?)'<\/default>/.exec(xml)[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\\'/g, "'");
    assertEqual(raw, Rules.serializeRules([...Rules.DEFAULT_RULES]));
});

// ------------------------------------------------------- tiling: geometria 2

test('geometria: grabEdges decodifica os valores do Mutter 17', () => {
    assertEqual(Geometry.grabEdges(1), {moving: true, resizing: false, keyboard: false, edges: []}, 'moving:');
    assertEqual(Geometry.grabEdges(1025).moving, true, 'moving_unconstrained:');
    assertEqual(Geometry.grabEdges(257), {moving: true, resizing: false, keyboard: true, edges: []}, 'keyboard_moving:');
    assertEqual(Geometry.grabEdges(8193).edges, ['right'], 'resizing_e:');
    assertEqual(Geometry.grabEdges(36865).edges, ['up', 'left'], 'resizing_nw:');
    assertEqual(Geometry.grabEdges(24577).edges, ['down', 'right'], 'resizing_se:');
    assertEqual(Geometry.grabEdges(8449), {moving: false, resizing: true, keyboard: true, edges: ['right']}, 'keyboard_resizing_e:');
    assertEqual(Geometry.grabEdges(769).resizing, true, 'keyboard_resizing_unknown:');
    assertEqual(Geometry.grabEdges(0), {moving: false, resizing: false, keyboard: false, edges: []}, 'none:');
});

test('geometria: deslocamento de bordas, borda de foco e vizinho geométrico', () => {
    const before = {x: 100, y: 100, width: 400, height: 300};
    assertEqual(Geometry.edgeDeltas(before, {x: 80, y: 100, width: 460, height: 300}, ['left', 'right']),
        {left: 20, right: 40});
    assertEqual(Geometry.edgeDeltas(before, before, ['up']), {}, 'sem mudança:');

    const frame = {x: 100, y: 100, width: 400, height: 300};
    assertEqual(Geometry.borderRect(frame, 3, 2), {x: 97, y: 97, width: 406, height: 306}, 'no gap:');
    assertEqual(Geometry.borderRect(frame, 3, 0), frame, 'sem gap, por dentro:');
    assertEqual(Geometry.borderRect(frame, 8, 1), {x: 98, y: 98, width: 404, height: 304}, 'limitada a 2·gap:');

    const from = {x: 400, y: 400, width: 100, height: 100};
    const candidates = [
        {id: 1, rect: {x: 700, y: 400, width: 100, height: 100}},   // direita, alinhada
        {id: 2, rect: {x: 600, y: 800, width: 100, height: 100}},   // direita, bem abaixo
        {id: 3, rect: {x: 100, y: 400, width: 100, height: 100}},   // esquerda
    ];
    assertEqual(Geometry.nearestInDirection(from, candidates, 'right'), 1, 'prefere alinhada:');
    assertEqual(Geometry.nearestInDirection(from, candidates, 'left'), 3);
    assertEqual(Geometry.nearestInDirection(from, candidates, 'up'), null, 'nada acima:');
});

test('atalhos: forma canônica e colisões com o sistema', () => {
    assertEqual(normalizeAccel('<Super>V'), '<super>v');
    assertEqual(normalizeAccel('<Shift><Control><Super>i'), normalizeAccel('<Super><Primary><Shift>I'));

    const collisions = findCollisions(
        [{key: 'con-split-vertical', accels: ['<Super>v']}, {key: 'window-focus-left', accels: ['<Super>Left']}],
        [{schema: 'org.gnome.shell.keybindings', key: 'toggle-message-tray', accels: ['<Super>v', '<Super>m']}]);
    assertEqual(collisions, [{accel: '<Super>v', ours: 'con-split-vertical',
        schema: 'org.gnome.shell.keybindings', theirs: 'toggle-message-tray'}]);
});

// ---------------------------------------------------- tiling: controlador

/**
 * Controlador sobre o sistema falso. As gravações pedidas voltam por
 * `setConfig` na mesma pilha, como acontece com o GSettings no Shell.
 */
function makeTiling({monitors, workspaces, config = {}} = {}) {
    const ws = new FakeWindowSystem({monitors, workspaces});
    const requests = [];
    let renders = 0;
    const toConfig = {
        'tiling-mode': 'tilingMode', 'focus-border': 'focusBorder',
        'gap-increment': 'gapIncrement', 'skip-workspaces': 'skipWorkspaces', 'window-rules': 'rules',
    };
    const controller = new TilingController({
        windows: ws,
        logger: new Logger({level: 'silent', sink: new FakeSink()}),
        requestRender: () => renders++,
        onRequestSetting: (key, value) => {
            requests.push([key, value]);
            controller.setConfig({[toConfig[key]]: value});
        },
    });
    controller.setConfig({rules: [...Rules.DEFAULT_RULES], ...config});
    return {ws, controller, requests, renders: () => renders};
}

const rectOf = (ws, id) => ws.frameRect(id);

test('controlador: split seguido de janela nova abre dentro da divisão', () => {
    // O bug visto no Shell era o adaptador descartar o foco de janelas ainda não
    // prontas; isso é conferido ao vivo. Aqui fica o contrato do controlador.

    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();

    // Como no Shell: o foco chega na janela nova antes de ela ser adicionada.
    const c = ws.add();
    ws.focused = c;
    controller.focusChanged(c);
    controller.windowAdded(c);
    controller.run({type: 'split', orientation: 'v'});

    const d = ws.add();
    ws.focused = d;
    controller.focusChanged(d);
    controller.windowAdded(d);

    assertEqual(controller.tree.describe('0:0'), `h[${a} ${b} v[${c} ${d}]]`);
});

test('controlador: não repete o pedido enquanto o cliente não confirma o tamanho', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    ws.deferConfigure = true;
    controller.start();

    assertEqual(controller.render(), 2, 'primeiro layout pede as duas:');
    assertEqual(controller.render(), 0, 'antes da confirmação, não pede de novo:');

    ws.configureAll();
    assertEqual(controller.render(), 0, 'confirmado, nada a fazer:');

    // Movida por fora (estado mudou): o layout precisa repor, mesmo retângulo.
    ws.deferConfigure = false;
    ws.windows.get(a).rect = {x: 0, y: 0, width: 10, height: 10};
    controller.windowChanged(a, 'maximized');
    assertEqual(controller.render(), 1, 'depois de mudança externa, repõe:');
    void b;
});

test('controlador: adota as janelas em ordem visual e aplica os gaps do baseline', () => {
    const {ws, controller} = makeTiling();
    const right = ws.add({rect: {x: 900, y: 50, width: 300, height: 300}});
    const left = ws.add({rect: {x: 50, y: 50, width: 300, height: 300}});
    ws.focused = right;

    controller.start();
    controller.render();

    assertEqual(controller.tree.ids('0:0'), [left, right], 'ordem visual:');
    assertEqual(rectOf(ws, left), {x: 4, y: 36, width: 794, height: 860});
    assertEqual(rectOf(ws, right), {x: 802, y: 36, width: 794, height: 860});
    assertEqual(controller.render(), 0, 'segundo render não move nada:');
});

test('controlador: janela nova entra depois da usada antes dela', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    const c = ws.add();
    controller.start();
    controller.focusChanged(a);

    const d = ws.add();
    ws.focused = d;               // o foco já passou para a janela nova
    controller.focusChanged(d);
    controller.windowAdded(d);

    assertEqual(controller.tree.ids('0:0'), [a, d, b, c]);
});

test('controlador: diálogos, regras e skip-taskbar ficam fora da árvore', () => {
    const {ws, controller} = makeTiling();
    const normal = ws.add();
    const dialog = ws.add({type: 'dialog'});
    const calculator = ws.add({wmClass: 'org.gnome.Calculator'});
    const splash = ws.add({wmClass: 'jetbrains-idea', title: 'splash'});
    const hidden = ws.add({skipTaskbar: true});
    controller.start();

    assertEqual(controller.tree.ids('0:0'), [normal]);
    for (const id of [dialog, calculator, splash, hidden])
        assert(!controller.isTiled(id), `janela ${id} não deveria estar na árvore`);
});

test('controlador: flutuar por janela é só memória, centraliza e fica no topo', () => {
    const {ws, controller, requests} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();
    controller.render();
    ws.focused = b;

    assert(controller.run({type: 'float-toggle'}), 'deveria flutuar');
    assert(!controller.isTiled(b) && controller.isFloating(b));
    assertEqual(rectOf(ws, b), Geometry.floatRect(ws.workArea(0)), 'centralizada 65×75%:');
    assert(ws.above.has(b), 'sempre no topo');
    controller.render();
    assertEqual(rectOf(ws, a), ws.workArea(0), 'a outra ocupa tudo, sem gaps:');

    assert(controller.run({type: 'float-toggle'}), 'deveria voltar');
    assert(controller.isTiled(b) && !ws.above.has(b), 'volta ao tiling e sai do topo');
    assertEqual(requests, [], 'flutuar por janela nunca grava configuração:');
});

test('controlador: sempre-flutuar grava regra de classe e centraliza (regressão de ordem)', () => {
    const {ws, controller, requests} = makeTiling();
    ws.add();
    const chrome = ws.add({wmClass: 'google-chrome'});
    controller.start();
    controller.render();
    ws.focused = chrome;

    controller.run({type: 'float-class-toggle'});

    assertEqual(requests.length, 1);
    const [key, rules] = requests[0];
    assertEqual(key, 'window-rules');
    assertEqual(rules.at(-1), {wmClass: 'google-chrome', mode: 'float'});
    assert(!JSON.stringify(rules).includes('wmId'), 'sem wmId');
    assert(!controller.isTiled(chrome), 'a regra tirou a janela da árvore');
    assertEqual(rectOf(ws, chrome), Geometry.floatRect(ws.workArea(0)),
        'centralizada mesmo com a regra voltando na mesma pilha:');

    controller.run({type: 'float-class-toggle'});
    assert(controller.isTiled(chrome), 'desligar a regra devolve ao tiling');
    assert(!ws.above.has(chrome), 'e tira do topo');
});

test('controlador: foco por direção na árvore, entre monitores e a partir de flutuante', () => {
    const {ws, controller} = makeTiling({monitors: [{width: 1600, height: 900}, {width: 1280, height: 720}]});
    const a = ws.add();
    const b = ws.add();
    const c = ws.add({monitor: 1});
    controller.start();
    controller.render();

    ws.focused = a;
    controller.run({type: 'focus', direction: 'right'});
    assertEqual(ws.focused, b, 'vizinha na árvore:');

    controller.run({type: 'focus', direction: 'right'});
    assertEqual(ws.focused, c, 'borda → monitor vizinho:');

    controller.run({type: 'focus', direction: 'left'});
    assertEqual(ws.focused, b, 'e de volta, pela mais recente:');

    const floater = ws.add({type: 'dialog', rect: {x: 50, y: 300, width: 200, height: 200}});
    controller.windowAdded(floater);
    ws.focused = floater;
    assert(controller.run({type: 'focus', direction: 'right'}), 'flutuante usa geometria');
    assert([a, b].includes(ws.focused), 'focou uma janela à direita');
});

test('controlador: mover na borda leva a janela ao monitor vizinho', () => {
    const {ws, controller} = makeTiling({monitors: [{width: 1600, height: 900}, {width: 1280, height: 720}]});
    const a = ws.add();
    const b = ws.add();
    const c = ws.add({monitor: 1, workspace: -1});   // monitor secundário: "em todas"
    controller.start();
    controller.render();
    ws.focused = b;

    assert(controller.run({type: 'move', direction: 'right'}), 'deveria ir para o outro monitor');
    assertEqual(controller.tree.keyOf(b), '1:*', 'entra na chave que já existe ali:');
    controller.render();
    assertEqual(ws.describe(b).monitor, 1);
    assertEqual(rectOf(ws, a), ws.workArea(0), 'a que ficou ocupa o monitor:');
    assertEqual(controller.tree.ids('1:*'), [c, b]);
});

test('controlador: swap por direção e com a janela anterior', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    const c = ws.add();
    controller.start();

    ws.focused = a;
    controller.run({type: 'swap', direction: 'right'});
    assertEqual(controller.tree.ids('0:0'), [b, a, c]);

    controller.focusChanged(c);
    controller.focusChanged(a);
    ws.focused = a;
    controller.run({type: 'swap-last'});
    assertEqual(controller.tree.ids('0:0'), [b, c, a], 'troca com a usada antes:');
});

test('controlador: maximizada (inclusive pelo auto-maximize do Mutter) volta ao tiling', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add({maximized: true, rect: ws.workArea(0)});
    controller.start();
    controller.render();

    assert(!ws.describe(b).maximized, 'o layout desmaximiza');
    assertEqual([rectOf(ws, a).width, rectOf(ws, b).width], [794, 794], 'e divide o espaço:');

    ws.set(b, {maximized: true});
    ws.windows.get(b).rect = ws.workArea(0);
    controller.windowChanged(b, 'maximized');
    controller.render();
    assertEqual(rectOf(ws, b).width, 794, 'maximizar uma janela em tiling é desfeito, como no Forge:');
});

test('controlador: minimizada e tela cheia guardam o lugar sem ocupar espaço', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();
    controller.render();

    for (const state of ['minimized', 'fullscreen']) {
        ws.set(b, {[state]: true});
        controller.windowChanged(b, state);
        controller.render();
        assertEqual(rectOf(ws, a), ws.workArea(0), `${state}: a outra ocupa tudo:`);
        assert(controller.isTiled(b), `${state}: continua na árvore`);

        ws.set(b, {[state]: false});
        controller.windowChanged(b, state);
        controller.render();
        assertEqual(rectOf(ws, a).width, 794, `${state}: volta a dividir:`);
    }
});

test('controlador: só a área de trabalho ativa é renderizada, e dá para pular uma', () => {
    const {ws, controller, requests} = makeTiling({workspaces: 2});
    const a = ws.add({workspace: 0});
    const b = ws.add({workspace: 1, rect: {x: 5, y: 5, width: 100, height: 100}});
    controller.start();
    controller.render();

    assertEqual(rectOf(ws, b), {x: 5, y: 5, width: 100, height: 100}, 'área inativa intocada:');

    ws.active = 1;
    controller.workspaceSwitched();
    controller.render();
    assertEqual(rectOf(ws, b), ws.workArea(0), 'ao trocar, é renderizada:');

    controller.run({type: 'workspace-toggle'});
    assertEqual(requests.at(-1), ['skip-workspaces', [1]], 'valor explícito:');
    assert(!controller.isTiled(b) && controller.isTiled(a), 'só a área pulada solta as janelas');

    controller.run({type: 'workspace-toggle'});
    assertEqual(requests.at(-1), ['skip-workspaces', []]);
    assert(controller.isTiled(b), 'volta');
});

test('controlador: desligar o tiling solta tudo e desfaz o "no topo"', () => {
    const {ws, controller, requests} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();
    ws.focused = b;
    controller.run({type: 'float-toggle'});
    assert(ws.above.has(b));

    controller.run({type: 'setting-toggle', setting: 'tiling-mode'});
    assertEqual(requests.at(-1), ['tiling-mode', false], 'valor explícito, não "alternar":');
    assertEqual(controller.tree.size, 0, 'nenhuma janela na árvore');
    assert(!ws.above.has(b), 'no topo desfeito');

    controller.run({type: 'setting-toggle', setting: 'tiling-mode'});
    assertEqual(controller.tree.ids('0:0').sort(), [a, b].sort(), 'religado, readota as duas');
});

test('controlador: gaps por atalho com limites e valores explícitos', () => {
    const {controller, requests} = makeTiling();
    controller.start();
    controller.run({type: 'gap', amount: 1});
    assertEqual(requests.at(-1), ['gap-increment', 2]);
    assertEqual(controller.gap, 4, 'tamanho × passo:');

    controller.setConfig({gapIncrement: GAP_INCREMENT_MAX});
    assertEqual(controller.run({type: 'gap', amount: 1}), false, 'no máximo não pede nada:');
    controller.setConfig({gapIncrement: 0});
    assertEqual(controller.run({type: 'gap', amount: -1}), false, 'no zero também:');
});

test('controlador: redimensionar por teclado e pelo mouse muda os pesos', () => {
    const {ws, controller} = makeTiling({config: {gapSize: 0}});
    const a = ws.add();
    const b = ws.add();
    controller.start();
    controller.render();
    ws.focused = a;

    controller.run({type: 'resize', edge: 'right', sign: 1});
    controller.render();
    assertEqual([rectOf(ws, a).width, rectOf(ws, b).width], [815, 785], 'resize-amount 15:');

    // Arrasto da borda direita de `a` com o mouse (resizing_e = 8193).
    controller.grabBegin(a, 8193);
    ws.moveResize(a, {...rectOf(ws, a), width: rectOf(ws, a).width + 100});
    controller.render();
    assertEqual(rectOf(ws, a).width, 915, 'durante o arrasto o layout não briga:');
    controller.grabEnd(a, 8193);
    controller.render();
    assertEqual([rectOf(ws, a).width, rectOf(ws, b).width], [915, 685], 'o arrasto vira peso:');
});

test('controlador: arrastar sobre outra janela troca; em outro monitor, muda de árvore', () => {
    const {ws, controller} = makeTiling({monitors: [{width: 1600, height: 900}, {width: 1280, height: 720}]});
    const a = ws.add();
    const b = ws.add();
    controller.start();
    controller.render();

    controller.grabBegin(a, 1);
    ws.pointerAt = [1200, 400];              // sobre `b`
    controller.grabEnd(a, 1);
    assertEqual(controller.tree.ids('0:0'), [b, a], 'troca:');

    controller.grabBegin(a, 1);
    ws.pointerAt = [2000, 300];              // monitor 1, vazio
    controller.grabEnd(a, 1);
    assertEqual(controller.tree.keyOf(a), '1:0', 'foi para o outro monitor:');

    controller.setConfig({dragSwap: false});
    controller.grabBegin(b, 1);
    ws.pointerAt = [2000, 300];
    controller.grabEnd(b, 1);
    assertEqual(controller.tree.keyOf(b), '0:0', 'sem drag-swap, nada muda:');
});

test('controlador: snap solta só aquela janela; divisão automática segue o lado maior', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();
    ws.focused = b;

    controller.run({type: 'snap', side: 'right', fraction: 2 / 3});
    assertEqual(rectOf(ws, b), Geometry.snapRect(ws.workArea(0), 'right', 2 / 3, 2));
    assert(controller.isFloating(b) && controller.isTiled(a), 'só a do snap flutua');

    const auto = makeTiling({config: {autoSplit: true}});
    const wide = auto.ws.add({rect: {x: 0, y: 0, width: 1000, height: 400}});
    auto.controller.start();
    auto.controller.focusChanged(wide);
    const tall = auto.ws.add();
    auto.controller.windowAdded(tall);
    assertEqual(auto.controller.tree.describe('0:0'), 'h[' + wide + ' ' + tall + ']',
        'janela única: split só muda a orientação da raiz (larga → h):');
});

test('controlador: janela fechada sai e o resto se reorganiza; stop não move nada', () => {
    const {ws, controller} = makeTiling();
    const a = ws.add();
    const b = ws.add();
    controller.start();
    controller.render();

    ws.remove(b);
    controller.windowRemoved(b);
    controller.render();
    assertEqual(rectOf(ws, a), ws.workArea(0));

    ws.focused = a;
    controller.run({type: 'float-toggle'});
    const moves = ws.moves.length;
    controller.stop();
    assertEqual(ws.moves.length, moves, 'stop não mexe nas janelas:');
    assert(!ws.above.has(a), 'mas desfaz o "no topo"');
    assertEqual(controller.run({type: 'focus', direction: 'left'}), false, 'parado não age:');
});

test('controlador: janela que muda de monitor por fora vai para a árvore certa', () => {
    const {ws, controller} = makeTiling({monitors: [{width: 1600, height: 900}, {width: 1280, height: 720}]});
    const a = ws.add();
    controller.start();
    ws.set(a, {monitor: 1});
    controller.windowChanged(a, 'monitor');
    assertEqual(controller.tree.keyOf(a), '1:0');
    assertEqual(keyFor({monitor: 1, workspace: -1}), '1:*');
});

// ---------------------------------------------------------------- migração

const readText = (...parts) => {
    const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), ...parts]));
    return file.query_exists(null) ? new TextDecoder().decode(file.load_contents(null)[1]) : null;
};

/** Seções de um `dconf dump`: {'/': {chave: valor}, 'keybindings': {...}}. */
function parseDconfDump(text) {
    const sections = {};
    let current = null;
    for (const line of (text ?? '').split('\n')) {
        const header = /^\[(.*)\]$/.exec(line.trim());
        if (header) {
            current = sections[header[1]] = {};
            continue;
        }
        const eq = line.indexOf('=');
        if (!current || eq < 0)
            continue;
        const key = line.slice(0, eq);
        current[key] = GLib.Variant.parse(null, line.slice(eq + 1), null, null).recursiveUnpack();
    }
    return sections;
}

/** Baseline de cada fonte: arquivo do dump e seção de cada esquema. */
const BASELINE_DUMPS = {
    'dash-to-dock': ['dconf-ext-dash-to-dock.ini', {main: '/'}],
    'forge': ['dconf-ext-forge.ini', {main: '/', keybindings: 'keybindings'}],
    'openbar': ['dconf-ext-openbar.ini', {main: '/'}],
    'user-theme': ['dconf-ext-user-theme.ini', {main: '/'}],
    'impatience': ['dconf-ext-net.ini', {main: 'gfxmonk/impatience'}],
    'gnome-ui-tune': ['dconf-ext-gnome-ui-tune.ini', {main: '/'}],
    'logomenu': ['dconf-ext-Logo-menu.ini', {main: '/'}],
    'bluetooth-battery': ['dconf-ext-bluetooth_battery_indicator.ini', {main: '/'}],
    'osd-volume-number': ['dconf-ext-osd-volume-number.ini', {main: '/'}],
    'spotify-controls': ['dconf-ext-spotify-controls.ini', {main: '/'}],
    'apps-menu': [null, {main: '/'}],
};

/** Roda um importador sobre o baseline do usuário. */
function importBaseline(id) {
    const source = Migration.findSource(id);
    const [dump, sectionOf] = BASELINE_DUMPS[id];
    const sections = parseDconfDump(dump ? readText('baseline', dump) : '');
    const read = (key, schema = 'main') => {
        const section = sections[sectionOf[schema]] ?? {};
        return key in section ? section[key] : source.defaults[schema]?.[key];
    };
    const file = name => ({
        'forge-windows': readText('baseline', 'forge-windows.json'),
        'forge-stylesheet': readText('baseline', 'forge-stylesheet.css'),
    })[name] ?? null;
    return source.run({read, file});
}

/** Defaults dos nossos esquemas, por esquema filho. */
function ourDefaults(schemaName) {
    const fileName = schemaName
        ? `org.gnome.shell.extensions.gnomecustom.${schemaName}.gschema.xml`
        : 'org.gnome.shell.extensions.gnomecustom.gschema.xml';
    const xml = readText('gnomeCustom@gfiamoncini.com', 'schemas', fileName);
    const values = {};
    const re = /<key name="([^"]+)"(?: type="([^"]+)")?(?: enum="[^"]+")?>\s*<default>([\s\S]*?)<\/default>/g;
    for (const [, key, type, raw] of xml.matchAll(re)) {
        const text = raw.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        values[key] = type
            ? GLib.Variant.parse(new GLib.VariantType(type), text, null, null).recursiveUnpack()
            : text.replace(/^'|'$/g, '');
    }
    return values;
}

const approxEqual = (a, b) => typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 1e-6
    : JSON.stringify(a) === JSON.stringify(b);

test('migração: conversões de cor e da borda do Forge', () => {
    assertEqual(Migration.openBarColorToHex(['0.110', '0.443', '0.847']), '#1C71D8');
    assertEqual(Migration.openBarColorToHex(['x']), null);

    const border = Migration.parseForgeBorder(readText('baseline', 'forge-stylesheet.css'));
    assertEqual(border, {color: '#9A9996', width: 3, radius: 14}, 'baseline do usuário:');
    assertEqual(Migration.parseForgeBorder('.outra { }'), null);
});

test('CRITÉRIO fase 9: importar o baseline reproduz os padrões do GnomeCustom', () => {
    // Os padrões dos nossos esquemas foram ajustados ao baseline do usuário; se
    // os importadores estiverem certos, importar a configuração dele não muda
    // nada — com as exceções conhecidas abaixo, que são mudanças posteriores
    // à captura ou decisões registradas.
    const known = new Set([
        'theme/shell-theme',            // padrão vazio; o usuário tem Orchis
        'tiling/window-rules',          // o baseline tem os fantasmas por wmId (descartados)
        'tiling.keybindings/window-toggle-always-float',   // desligado depois da captura
        'menu/show-lock', 'menu/show-power',               // Logo Menu escondia; o nosso mostra
    ]);

    const differences = [];
    let total = 0;
    for (const source of Migration.SOURCES) {
        const {writes} = importBaseline(source.id);
        for (const write of writes) {
            total++;
            const defaults = ourDefaults(write.schema);
            assert(write.key in defaults, `${source.id}: chave de destino inexistente ${write.schema}/${write.key}`);
            const ours = defaults[write.key];
            const same = approxEqual(ours, write.value) ||
                (typeof ours === 'string' && typeof write.value === 'string' &&
                 ours.toLowerCase() === write.value.toLowerCase());
            if (!same && !known.has(`${write.schema}/${write.key}`))
                differences.push(`${source.id}: ${write.schema}/${write.key} nosso=${JSON.stringify(ours)} importado=${JSON.stringify(write.value)}`);
        }
    }
    assert(total > 60, `poucas gravações: ${total}`);
    assertEqual(differences, [], 'divergências inesperadas:');
});

test('migração: Forge descarta regras por wmId e traz os 39 atalhos', () => {
    const {writes, notes} = importBaseline('forge');
    const rules = JSON.parse(writes.find(w => w.key === 'window-rules').value);
    assert(rules.every(rule => !('wmId' in rule)), 'nenhuma regra por id');
    assert(notes.some(n => /id de janela descartada/.test(n.reason)), 'o descarte é relatado');

    const bindings = writes.filter(w => w.schema === 'tiling.keybindings');
    assertEqual(bindings.length, 39);
    assertEqual(bindings.find(w => w.key === 'con-split-vertical').value, ['<Super>v']);
});

test('migração: Logo Menu converte comandos e inverte os "hide"', () => {
    const {writes} = importBaseline('logomenu');
    const get = key => writes.find(w => w.key === key)?.value;
    assertEqual(get('icon-source'), 'distro', 'symbolic-icon=false no baseline:');
    assertEqual(get('icon-size'), 19);
    assertEqual(get('show-activities'), false);
    assertEqual([get('show-force-quit'), get('show-software')], [true, true], 'hide-* invertidos:');
    assertEqual([get('show-lock'), get('show-power')], [false, false], 'padrões do Logo Menu:');
    assertEqual(get('software-app'), 'org.gnome.Software.desktop');
    assertEqual(get('terminal-app'), '', 'gnome-terminal padrão vira o terminal do sistema:');
    assertEqual(get('extensions-app'), 'com.mattjakeman.ExtensionManager.desktop');
});

test('migração: Open Bar do baseline vira a barra flutuante com paleta', () => {
    const {writes, notes} = importBaseline('openbar');
    const get = key => writes.find(w => w.key === key)?.value;
    assertEqual(get('panel-style'), 'floating');
    assertEqual([get('panel-height'), get('panel-margin-top'), get('panel-margin-sides')], [29, 1.5, 4.5]);
    assertEqual([get('palette-from-wallpaper'), get('background-color'), get('accent-color')], [true, '', '#1C71D8']);
    assertEqual([get('style-menus'), get('style-dock')], [false, false]);
    assert(notes.length > 0, 'o que não tem equivalente é relatado');
});

test('migração: fontes sem destino só produzem notas, e ninguém escreve fora do GnomeCustom', () => {
    for (const id of ['bluetooth-battery', 'osd-volume-number']) {
        const {writes, notes} = importBaseline(id);
        assertEqual(writes, [], `${id} não grava:`);
        assert(id === 'osd-volume-number' || notes.length > 0, `${id} explica`);
    }

    const valid = new Set(['', 'theme', 'panel', 'menu', 'dock', 'overview', 'animation', 'media',
        'tiling', 'tiling.keybindings', 'bluetooth']);
    for (const source of Migration.SOURCES) {
        for (const write of importBaseline(source.id).writes)
            assert(valid.has(write.schema), `${source.id} escreve em esquema desconhecido: ${write.schema}`);
    }
});

test('migração: Dash to Dock sem dados usa os padrões dele e explica o que não existe', () => {
    const source = Migration.findSource('dash-to-dock');
    const {writes, notes} = source.run({read: key => source.defaults.main[key], file: () => null});
    assertEqual(writes.find(w => w.key === 'icon-size').value, 48);
    assert(!writes.some(w => w.key === 'background-opacity'), 'transparência do tema não vira número');
    const reasons = notes.map(n => n.from);
    for (const key of ['dock-fixed', 'show-trash', 'show-mounts', 'transparency-mode'])
        assert(reasons.includes(key), `nota para ${key}`);
});

test('migração: padrões declarados batem com os esquemas instalados (quando existem)', () => {
    let checked = 0;
    for (const source of Migration.SOURCES) {
        const dirs = [
            GLib.build_filenamev([GLib.get_home_dir(), '.local/share/gnome-shell/extensions', source.uuid, 'schemas']),
            GLib.build_filenamev(['/usr/share/gnome-shell/extensions', source.uuid, 'schemas']),
        ];
        const dir = dirs.find(d => GLib.file_test(`${d}/gschemas.compiled`, GLib.FileTest.EXISTS));
        if (!dir)
            continue;
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(dir, null, false);
        for (const [schemaName, defaults] of Object.entries(source.defaults)) {
            const schema = schemaSource.lookup(source.schemas[schemaName], false);
            if (!schema)
                continue;
            for (const [key, declared] of Object.entries(defaults)) {
                if (!schema.has_key(key))
                    throw new Error(`${source.id}: chave ${key} não existe no esquema instalado`);
                let real = schema.get_key(key).get_default_value().recursiveUnpack();
                if (key === 'custom-icon-path')
                    real = String(real).replace(/^''$/, '');
                assert(approxEqual(real, declared),
                    `${source.id}: padrão de ${key} declarado ${JSON.stringify(declared)}, instalado ${JSON.stringify(real)}`);
                checked++;
            }
        }
    }
    if (checked === 0)
        print('        (nenhuma extensão original instalada: conferência ignorada)');
});

// ------------------------------------------------------------------ perfis

test('perfis: todos cobrem os 10 módulos, citam presets reais e têm ids únicos', () => {
    assertEqual(Profiles.unknownPresets(), [], 'presets inexistentes:');
    const ids = new Set();
    for (const profile of Profiles.PROFILES) {
        assert(!ids.has(profile.id), `id repetido: ${profile.id}`);
        ids.add(profile.id);
        assertEqual(Object.keys(profile.modules).sort(), [...Profiles.PROFILE_MODULES].sort(),
            `${profile.id}: módulos:`);
        for (const [schema, keys] of Object.entries(profile.values)) {
            const defaults = ourDefaults(schema);
            for (const key of Object.keys(keys))
                assert(key in defaults, `${profile.id}: chave inexistente ${schema}/${key}`);
        }
    }
    assert(!ids.has(Profiles.CUSTOM_PROFILE), 'id reservado');

    // Os 10 módulos do perfil são exatamente os implementados (menos o diagnóstico).
    const implemented = MODULES_INFO.filter(i => i.implemented && i.id !== 'diagnostics').map(i => i.id).sort();
    assertEqual([...Profiles.PROFILE_MODULES].sort(), implemented, 'módulos cobertos:');
});

test('perfis: estado padrão é "Nada ligado" e o Desktop é o baseline', () => {
    const readDefault = (schema, key) => ourDefaults(schema)[key];
    const modulesFrom = (fn) => Object.fromEntries(Profiles.PROFILE_MODULES.map(id => [id, fn(id)]));

    assertEqual(Profiles.matchProfile({
        modules: modulesFrom(id => ourDefaults('')[`${id}-enabled`]),
        themePreset: 'default',
        read: readDefault,
    }), 'off', 'esquema recém-instalado:');

    // Desktop = todos ligados + padrões do esquema (que são o baseline).
    assertEqual(Profiles.matchProfile({
        modules: modulesFrom(() => true), themePreset: 'default', read: readDefault,
    }), 'desktop', 'baseline com tudo ligado:');

    assertEqual(Profiles.matchProfile({
        modules: {...modulesFrom(() => true), dock: false}, themePreset: 'default', read: readDefault,
    }), Profiles.CUSTOM_PROFILE, 'um módulo diferente vira personalizado:');
});

test('perfis: conflitos só com extensões ativas que o perfil substituiria', () => {
    const desktop = Profiles.findProfile('desktop');
    const gaming = Profiles.findProfile('gaming');
    const active = new Set(['forge@jmmaranan.com', 'dash-to-dock@micxgx.gmail.com']);
    const isEnabled = uuid => active.has(uuid);

    assertEqual(Profiles.conflictsFor(desktop, KNOWN_EXTENSIONS, isEnabled).map(c => c.name).sort(),
        ['Dash to Dock', 'Forge']);
    assertEqual(Profiles.conflictsFor(gaming, KNOWN_EXTENSIONS, isEnabled), [],
        'sem tiling nem dock, Forge e Dash to Dock não conflitam:');
});

// -------------------------------------------------------------- os-release

test('os-release: interpreta o formato', () => {
    const fields = parseOsRelease([
        '# comentário',
        'NAME="Fedora Linux"',
        'ID=fedora',
        "VERSION_ID='43'",
        'LOGO=fedora-logo-icon',
        '',
        'linha inválida sem igual',
    ].join('\n'));

    assertEqual(fields.NAME, 'Fedora Linux', 'aspas duplas removidas:');
    assertEqual(fields.ID, 'fedora');
    assertEqual(fields.VERSION_ID, '43', 'aspas simples removidas:');
    assertEqual(fields.LOGO, 'fedora-logo-icon');
    assertEqual(Object.hasOwn(fields, '# comentário'), false, 'comentário ignorado:');
});

test('os-release: entrada vazia não quebra', () => {
    assertEqual(parseOsRelease(''), {});
});

// ------------------------------------------------------------------ volume

test('volume: nível vira porcentagem inteira', () => {
    assertEqual(formatLevel(0), '0');
    assertEqual(formatLevel(0.42), '42');
    assertEqual(formatLevel(1), '100');
    assertEqual(formatLevel(1.5), '150', 'amplificação:');
    assertEqual(formatLevel(0.004), '0', 'arredondamento:');
    assertEqual(formatLevel(-0.1), '0', 'negativo:');
    assertEqual(formatLevel(NaN), '', 'valor inválido:');
});

/** Serviço `osd` falso, sobre uma janela de mentira com `show()`. */
function makeFakeOsd({failOnShow = false} = {}) {
    class FakeOsdWindow {
        show() {
            this.shown = (this.shown ?? 0) + 1;
            return 'original';
        }
    }

    const osd = {
        windowPrototype: FakeOsdWindow.prototype,
        calls: [],
        restored: 0,
        showNumber(window, options) {
            if (failOnShow)
                throw new Error('falha proposital');
            this.calls.push({window, options});
        },
        restoreAll() {
            this.restored++;
        },
        destroy() {},
    };

    return {osd, FakeOsdWindow};
}

test('volume: o serviço recebe a janela antes do show original, e o patch é revertido', () => {
    const {osd, FakeOsdWindow} = makeFakeOsd();
    const original = FakeOsdWindow.prototype.show;
    const {lifecycle, injections} = makeLifecycle(defaultValues({'volume-enabled': true}),
        {modules: [VolumeModule], serviceFactories: {osd: () => osd}});

    lifecycle.enable();
    assert(FakeOsdWindow.prototype.show !== original, 'show deveria estar substituído');

    const window = new FakeOsdWindow();
    assertEqual(window.show(), 'original', 'retorno do show:');
    assertEqual(window.shown, 1, 'o show original deveria rodar:');
    assertEqual(osd.calls.length, 1, 'chamadas ao serviço:');
    assert(osd.calls[0].window === window, 'o serviço deveria receber a própria janela');
    assertEqual(osd.calls[0].options.format(0.5), '50', 'formatador repassado:');

    lifecycle.disable();
    assert(FakeOsdWindow.prototype.show === original, 'show deveria voltar ao original');
    assertEqual(osd.restored, 1, 'restoreAll:');
    assertEqual(injections.filter(m => m.pending > 0).length, 0, 'patches pendentes:');

    window.show();
    assertEqual(osd.calls.length, 1, 'depois de desativar, o serviço não deveria ser chamado:');
});

test('volume: falha no serviço não impede o OSD de aparecer', () => {
    const {osd, FakeOsdWindow} = makeFakeOsd({failOnShow: true});
    const {lifecycle, sink} = makeLifecycle(
        defaultValues({'volume-enabled': true, 'log-level': 'error'}),
        {modules: [VolumeModule], serviceFactories: {osd: () => osd}});

    lifecycle.enable();
    const window = new FakeOsdWindow();
    assertEqual(window.show(), 'original', 'retorno do show:');
    assertEqual(window.shown, 1, 'o show original deveria rodar mesmo com a falha:');
    assert(sink.count('error') > 0, 'a falha deveria ter sido registrada');
    lifecycle.disable();
});

test('volume: desligar e religar a chave a quente troca o patch', () => {
    const {osd, FakeOsdWindow} = makeFakeOsd();
    const original = FakeOsdWindow.prototype.show;
    const {lifecycle, extension} = makeLifecycle(defaultValues({'volume-enabled': true}),
        {modules: [VolumeModule], serviceFactories: {osd: () => osd}});

    lifecycle.enable();
    extension.base.set('volume-enabled', false);
    assert(FakeOsdWindow.prototype.show === original, 'desligado: show deveria ser o original');
    assertEqual(osd.restored, 1, 'restoreAll ao desligar:');

    extension.base.set('volume-enabled', true);
    assert(FakeOsdWindow.prototype.show !== original, 'religado: show deveria estar substituído');

    lifecycle.disable();
    assert(FakeOsdWindow.prototype.show === original, 'após disable: show deveria ser o original');
});

// ------------------------------------------------------------------- mpris

test('mpris: id do player vem do nome no barramento', () => {
    assertEqual(Mpris.playerIdFromBusName('org.mpris.MediaPlayer2.spotify'), 'spotify');
    assertEqual(Mpris.playerIdFromBusName('org.mpris.MediaPlayer2.firefox.instance_1_42'),
        'firefox', 'firefox:');
    assertEqual(Mpris.playerIdFromBusName('org.mpris.MediaPlayer2.chromium.instance12345'),
        'chromium', 'chromium:');
    assertEqual(Mpris.playerIdFromBusName('org.gnome.Shell'), null, 'nome que não é MPRIS:');
    assertEqual(Mpris.playerIdFromBusName('org.mpris.MediaPlayer2.'), null, 'sem id:');
    assertEqual(Mpris.playerIdFromBusName(null), null);
});

test('mpris: metadados do Spotify são normalizados', () => {
    // Formato lido do Spotify real em 2026-09-10.
    const track = Mpris.normalizeMetadata({
        'mpris:trackid': '/com/spotify/track/6uqfE8hJTLb3j5O8OZaAt9',
        'mpris:length': 309213000,
        'mpris:artUrl': 'https://i.scdn.co/image/ab67616d0000b273506db8d0c288b0533eb180a1',
        'xesam:album': 'In Sorte Diaboli',
        'xesam:artist': ['Dimmu Borgir'],
        'xesam:title': 'The Serpentine Offering',
    });

    assertEqual(track.title, 'The Serpentine Offering');
    assertEqual(track.artists, ['Dimmu Borgir']);
    assertEqual(track.album, 'In Sorte Diaboli');
    assertEqual(track.length, 309213000);
    assert(track.artUrl.startsWith('https://i.scdn.co/'), `artUrl: ${track.artUrl}`);
    assertEqual(Mpris.trackSubtitle(track), 'Dimmu Borgir / In Sorte Diaboli');
});

test('mpris: metadados ausentes ou tortos não quebram', () => {
    assertEqual(Mpris.normalizeMetadata(null),
        {trackId: '', title: '', artists: [], album: '', artUrl: '', length: 0});

    const odd = Mpris.normalizeMetadata({'xesam:artist': 'Só uma string', 'mpris:length': -5});
    assertEqual(odd.artists, ['Só uma string'], 'artista como string:');
    assertEqual(odd.length, 0, 'duração negativa:');
    assertEqual(Mpris.trackSubtitle({artists: [], album: ''}), '', 'subtítulo vazio:');
});

test('mpris: só players permitidos aparecem, e tocando vence pausado', () => {
    const track = {title: 'x'};
    const players = [
        {id: 'firefox', status: 'Playing', track},
        {id: 'spotify', status: 'Paused', track},
        {id: 'vlc', status: 'Playing', track},
    ];

    assertEqual(Mpris.pickPlayer(players, ['spotify'])?.id, 'spotify', 'só o spotify permitido:');
    assertEqual(Mpris.pickPlayer(players, ['spotify', 'vlc'])?.id, 'vlc', 'tocando vence pausado:');
    assertEqual(Mpris.pickPlayer(players, ['vlc', 'firefox'])?.id, 'vlc', 'empate segue a ordem:');
    assertEqual(Mpris.pickPlayer(players, []), null, 'nenhum permitido:');
});

test('mpris: player parado ou sem faixa não aparece', () => {
    const players = [
        {id: 'spotify', status: 'Stopped', track: {title: 'x'}},
        {id: 'vlc', status: 'Playing', track: {title: ''}},
    ];
    assertEqual(Mpris.pickPlayer(players, ['spotify', 'vlc']), null);
});

test('mpris: posição estimada corre só tocando e para no fim', () => {
    const anchor = {position: 10e6, at: 1000, playing: true, rate: 1};

    assertEqual(Mpris.estimatePosition(anchor, 1000 + 5e6), 15e6, 'tocando:');
    assertEqual(Mpris.estimatePosition({...anchor, playing: false}, 1000 + 5e6), 10e6, 'pausado:');
    assertEqual(Mpris.estimatePosition(anchor, 1000 + 60e6, 30e6), 30e6, 'limitada à duração:');
    assertEqual(Mpris.estimatePosition(anchor, 0), 10e6, 'relógio para trás não volta o tempo:');
});

test('mpris: fração de progresso e tempo formatado', () => {
    assertEqual(Mpris.progressFraction(15e6, 60e6), 0.25);
    assertEqual(Mpris.progressFraction(90e6, 60e6), 1, 'acima do fim:');
    assertEqual(Mpris.progressFraction(10e6, 0), 0, 'duração desconhecida:');

    assertEqual(Mpris.formatTime(0), '0:00');
    assertEqual(Mpris.formatTime(309213000), '5:09', 'duração real:');
    assertEqual(Mpris.formatTime(3725e6), '1:02:05', 'mais de uma hora:');
    assertEqual(Mpris.formatTime(NaN), '0:00', 'valor inválido:');
});

test('mpris: lista de permitidos preserva a ordem', () => {
    assertEqual(Mpris.toggleAllowed(['spotify'], 'vlc', true), ['spotify', 'vlc']);
    assertEqual(Mpris.toggleAllowed(['spotify', 'vlc'], 'spotify', true), ['spotify', 'vlc'],
        'já presente:');
    assertEqual(Mpris.toggleAllowed(['spotify', 'vlc'], 'spotify', false), ['vlc'], 'removido:');
    assertEqual(Mpris.toggleAllowed([], 'vlc', false), [], 'remover ausente:');
});

/** Retrato de player como o serviço `mpris` entrega. */
function playerSnapshot(id, status, {title = 'Faixa', can = {}} = {}) {
    return {busName: `org.mpris.MediaPlayer2.${id}`, id, status, track: {title}, can};
}

test('mpris: comando vai ao player da barra, ou ao primeiro permitido aberto', () => {
    const spotify = playerSnapshot('spotify', 'Stopped');
    const vlc = playerSnapshot('vlc', 'Playing');
    const firefox = playerSnapshot('firefox', 'Playing');

    assertEqual(Mpris.pickControlTarget([spotify, vlc], ['spotify', 'vlc'])?.id, 'vlc', 'da barra:');
    assertEqual(Mpris.pickControlTarget([spotify, firefox], ['spotify'])?.id, 'spotify',
        'parado ainda recebe tocar:');
    assertEqual(Mpris.pickControlTarget([firefox], ['spotify']), null, 'não permitido:');
});

test('mpris: propriedades Can* decidem o comando; ausentes permitem', () => {
    assert(Mpris.canInvoke(playerSnapshot('a', 'Playing'), 'Next'), 'sem Can* deveria permitir');
    assert(!Mpris.canInvoke(null, 'PlayPause'), 'sem player');
    assert(!Mpris.canInvoke(playerSnapshot('a', 'Playing', {can: {next: false}}), 'Next'));
    assert(Mpris.canInvoke(playerSnapshot('a', 'Playing', {can: {next: null}}), 'Next'),
        'desconhecido permite');
    assert(!Mpris.canInvoke(playerSnapshot('a', 'Playing', {can: {pause: false}}), 'PlayPause'),
        'tocando sem pausa');
    assert(Mpris.canInvoke(playerSnapshot('a', 'Paused', {can: {pause: false}}), 'PlayPause'),
        'pausado usa CanPlay');
    assert(!Mpris.canInvoke(playerSnapshot('a', 'Paused', {can: {control: false}}), 'Previous'),
        'CanControl falso bloqueia tudo');
    assert(!Mpris.canInvoke(playerSnapshot('a', 'Paused'), 'Seek'), 'método desconhecido');
    assertEqual(Mpris.playPauseIcon('Playing'), 'media-playback-pause-symbolic');
    assertEqual(Mpris.playPauseIcon('Paused'), 'media-playback-start-symbolic');
});

test('mpris: ações de mídia têm chave com prefixo e método MPRIS', () => {
    assertEqual(Mpris.MEDIA_ACTIONS.map(a => a.method), ['PlayPause', 'Next', 'Previous']);
    for (const {key} of Mpris.MEDIA_ACTIONS)
        assert(key.startsWith('shortcut-'), key);
});

test('atalhos: captura aceita só combinações seguras', () => {
    assert(Shortcuts.isModifierKeyName('Super_L'));
    assert(Shortcuts.isModifierKeyName('ISO_Level3_Shift'));
    assert(!Shortcuts.isModifierKeyName('p'));

    assert(Shortcuts.acceptShortcut('Up', true), 'com modificador');
    assert(!Shortcuts.acceptShortcut('p', false), 'letra sozinha rouba a digitação');
    assert(Shortcuts.acceptShortcut('F9', false), 'tecla de função');
    assert(!Shortcuts.acceptShortcut('F99', false));
    assert(Shortcuts.acceptShortcut('XF86AudioPlay', false), 'tecla de mídia');
    assert(!Shortcuts.acceptShortcut('Control_L', true), 'só modificador');
    assert(!Shortcuts.acceptShortcut('', true));
});

test('atalhos: entrada vazia não colide, e os padrões de mídia não colidem com o mosaico', () => {
    assertEqual(Shortcuts.findCollisions([{key: 'a', accels: ['']}],
        [{schema: 's', key: 'b', accels: ['']}]), []);

    const media = Mpris.MEDIA_ACTIONS.map(({key}) => ({key,
        accels: [`<Control><Alt><Super>${{'shortcut-play-pause': 'Up', 'shortcut-next': 'Right', 'shortcut-previous': 'Left'}[key]}`]}));
    const tiling = TILING_ACTIONS.map(spec => ({schema: 'tiling', key: spec.key, accels: spec.accels}));
    assertEqual(Shortcuts.findCollisions(media, tiling), []);
});

test('cor: fundo escurecido até o texto branco passar do AA', () => {
    const white = [255, 255, 255];
    for (const color of [[255, 230, 90], [200, 200, 200], [30, 144, 255], [20, 20, 20]]) {
        const result = Color.darkenForContrast(color, white, 4.5);
        const ratio = Color.contrastRatio(result, white);
        assert(ratio >= 4.5, `${color} ficou com contraste ${ratio.toFixed(2)}`);
    }
    assertEqual(Color.darkenForContrast([20, 20, 20], white), [20, 20, 20],
        'cor já escura não deveria mudar:');
});

// --------------------------------------------------------------- bluetooth

/** Objetos como o `GetManagedObjects` real devolveu em 2026-09-10, resumidos. */
function bluezObjects() {
    return {
        '/org/bluez/hci0': {'org.bluez.Adapter1': {Powered: true, Alias: 'fedora'}},
        '/org/bluez/hci0/dev_84_D3_52_AB_7E_D7': {
            'org.bluez.Device1': {
                Address: '84:D3:52:AB:7E:D7', Alias: 'JBL Tune 720BT', Name: 'JBL Tune 720BT',
                Icon: 'audio-headset', Paired: true, Bonded: true, Connected: true,
            },
            'org.bluez.Battery1': {Percentage: 80},
            'org.bluez.MediaControl1': {Connected: true},
        },
        '/org/bluez/hci0/dev_F6_A0_03_AE_F8_38': {
            'org.bluez.Device1': {
                Address: 'F6:A0:03:AE:F8:38', Alias: 'AULA-F99Pro 5.0', Icon: 'input-keyboard',
                Paired: true, Connected: true,
            },
            'org.bluez.Battery1': {Percentage: 93, Source: 'GATT Battery Service'},
        },
        '/org/bluez/hci0/dev_F6_A0_03_AE_F8_38/service000f': {'org.bluez.GattService1': {Primary: true}},
    };
}

function loadBluezState(objects = bluezObjects()) {
    const state = new Map();
    for (const [path, interfaces] of Object.entries(objects))
        Bt.addInterfaces(state, path, interfaces);
    return state;
}

test('bluetooth: o estado guarda só dispositivos e baterias', () => {
    const state = loadBluezState();
    assertEqual([...state.keys()].sort(),
        ['/org/bluez/hci0/dev_84_D3_52_AB_7E_D7', '/org/bluez/hci0/dev_F6_A0_03_AE_F8_38']);

    const jbl = Bt.devicesFromState(state).find(d => d.address === '84:D3:52:AB:7E:D7');
    assertEqual(jbl, {
        path: '/org/bluez/hci0/dev_84_D3_52_AB_7E_D7',
        address: '84:D3:52:AB:7E:D7',
        name: 'JBL Tune 720BT',
        icon: 'audio-headset-symbolic',
        paired: true,
        connected: true,
        battery: 80,
    });
});

test('bluetooth: mudança de bateria e remoção de interface', () => {
    const state = loadBluezState();
    const path = '/org/bluez/hci0/dev_84_D3_52_AB_7E_D7';
    const find = () => Bt.devicesFromState(state).find(d => d.path === path);

    assert(Bt.changeProperties(state, path, Bt.BATTERY_IFACE, {Percentage: 15}),
        'a bateria deveria mudar');
    assertEqual(find().battery, 15);
    assertEqual(Bt.changeProperties(state, '/org/bluez/desconhecido', Bt.DEVICE_IFACE,
        {Connected: true}), false, 'objeto desconhecido:');

    Bt.removeInterfaces(state, path, [Bt.BATTERY_IFACE]);
    assertEqual(find().battery, null, 'sem Battery1:');

    Bt.removeInterfaces(state, path, [Bt.DEVICE_IFACE]);
    assert(!state.has(path), 'sem nenhuma interface o objeto deveria sair do estado');
});

test('bluetooth: o card mostra conectados, e os desconectados pelo card até fechar', () => {
    const devices = [
        {path: '/a', name: 'Zeta', paired: true, connected: true},
        {path: '/b', name: 'Alfa', paired: true, connected: true},
        {path: '/c', name: 'Beta', paired: true, connected: false},
        {path: '/d', name: 'Estranho', paired: false, connected: true},
    ];

    assertEqual(Bt.visibleDevices(devices).map(d => d.path), ['/b', '/a'],
        'só pareados e conectados, por nome:');
    assertEqual(Bt.visibleDevices(devices, new Set(['/c'])).map(d => d.path), ['/b', '/a', '/c'],
        'desconectado mantido vem por último:');
});

test('bluetooth: ícone simbólico e bateria baixa', () => {
    assertEqual(Bt.symbolicIcon('audio-headset'), 'audio-headset-symbolic');
    assertEqual(Bt.symbolicIcon('audio-card'), 'audio-speakers-symbolic', 'apelido:');
    assertEqual(Bt.symbolicIcon(''), 'bluetooth-active-symbolic', 'sem ícone:');
    assertEqual(Bt.symbolicIcon(undefined), 'bluetooth-active-symbolic');

    assert(Bt.isLowBattery(20, 20), 'no limite é baixa');
    assert(!Bt.isLowBattery(21, 20), 'acima do limite não é');
    assert(!Bt.isLowBattery(5, 0), 'limite 0 desliga o aviso');
    assert(!Bt.isLowBattery(null, 20), 'sem bateria não é baixa');
});

test('bluetooth: nome cai para o endereço e a porcentagem é limitada', () => {
    const device = Bt.normalizeDevice('/x', {
        [Bt.DEVICE_IFACE]: {Address: 'AA:BB:CC:DD:EE:FF'},
        [Bt.BATTERY_IFACE]: {Percentage: 130},
    });
    assertEqual(device.name, 'AA:BB:CC:DD:EE:FF');
    assertEqual(device.battery, 100);
    assertEqual(device.paired, false);
});

// -------------------------------------------------------------------- dock

test('dock: tamanho de ícone respeita o limite e o espaço', () => {
    assertEqual(Dock.pickIconSize(1000, 24), 24, 'espaço de sobra, limite 24:');
    assertEqual(Dock.pickIconSize(23, 24), 22, 'espaço para 23 px:');
    assertEqual(Dock.pickIconSize(5, 24), 16, 'nunca abaixo de 16:');
    assertEqual(Dock.pickIconSize(1000, 30), 24, 'limite fora da lista:');
    assertEqual(Dock.pickIconSize(40, 64, 2), 16, 'escala 2 dobra o custo:');
    assertEqual(Dock.pickIconSize(48, 64, 2), 24, 'escala 2 com espaço exato:');
});

test('dock: pontos por janela vão até quatro', () => {
    assertEqual([0, 1, 3, 4, 9].map(n => Dock.dotsCount(n)), [0, 1, 3, 4, 4]);
    assertEqual(Dock.dotsCount(NaN), 0, 'valor inválido:');
});

test('dock: cliques seguem os padrões do Dash to Dock', () => {
    const base = {running: true, focused: false, inOverview: false};

    assertEqual(Dock.decideClick({...base, button: 1}), 'activate-first', 'app sem foco:');
    assertEqual(Dock.decideClick({...base, button: 1, focused: true}), 'cycle', 'app com foco:');
    assertEqual(Dock.decideClick({...base, button: 1, focused: true, shift: true}), 'minimize',
        'Shift:');
    assertEqual(Dock.decideClick({...base, button: 2}), 'new-window', 'clique do meio:');
    assertEqual(Dock.decideClick({...base, button: 1, ctrl: true}), 'default',
        'Ctrl fica com o GNOME:');
    assertEqual(Dock.decideClick({...base, button: 1, focused: true, inOverview: true}),
        'app-activate', 'na visão geral:');
    assertEqual(Dock.decideClick({...base, button: 1, running: false}), 'default',
        'app fechado abre:');
    assertEqual(Dock.decideClick({...base, button: 2, running: false}), 'default',
        'app fechado, clique do meio:');
});

test('dock: alternar janelas lembra a ordem por 3 s', () => {
    let memory = Dock.advanceCycle(null, 'a', 3, 0);
    assertEqual(memory.index, 1, 'primeiro clique:');

    memory = Dock.advanceCycle(memory, 'a', 3, 1e6);
    assertEqual(memory.index, 2, 'segundo clique:');

    assertEqual(Dock.advanceCycle(memory, 'a', 3, 1e6 + 3e6 + 1).index, 1, 'depois de 3 s:');
    assertEqual(Dock.advanceCycle(memory, 'b', 3, 1.5e6).index, 1, 'outro app:');
    assertEqual(Dock.advanceCycle(memory, 'a', 2, 1.5e6).index, 1, 'uma janela fechou:');
});

// ---------------------------------------------------------------- overview

test('overview: PiP do Firefox é reconhecido pela marca skip_taskbar', () => {
    assert(isFirefoxPip({wmClass: 'org.mozilla.firefox', skipTaskbar: true}), 'Flatpak/Wayland');
    assert(isFirefoxPip({wmClass: 'firefox', skipTaskbar: true}), 'RPM/X11');
    assert(!isFirefoxPip({wmClass: 'org.mozilla.firefox', skipTaskbar: false}),
        'janela normal do Firefox não é PiP');
    assert(!isFirefoxPip({wmClass: 'org.gnome.Ptyxis', skipTaskbar: true}), 'outro app');
    assert(!isFirefoxPip({wmClass: null, skipTaskbar: true}), 'sem classe');
});

/** Serviço `overview` falso: protótipos de mentira e registro das chamadas. */
function makeFakeOverview() {
    class FakeThumbnailsBox {
        // O Shell com um só workspace decide esconder a faixa.
        _updateShouldShow() {
            this._shouldShow = false;
        }

        notify(property) {
            this.notified = [...this.notified ?? [], property];
        }
    }

    class FakeThumbnail {
        _init(id) {
            this.id = id;
        }

        _isOverviewWindow(windowActor) {
            return !windowActor.get_meta_window().skip_taskbar;
        }
    }

    class FakeWorkspace {
        _isOverviewWindow(metaWindow) {
            return !metaWindow.skip_taskbar;
        }
    }

    const calls = [];
    const overview = {
        thumbnailsBoxPrototype: FakeThumbnailsBox.prototype,
        thumbnailPrototype: FakeThumbnail.prototype,
        workspacePrototype: FakeWorkspace.prototype,
        searchActive: false,
        searchListeners: new Set(),
        refreshThumbnailsVisibility: () => calls.push('refresh'),
        describeWindow: w => ({wmClass: w.wmClass, skipTaskbar: w.skip_taskbar}),
        addThumbnailBackground: t => calls.push(`bg:${t.id}`),
        decorateExistingThumbnails: () => calls.push('decorate'),
        removeThumbnailBackgrounds: () => calls.push('remove-bg'),
        onSearchActiveChanged(callback) {
            this.searchListeners.add(callback);
            return () => this.searchListeners.delete(callback);
        },
        setSearchHidden: hidden => calls.push(`search-hidden:${hidden}`),
        restoreSearch: () => calls.push('restore-search'),
        destroy() {},
    };

    return {overview, calls, FakeThumbnailsBox, FakeThumbnail, FakeWorkspace};
}

function overviewLifecycle(overview, features = {}) {
    const {lifecycle, extension, injections} = makeLifecycle(
        defaultValues({'overview-enabled': true}),
        {modules: [OverviewModule], serviceFactories: {overview: () => overview}});

    const settings = extension.getSettings(`${BASE_SCHEMA}.overview`);
    for (const key of OVERVIEW_FEATURES)
        settings.set(key, features[key] ?? true);

    return {lifecycle, settings, injections};
}

test('overview: os quatro recursos ligam, e desativar devolve os métodos originais', () => {
    const {overview, calls, FakeThumbnailsBox, FakeThumbnail, FakeWorkspace} = makeFakeOverview();
    const methods = () => [
        FakeThumbnailsBox.prototype._updateShouldShow,
        FakeThumbnail.prototype._init,
        FakeThumbnail.prototype._isOverviewWindow,
        FakeWorkspace.prototype._isOverviewWindow,
    ];
    const originals = methods();
    const {lifecycle, injections} = overviewLifecycle(overview);

    lifecycle.enable();

    const box = new FakeThumbnailsBox();
    box._updateShouldShow();
    assertEqual(box._shouldShow, true, 'com um só workspace a faixa fica:');
    assertEqual(box.notified, ['should-show'], 'aviso de mudança:');

    const thumbnail = new FakeThumbnail();
    thumbnail._init('t1');
    assert(calls.includes('bg:t1'), 'miniatura nova deveria ganhar fundo');

    assert(calls.includes('search-hidden:true'), 'a busca deveria nascer escondida');
    for (const listener of overview.searchListeners)
        listener(true);
    assert(calls.includes('search-hidden:false'), 'buscar deveria mostrar a caixa');

    const pip = {wmClass: 'org.mozilla.firefox', skip_taskbar: true};
    const otherHidden = {wmClass: 'org.gnome.Ptyxis', skip_taskbar: true};
    assert(new FakeWorkspace()._isOverviewWindow(pip), 'PiP deveria entrar na visão geral');
    assert(!new FakeWorkspace()._isOverviewWindow(otherHidden),
        'outras janelas skip_taskbar continuam fora');
    const pipActor = {get_meta_window: () => ({...pip, showing_on_its_workspace: () => true})};
    assert(new FakeThumbnail()._isOverviewWindow(pipActor), 'PiP deveria entrar nas miniaturas');

    lifecycle.disable();

    assert(methods().every((fn, i) => fn === originals[i]),
        'os quatro métodos deveriam voltar ao original');
    assert(calls.includes('remove-bg'), 'fundos das miniaturas removidos');
    assert(calls.includes('restore-search'), 'caixa de busca restaurada');
    assertEqual(overview.searchListeners.size, 0, 'observador da busca removido:');
    assertEqual(injections.filter(m => m.pending > 0).length, 0, 'patches pendentes:');
});

test('overview: cada recurso desliga a quente só com a própria chave', () => {
    const {overview, calls, FakeThumbnailsBox, FakeWorkspace} = makeFakeOverview();
    const originalShow = FakeThumbnailsBox.prototype._updateShouldShow;
    const originalWorkspace = FakeWorkspace.prototype._isOverviewWindow;
    const {lifecycle, settings} = overviewLifecycle(overview);

    lifecycle.enable();

    settings.set('always-show-thumbnails', false);
    assert(FakeThumbnailsBox.prototype._updateShouldShow === originalShow,
        'patch das miniaturas deveria ser revertido');
    assertEqual(calls.filter(c => c === 'refresh').length, 2, 'recalcula ao ligar e ao desligar:');
    assert(FakeWorkspace.prototype._isOverviewWindow !== originalWorkspace,
        'o PiP deveria continuar ligado');

    settings.set('hide-search', false);
    assertEqual(calls.filter(c => c === 'restore-search').length, 1, 'busca restaurada uma vez:');

    lifecycle.disable();
    assert(FakeWorkspace.prototype._isOverviewWindow === originalWorkspace,
        'após desativar, o PiP deveria ser revertido');
    assertEqual(calls.filter(c => c === 'restore-search').length, 1,
        'desativar não deveria restaurar de novo o que já estava desligado:');
});

test('overview: com os recursos desligados nada é alterado', () => {
    const {overview, calls, FakeWorkspace} = makeFakeOverview();
    const original = FakeWorkspace.prototype._isOverviewWindow;
    const off = Object.fromEntries(OVERVIEW_FEATURES.map(key => [key, false]));
    const {lifecycle, injections} = overviewLifecycle(overview, off);

    lifecycle.enable();
    assertEqual(calls, [], 'nenhuma chamada ao serviço:');
    assert(FakeWorkspace.prototype._isOverviewWindow === original, 'nada substituído');
    assertEqual(injections.reduce((n, m) => n + m.overrideCount, 0), 0, 'nenhum patch:');
    lifecycle.disable();
});

// --------------------------------------------------------------- animation

test('animation: fator fica numa faixa válida', () => {
    assertEqual(Animation.clampSpeedFactor(0.25), 0.25, 'baseline:');
    assertEqual(Animation.clampSpeedFactor(0), 1, 'zero vira velocidade normal:');
    assertEqual(Animation.clampSpeedFactor(-2), 1, 'negativo vira velocidade normal:');
    assertEqual(Animation.clampSpeedFactor(NaN), 1, 'inválido vira velocidade normal:');
    assertEqual(Animation.clampSpeedFactor(0.001), Animation.MIN_SPEED_FACTOR, 'abaixo do mínimo:');
    assertEqual(Animation.clampSpeedFactor(99), Animation.MAX_SPEED_FACTOR, 'acima do máximo:');
});

test('animation: descrição do fator', () => {
    assertEqual(Animation.describeSpeedFactor(0.25), {kind: 'faster', ratio: 4}, 'baseline:');
    assertEqual(Animation.describeSpeedFactor(2), {kind: 'slower', ratio: 2});
    assertEqual(Animation.describeSpeedFactor(1), {kind: 'normal', ratio: 1});
    assertEqual(Animation.describeSpeedFactor(0.3), {kind: 'faster', ratio: 3.33}, 'arredondado:');
});

/** Serviço `animation` falso: guarda o fator como o St faria. */
function makeFakeAnimation({enabled = true, factor = 1.5} = {}) {
    return {
        factor,
        saved: null,
        restored: 0,
        animationsEnabled: enabled,
        listeners: new Set(),
        applySpeedFactor(value) {
            if (this.saved === null)
                this.saved = this.factor;
            this.factor = value;
        },
        restoreSpeedFactor() {
            if (this.saved === null)
                return;
            this.factor = this.saved;
            this.saved = null;
            this.restored++;
        },
        onAnimationsChanged(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        },
        destroy() {},
    };
}

test('animation: aplica o fator, acompanha a chave e restaura o original', () => {
    const service = makeFakeAnimation({factor: 1.5});
    const {lifecycle, extension} = makeLifecycle(defaultValues({'animation-enabled': true}),
        {modules: [AnimationModule], serviceFactories: {animation: () => service}});
    const settings = extension.getSettings(`${BASE_SCHEMA}.animation`);
    settings.set('speed-factor', 0.25);

    lifecycle.enable();
    assertEqual(service.factor, 0.25, 'fator do baseline aplicado:');

    settings.set('speed-factor', 2);
    assertEqual(service.factor, 2, 'mudança a quente:');

    settings.set('speed-factor', 0);
    assertEqual(service.factor, 1, 'valor inválido vira velocidade normal:');

    lifecycle.disable();
    assertEqual(service.factor, 1.5, 'o fator de antes deveria voltar:');
    assertEqual(service.restored, 1, 'restaurações:');
    assertEqual(service.listeners.size, 0, 'observador removido:');
});

test('animation: avisa no log quando as animações do sistema estão desligadas', () => {
    const service = makeFakeAnimation({enabled: false});
    const {lifecycle, extension, sink} = makeLifecycle(
        defaultValues({'animation-enabled': true, 'log-level': 'info'}),
        {modules: [AnimationModule], serviceFactories: {animation: () => service}});
    extension.getSettings(`${BASE_SCHEMA}.animation`).set('speed-factor', 0.25);

    lifecycle.enable();
    assert(sink.text.includes('animações desligadas'), `aviso ausente no log: ${sink.text}`);
    lifecycle.disable();
});

// ------------------------------------------------------ consistência dos dados

test('dados: toda chave de módulo existe no esquema', () => {
    const path = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_current_dir(),
            'gnomeCustom@gfiamoncini.com', 'schemas',
            'org.gnome.shell.extensions.gnomecustom.gschema.xml']));
    const [, bytes] = path.load_contents(null);
    const xml = new TextDecoder().decode(bytes);

    for (const info of MODULES_INFO)
        assert(xml.includes(`name="${info.key}"`), `chave ausente no esquema: ${info.key}`);
});

test('dados: MODULES_INFO e extension.js concordam sobre o que existe', () => {
    const path = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_current_dir(),
            'gnomeCustom@gfiamoncini.com', 'extension.js']));
    const [, bytes] = path.load_contents(null);
    const source = new TextDecoder().decode(bytes);

    const imported = [...source.matchAll(/\.\/modules\/([\w-]+)\/module\.js/g)]
        .map(match => match[1])
        .sort();
    const flagged = MODULES_INFO.filter(info => info.implemented)
        .map(info => info.id)
        .sort();

    assertEqual(imported, flagged,
        'módulos importados por extension.js vs. marcados como implementados:');
});

test('dados: cada extensão conhecida aponta para um módulo existente', () => {
    const ids = new Set(MODULES_INFO.map(info => info.id));
    for (const entry of KNOWN_EXTENSIONS)
        assert(ids.has(entry.module), `módulo desconhecido em '${entry.uuid}': ${entry.module}`);
});

test('dados: uuid de extensão conhecida não se repete', () => {
    const uuids = KNOWN_EXTENSIONS.map(entry => entry.uuid);
    assertEqual(uuids.length, new Set(uuids).size, 'uuids duplicados:');
});

imports.system.exit(await run());
