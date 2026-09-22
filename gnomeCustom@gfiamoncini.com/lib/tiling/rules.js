// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Quais janelas ficam fora do tiling.
 *
 * Duas fontes: o **tipo** da janela (diálogos, transitórias, sem classe, sem
 * título, que não aceitam redimensionamento) e as **regras** configuráveis por
 * classe e título.
 *
 * O formato e a semântica de correspondência são os do `windows.json` do Forge
 * (`isFloatingExempt`), para que a migração seja só copiar as regras:
 *  - `wmClass` casa se o texto da regra **contém** a classe da janela;
 *  - `wmTitle` é uma lista separada por vírgula; qualquer item que case basta;
 *    `!texto` casa quando o título *não* contém o texto; `" "` casa só com um
 *    título que seja exatamente um espaço.
 *
 * Diferença deliberada, e a razão deste arquivo existir: **regras por `wmId`
 * não existem.** O id de uma janela morre com ela; no Forge, gravá-lo deixava
 * "regras fantasmas" que quebravam o `Super+C` daquela aplicação. Aqui, flutuar
 * uma janela é estado em memória, e só regras por classe/título são persistidas.
 *
 * Sem dependências do GNOME: recebe descrições simples de janela.
 */

import {DEFAULT_RULES} from './default-rules.js';

export {DEFAULT_RULES};

/**
 * @typedef {object} WindowDescription
 * @property {?string} wmClass
 * @property {?string} title
 * @property {string} type 'normal' | 'dialog' | 'modal-dialog' | outro
 * @property {boolean} transient tem janela-mãe
 * @property {boolean} allowsResize
 */

/**
 * @typedef {object} Rule
 * @property {string} wmClass
 * @property {string} [wmTitle]
 * @property {'float'} mode
 */

/**
 * A janela deve flutuar só pelo tipo, independentemente de regras?
 *
 * @param {WindowDescription} window
 * @returns {boolean}
 */
export function floatsByType(window) {
    return window.type === 'dialog' ||
        window.type === 'modal-dialog' ||
        window.transient ||
        !window.wmClass ||
        !window.title ||
        !window.allowsResize;
}

/**
 * @param {Rule} rule
 * @param {WindowDescription} window
 * @returns {boolean}
 */
export function ruleMatches(rule, window) {
    if (rule.mode !== 'float' || !rule.wmClass || !window.wmClass)
        return false;
    if (!rule.wmClass.includes(window.wmClass))
        return false;
    if (!rule.wmTitle)
        return true;

    const title = window.title ?? '';
    if (rule.wmTitle === ' ')
        return title === ' ';

    return rule.wmTitle.split(',').some(part => {
        if (!title)
            return false;
        return part.startsWith('!')
            ? !title.includes(part.slice(1))
            : title.includes(part);
    });
}

/**
 * @param {WindowDescription} window
 * @param {Rule[]} rules
 * @returns {boolean} a janela deve ficar fora do tiling
 */
export function shouldFloat(window, rules) {
    return floatsByType(window) || rules.some(rule => ruleMatches(rule, window));
}

/**
 * Lê regras de JSON, aceitando tanto a lista pura quanto o formato do Forge
 * (`{"overrides": [...]}`). Entradas com `wmId` são descartadas e contadas.
 *
 * @param {string} text
 * @returns {{rules: Rule[], droppedById: number, invalid: number}}
 */
export function parseRules(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return {rules: [], droppedById: 0, invalid: 1};
    }

    const list = Array.isArray(data) ? data : Array.isArray(data?.overrides) ? data.overrides : null;
    if (!list)
        return {rules: [], droppedById: 0, invalid: 1};

    const rules = [];
    let droppedById = 0;
    let invalid = 0;

    for (const entry of list) {
        if (entry && typeof entry === 'object' && 'wmId' in entry) {
            droppedById++;
            continue;
        }
        if (!entry || typeof entry.wmClass !== 'string' || entry.wmClass === '' ||
            (entry.mode ?? 'float') !== 'float' ||
            ('wmTitle' in entry && typeof entry.wmTitle !== 'string')) {
            invalid++;
            continue;
        }
        const rule = {wmClass: entry.wmClass, mode: 'float'};
        if (entry.wmTitle)
            rule.wmTitle = entry.wmTitle;
        rules.push(rule);
    }

    return {rules, droppedById, invalid};
}

/** @returns {string} JSON das regras, estável para gravar no GSettings */
export function serializeRules(rules) {
    return JSON.stringify(rules.map(rule => (rule.wmTitle
        ? {wmClass: rule.wmClass, wmTitle: rule.wmTitle, mode: 'float'}
        : {wmClass: rule.wmClass, mode: 'float'})));
}

/**
 * Liga ou desliga "sempre flutuar" para uma classe inteira.
 *
 * Só mexe em regras **sem título** daquela classe exata; regras com título
 * (como as de splash das IDEs da JetBrains) ficam como estão.
 *
 * @param {Rule[]} rules
 * @param {string} wmClass
 * @returns {{rules: Rule[], floating: boolean}} regras novas e o estado final
 */
export function toggleClassRule(rules, wmClass) {
    const isClassRule = rule => rule.wmClass === wmClass && !rule.wmTitle;
    if (rules.some(isClassRule))
        return {rules: rules.filter(rule => !isClassRule(rule)), floating: false};
    return {rules: [...rules, {wmClass, mode: 'float'}], floating: true};
}
