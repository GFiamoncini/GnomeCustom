// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Descoberta de temas de Shell instalados.
 *
 * Sem imports do GNOME Shell, porque as preferências rodam em outro processo e
 * precisam listar os mesmos temas que o módulo aplica.
 *
 * Um "tema de Shell" é um diretório que contenha `gnome-shell/gnome-shell.css`
 * — a mesma convenção que a extensão User Themes usa, e que temas como o Orchis
 * seguem.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import '../core/gio-promises.js';

/** @returns {string[]} diretórios onde temas podem estar instalados */
export function themeDirs() {
    const dirs = [`${GLib.get_home_dir()}/.themes`];
    for (const dataDir of GLib.get_system_data_dirs())
        dirs.push(`${dataDir}/themes`);
    return dirs;
}

/**
 * @param {string} name
 * @returns {Promise<?string>} caminho do gnome-shell.css, ou null
 */
export async function resolveTheme(name) {
    if (!name)
        return null;

    for (const dir of themeDirs()) {
        const path = `${dir}/${name}/gnome-shell/gnome-shell.css`;
        const file = Gio.File.new_for_path(path);
        try {
            await file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            return path;
        } catch {
            // segue para o próximo diretório
        }
    }
    return null;
}

/**
 * @returns {Promise<string[]>} nomes dos temas instalados, em ordem alfabética
 */
export async function listThemes() {
    const names = new Set();

    for (const dir of themeDirs()) {
        const folder = Gio.File.new_for_path(dir);
        let iterator;
        try {
            iterator = await folder.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, null);
        } catch {
            continue;
        }

        let infos;
        do {
            infos = await iterator.next_files_async(50, GLib.PRIORITY_DEFAULT, null);
            for (const info of infos) {
                const name = info.get_name();
                if (!names.has(name) && await resolveTheme(name))
                    names.add(name);
            }
        } while (infos.length > 0);
    }

    return [...names].sort((a, b) => a.localeCompare(b));
}
