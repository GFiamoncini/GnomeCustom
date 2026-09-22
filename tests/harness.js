// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/** Arcabouço mínimo de testes. Sem dependências além do GJS. */

const tests = [];
let failures = 0;
let passed = 0;

export function test(name, fn) {
    tests.push({name, fn});
}

export function assert(condition, message) {
    if (!condition)
        throw new Error(message ?? 'asserção falhou');
}

export function assertEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${message} esperado ${e}, obtido ${a}`);
}

export function assertThrows(fn, message = '') {
    let threw = false;
    try {
        fn();
    } catch {
        threw = true;
    }
    if (!threw)
        throw new Error(`${message} esperava uma exceção`);
}

/**
 * Executa os testes em ordem. Um teste pode ser assíncrono (devolver promessa).
 *
 * Isto importa no GJS: o `run.js` usa `await` de topo, então os testes já rodam
 * dentro de um job de promessa, e o GJS não drena promessas novas por um
 * `GLib.MainLoop` aninhado nesse contexto — um teste que espere uma promessa com
 * `loop.run()` fica parado para sempre. Com `await` a espera funciona.
 */
export async function run() {
    for (const {name, fn} of tests) {
        try {
            await fn();
            passed++;
            print(`  ok    ${name}`);
        } catch (e) {
            failures++;
            print(`  FALHA ${name}`);
            print(`        ${e.message}`);
            if (e.stack)
                print(`        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`);
        }
    }

    print('');
    print(`${passed} passou, ${failures} falhou (${tests.length} testes)`);
    return failures === 0 ? 0 : 1;
}
