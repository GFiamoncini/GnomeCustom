// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Da árvore aos retângulos: onde cada janela deve ficar.
 *
 * A fórmula de espaçamento é a do Forge, porque é a do baseline do usuário
 * (gap 2): a área útil do monitor encolhe `gap` de cada lado, e cada janela
 * encolhe mais `gap` de cada lado dentro da sua fatia. Resultado: `2·gap` entre
 * janelas e entre janela e borda. Com "gaps ocultos em janela única", uma janela
 * sozinha na chave não tem espaço nenhum.
 *
 * Diferença deliberada: o Forge arredonda cada fatia para baixo e deixa sobrar
 * pixels na borda (há um TODO no código dele). Aqui a divisão usa o método do
 * maior resto, e as fatias somam exatamente o tamanho do contêiner.
 *
 * Sem dependências do GNOME.
 */

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 */

/**
 * @param {import('./tree.js').TilingTree} tree
 * @param {string} key
 * @param {Rect} area área útil do monitor (já sem painel e dock)
 * @param {object} [options]
 * @param {number} [options.gap] espaçamento em pixels
 * @param {boolean} [options.smartGaps] sem espaço quando há uma janela só
 * @param {Function} [options.isTiled] (id) => boolean; falso tira a janela do
 *   layout sem tirá-la da árvore (minimizada, tela cheia…)
 * @returns {{windows: Map<number, Rect>, containers: Map<object, Rect>, gap: number}}
 */
export function computeLayout(tree, key, area, {gap = 0, smartGaps = true, isTiled = () => true} = {}) {
    const windows = new Map();
    const containers = new Map();
    const root = tree.root(key, {create: false});

    if (!root)
        return {windows, containers, gap: 0};

    const tiledCount = countTiled(root, isTiled);
    if (tiledCount === 0)
        return {windows, containers, gap: 0};

    const effectiveGap = smartGaps && tiledCount === 1 ? 0 : Math.max(0, Math.round(gap));
    const rootRect = inset(area, effectiveGap);

    place(root, rootRect, effectiveGap, isTiled, windows, containers);
    return {windows, containers, gap: effectiveGap};
}

function place(node, rect, gap, isTiled, windows, containers) {
    if (node.kind === 'leaf') {
        windows.set(node.id, inset(rect, gap));
        return;
    }

    containers.set(node, rect);

    const children = node.children.filter(child => countTiled(child, isTiled) > 0);
    if (children.length === 0)
        return;

    const horizontal = node.layout === 'h';
    const total = horizontal ? rect.width : rect.height;
    const sizes = distribute(total, children.map(child => child.weight));

    let offset = horizontal ? rect.x : rect.y;
    children.forEach((child, index) => {
        const childRect = horizontal
            ? {x: offset, y: rect.y, width: sizes[index], height: rect.height}
            : {x: rect.x, y: offset, width: rect.width, height: sizes[index]};
        offset += sizes[index];
        place(child, childRect, gap, isTiled, windows, containers);
    });
}

/**
 * Divide um total inteiro em partes proporcionais aos pesos, somando exatamente
 * o total (método do maior resto).
 *
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]}
 */
export function distribute(total, weights) {
    const safe = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 0));
    let sum = safe.reduce((a, b) => a + b, 0);
    if (sum === 0) {
        safe.fill(1);
        sum = safe.length;
    }

    const exact = safe.map(w => (total * w) / sum);
    const sizes = exact.map(Math.floor);
    let remainder = total - sizes.reduce((a, b) => a + b, 0);

    const order = exact
        .map((value, index) => ({index, fraction: value - Math.floor(value)}))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

    for (let i = 0; remainder > 0 && i < order.length; i++, remainder--)
        sizes[order[i].index] += 1;

    return sizes;
}

/**
 * Encolhe um retângulo por igual. Não encolhe o que ficaria sem área, como o
 * Forge (`processGap`), para uma janela minúscula não sumir.
 *
 * @param {Rect} rect
 * @param {number} amount
 * @returns {Rect}
 */
export function inset(rect, amount) {
    if (amount <= 0 || rect.width <= amount * 2 || rect.height <= amount * 2)
        return {...rect};
    return {
        x: rect.x + amount,
        y: rect.y + amount,
        width: rect.width - amount * 2,
        height: rect.height - amount * 2,
    };
}

function countTiled(node, isTiled) {
    if (node.kind === 'leaf')
        return isTiled(node.id) ? 1 : 0;
    return node.children.reduce((sum, child) => sum + countTiled(child, isTiled), 0);
}
