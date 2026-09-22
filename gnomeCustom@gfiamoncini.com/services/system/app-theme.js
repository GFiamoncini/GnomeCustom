// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Tema dos aplicativos acompanhando o tema do Shell.
 *
 * Com `apply-to-apps` ligado e um tema de Shell que também traz GTK (ex. o
 * Dracula-AMOLED gerado em `themes/`), este serviço:
 *  - troca `org.gnome.desktop.interface gtk-theme` para o mesmo nome;
 *  - liga `~/.config/gtk-4.0/gtk.css` ao `libadwaita/gtk.css` do tema, quando
 *    existe — é o que alcança os apps libadwaita, que ignoram o tema GTK;
 *  - aplica a receita de `apps/` do tema nos apps Electron (VS Code, Obsidian),
 *    que ignoram os dois (`app-tweaks.js`).
 *
 * Tudo é desfeito ao desligar a opção ou trocar para um tema sem GTK: o tema GTK
 * anterior volta (guardado em `app-theme-previous`) e o `gtk.css` do usuário, se
 * havia um, é restaurado do backup. **Não** é desfeito na desativação da extensão:
 * o GNOME desativa as extensões ao bloquear a tela, e os apps trocariam de visual
 * a cada bloqueio.
 *
 * Só Gio/GLib; nenhuma API do Shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {resolveTheme} from '../../lib/shell-themes.js';
import {AppTweaks} from './app-tweaks.js';

const BACKUP_SUFFIX = '.gnomecustom-backup';

function userCssFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', 'gtk.css']));
}

function exists(file) {
    return file.query_exists(null);
}

/** @returns {?string} destino do link simbólico, ou null se não for link */
function symlinkTarget(file) {
    try {
        const info = file.query_info('standard::is-symlink,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return info.get_is_symlink() ? info.get_symlink_target() : null;
    } catch {
        return null;
    }
}

export class AppThemeService {
    /**
     * @param {object} options
     * @param {object} options.logger
     * @param {object} [options.interfaceSettings] Gio.Settings de org.gnome.desktop.interface (testes)
     * @param {Function} [options.cssFile] () => Gio.File do gtk.css do usuário (testes)
     * @param {Function} [options.themeDir] nome => Promise<?Gio.File> da pasta do tema (testes)
     * @param {object} [options.tweaks] AppTweaks (testes)
     */
    constructor({logger, interfaceSettings = null, cssFile = userCssFile, themeDir = null, tweaks = null}) {
        this._logger = logger;
        this._tweaks = tweaks ?? new AppTweaks({logger});
        if (themeDir)
            this._themeDir = themeDir;
        this._interface = interfaceSettings ??
            new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._cssFile = cssFile;
    }

    /**
     * Deixa os apps de acordo com a escolha atual.
     *
     * @param {object} state
     * @param {string} state.themeName tema de Shell escolhido ('' = padrão)
     * @param {boolean} state.enabled `apply-to-apps`
     * @param {object} state.settings Gio.Settings `…gnomecustom.theme`, que guarda o estado
     */
    async sync({themeName, enabled, settings}) {
        const dir = themeName ? await this._themeDir(themeName) : null;
        const hasGtk = dir && ['gtk-3.20', 'gtk-3.0', 'gtk-4.0'].some(part => exists(dir.get_child(part)));

        // Os apps Electron à parte: um arquivo de app com problema não pode impedir
        // o tema GTK.
        try {
            if (enabled && dir)
                this._tweaks.apply(dir, settings);
            else
                this._tweaks.revert(settings);
        } catch (e) {
            this._logger.error('falha ao ajustar os apps Electron', e);
        }

        if (enabled && hasGtk) {
            this._applyGtkTheme(themeName, settings);
            const css = dir.get_child('libadwaita').get_child('gtk.css');
            if (exists(css))
                this._linkUserCss(css, settings);
            else
                this._unlinkUserCss(settings);
            return;
        }

        this._restoreGtkTheme(settings);
        this._unlinkUserCss(settings);
    }

    async _themeDir(name) {
        const path = await resolveTheme(name);   // …/<tema>/gnome-shell/gnome-shell.css
        return path ? Gio.File.new_for_path(path).get_parent().get_parent() : null;
    }

    _applyGtkTheme(name, settings) {
        const current = this._interface.get_string('gtk-theme');
        if (current === name)
            return;
        // Guarda o tema do usuário só na primeira troca; trocas entre temas nossos
        // não sobrescrevem o original.
        if (!settings.get_string('app-theme-applied'))
            settings.set_string('app-theme-previous', current);
        this._interface.set_string('gtk-theme', name);
        settings.set_string('app-theme-applied', name);
        this._logger.info(`tema dos aplicativos: ${name} (antes: ${settings.get_string('app-theme-previous')})`);
    }

    _restoreGtkTheme(settings) {
        const applied = settings.get_string('app-theme-applied');
        if (!applied)
            return;
        const previous = settings.get_string('app-theme-previous');
        // Só devolve se o tema ainda for o que pusemos: se o usuário trocou por
        // fora, a escolha dele vale.
        if (this._interface.get_string('gtk-theme') === applied && previous)
            this._interface.set_string('gtk-theme', previous);
        settings.set_string('app-theme-applied', '');
        settings.set_string('app-theme-previous', '');
        this._logger.info(`tema dos aplicativos devolvido: ${previous || '(sem mudança)'}`);
    }

    _linkUserCss(css, settings) {
        const file = this._cssFile();
        const target = css.get_path();
        if (symlinkTarget(file) === target)
            return;

        try {
            file.get_parent().make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
        const ours = settings.get_string('app-theme-css');
        if (exists(file) || symlinkTarget(file)) {
            if (symlinkTarget(file) && symlinkTarget(file) === ours) {
                file.delete(null);   // link nosso de outro tema
            } else {
                const backup = Gio.File.new_for_path(file.get_path() + BACKUP_SUFFIX);
                if (!exists(backup)) {
                    file.move(backup, Gio.FileCopyFlags.NONE, null, null);
                    this._logger.info(`gtk.css do usuário guardado em ${backup.get_path()}`);
                } else {
                    this._logger.warn('já existe um backup do gtk.css; o arquivo atual fica como está');
                    return;
                }
            }
        }
        file.make_symbolic_link(target, null);
        settings.set_string('app-theme-css', target);
        this._logger.info(`apps libadwaita: ${target}`);
    }

    _unlinkUserCss(settings) {
        const ours = settings.get_string('app-theme-css');
        if (!ours)
            return;
        const file = this._cssFile();
        if (symlinkTarget(file) === ours)
            file.delete(null);
        const backup = Gio.File.new_for_path(file.get_path() + BACKUP_SUFFIX);
        if (exists(backup) && !exists(file) && !symlinkTarget(file))
            backup.move(file, Gio.FileCopyFlags.NONE, null, null);
        settings.set_string('app-theme-css', '');
        this._logger.info('apps libadwaita: CSS do tema desligado');
    }
}
