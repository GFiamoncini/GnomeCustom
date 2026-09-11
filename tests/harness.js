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

export function run() {
    for (const {name, fn} of tests) {
        try {
            fn();
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
