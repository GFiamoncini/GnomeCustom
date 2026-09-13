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
import {FakeEmitter, FakeSettings, FakeInjectionManager, FakeExtension, FakeSink} from './fakes.js';

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
const {parseOsRelease} = await import(`${EXT}/services/system/distro.js`);
const {VolumeModule, formatLevel} = await import(`${EXT}/modules/volume/module.js`);
const Mpris = await import(`${EXT}/lib/mpris.js`);
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
