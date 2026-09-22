// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Texto do relatório de importação. Puro: recebe o relatório de `applyImports`
 * e a função de tradução.
 */

/**
 * @param {object} report
 * @param {Function} _ função de tradução
 * @returns {{heading: string, body: string}}
 */
export function formatReport(report, _) {
    const lines = [];
    const {changed, unchanged, adjusted, failed, notes} = report;

    lines.push(_('%d option(s) changed, %d already matched.')
        .replace('%d', String(changed.length)).replace('%d', String(unchanged)));

    if (changed.length > 0) {
        lines.push('');
        lines.push(_('Changed:'));
        for (const item of changed)
            lines.push(`• ${item.where} = ${item.value}  (${item.source}: ${item.from})`);
    }

    if (adjusted.length > 0) {
        lines.push('');
        lines.push(_('Adjusted to the allowed range:'));
        for (const item of adjusted)
            lines.push(`• ${item.where} → ${item.value}  (${item.source})`);
    }

    if (failed.length > 0) {
        lines.push('');
        lines.push(_('Not imported:'));
        for (const item of failed)
            lines.push(`• ${item.where}: ${item.reason}  (${item.source})`);
    }

    if (notes.length > 0) {
        lines.push('');
        lines.push(_('Without an equivalent:'));
        for (const item of notes)
            lines.push(`• ${item.source} — ${item.from}: ${item.reason}`);
    }

    lines.push('');
    lines.push(_('Importing does not turn modules on. Pick a profile or turn modules on in the General page, and disable the original extensions.'));

    const heading = failed.length > 0 ? _('Import finished with problems') : _('Import finished');
    return {heading, body: lines.join('\n')};
}
