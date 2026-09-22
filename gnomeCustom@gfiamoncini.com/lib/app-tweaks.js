// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Ajustes do tema em apps que não seguem o tema GTK (Electron: VS Code, Obsidian).
 *
 * O tema de Shell traz a receita em `apps/` (ver `services/system/app-tweaks.js`);
 * aqui ficam só as transformações de texto e de objetos, sem E/S:
 *  - VS Code: o `settings.json` é JSONC (comentários, vírgula no fim) e é do usuário,
 *    então não é reescrito — as chaves do tema entram num bloco entre marcas, que sai
 *    inteiro ao desfazer. Chave que o usuário já definiu fora do bloco não é tocada.
 *  - Obsidian: JSON comum; os valores trocados são devolvidos pelo estado guardado.
 *
 * Pedido do usuário em 2026-09-21: "embutir essas correções na extensão".
 * Sem dependências do GNOME.
 */

export const VSCODE_BEGIN = '// >>> GnomeCustom: tema dos aplicativos (gerido pela extensão)';
export const VSCODE_END = '// <<< GnomeCustom';

/** Anotado na marca de início quando o apply pôs uma vírgula na linha anterior. */
const COMMA_TAG = ' (+,)';

/** Nome do snippet de CSS que a extensão põe em cada cofre do Obsidian. */
export const OBSIDIAN_SNIPPET = 'gnomecustom-app-theme';

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tira o bloco da extensão, se houver.
 *
 * @param {string} text conteúdo do settings.json
 * @returns {string}
 */
export function vscodeRemove(text) {
    const start = text.indexOf(VSCODE_BEGIN);
    if (start < 0)
        return text;
    const endMark = text.indexOf(VSCODE_END, start);
    if (endMark < 0)
        return text;
    const lineStart = text.lastIndexOf('\n', start) + 1;
    let lineEnd = text.indexOf('\n', endMark);
    lineEnd = lineEnd < 0 ? text.length : lineEnd + 1;
    let before = text.slice(0, lineStart);
    const beginLine = text.slice(start, text.indexOf('\n', start));
    if (beginLine.includes(COMMA_TAG)) {
        const lines = before.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line === '' || line.startsWith('//'))
                continue;
            lines[i] = lines[i].replace(/,(\s*)$/, '$1');
            break;
        }
        before = lines.join('\n');
    }
    return before + text.slice(lineEnd);
}

/**
 * @param {string} text
 * @param {string} key
 * @returns {boolean} a chave aparece como propriedade (fora de comentário de linha)
 */
export function vscodeHasKey(text, key) {
    const pattern = new RegExp(`^(?!\\s*//).*"${escapeRegExp(key)}"\\s*:`, 'm');
    return pattern.test(text);
}

/**
 * Põe (ou atualiza) o bloco da extensão no fim do objeto de configurações.
 *
 * @param {string} text conteúdo do settings.json
 * @param {object} entries chave → valor JSON
 * @returns {{text: string, applied: string[], skipped: string[]}}
 */
export function vscodeApply(text, entries) {
    const base = vscodeRemove(text);
    const applied = [];
    const skipped = [];
    for (const key of Object.keys(entries))
        (vscodeHasKey(base, key) ? skipped : applied).push(key);

    const close = base.lastIndexOf('}');
    if (close < 0 || applied.length === 0)
        return {text: base, applied: [], skipped};

    // A última linha com conteúdo antes do "}" precisa de vírgula para o bloco vir
    // depois (o VS Code aceita a vírgula final, então o bloco sempre termina com uma).
    const lines = base.slice(0, close).split('\n');
    const indent = lines.length > 1 ? lines.pop() : '';   // o que vem antes do "}" na linha dele
    let comma = false;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('//'))
            continue;
        if (!line.endsWith(',') && !line.endsWith('{')) {
            lines[i] = lines[i].replace(/\s*$/, ',');
            comma = true;
        }
        break;
    }
    // As linhas em branco antes do "}" ficam depois do bloco, para voltarem iguais.
    let trailing = '';
    while (lines.length > 1 && lines[lines.length - 1].trim() === '')
        trailing = `${lines.pop()}\n${trailing}`;

    const body = applied.map(key => {
        const value = JSON.stringify(entries[key], null, 4).replace(/\n/g, '\n    ');
        return `    "${key}": ${value},`;
    });
    const block = [`    ${VSCODE_BEGIN}${comma ? COMMA_TAG : ''}`, ...body, `    ${VSCODE_END}`].join('\n');
    const before = lines.join('\n');
    return {
        text: `${before}\n${block}\n${trailing}${indent}${base.slice(close)}`,
        applied,
        skipped,
    };
}

/**
 * Aplica valores num objeto JSON, anotando os anteriores (só na primeira vez: um
 * segundo apply não pode apagar o valor original do usuário).
 *
 * @param {object} data objeto lido do arquivo
 * @param {object} values chave → valor novo
 * @param {object} [previous] anteriores já guardados (chave → valor | null)
 * @returns {{data: object, previous: object}}
 */
export function applyValues(data, values, previous = {}) {
    const out = {...data};
    const saved = {...previous};
    for (const [key, value] of Object.entries(values)) {
        if (!(key in saved))
            saved[key] = key in data ? data[key] : null;
        out[key] = value;
    }
    return {data: out, previous: saved};
}

/**
 * Devolve os valores anotados por `applyValues`. Um valor que o usuário mudou
 * depois (diferente do que a extensão pôs) fica como está.
 *
 * @param {object} data
 * @param {object} values o que a extensão tinha posto
 * @param {object} previous chave → valor original (null = não existia)
 * @returns {object}
 */
export function restoreValues(data, values, previous) {
    const out = {...data};
    for (const [key, original] of Object.entries(previous)) {
        if (key in values && JSON.stringify(out[key]) !== JSON.stringify(values[key]))
            continue;
        if (original === null)
            delete out[key];
        else
            out[key] = original;
    }
    return out;
}

/**
 * @param {object} appearance conteúdo do `.obsidian/appearance.json`
 * @param {boolean} enabled
 * @returns {object} com o snippet da extensão ligado ou retirado
 */
export function obsidianSnippet(appearance, enabled) {
    const list = (appearance.enabledCssSnippets ?? []).filter(name => name !== OBSIDIAN_SNIPPET);
    if (enabled)
        list.push(OBSIDIAN_SNIPPET);
    const out = {...appearance, enabledCssSnippets: list};
    if (list.length === 0 && !('enabledCssSnippets' in appearance))
        delete out.enabledCssSnippets;
    return out;
}

/**
 * @param {object} config conteúdo do `obsidian.json`
 * @returns {string[]} pastas dos cofres
 */
export function obsidianVaults(config) {
    return Object.values(config?.vaults ?? {})
        .map(vault => vault?.path)
        .filter(path => typeof path === 'string' && path.length > 0);
}
