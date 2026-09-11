// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento do sistema de temas do Shell (COMPATIBILITY.md §2).
 *
 * Faz duas coisas relacionadas mas independentes:
 *
 *  1. **folha adicional**: grava o CSS gerado pelo Theme Engine em um arquivo do
 *     diretório de execução e o carrega no tema corrente. Isso *soma* ao tema do
 *     usuário em vez de substituí-lo (AD-8).
 *  2. **tema de Shell do usuário**: carrega um tema de `~/.themes`, que é o
 *     papel da extensão User Themes. Assim o GnomeCustom é autossuficiente e não
 *     depende daquela extensão (§6 do briefing).
 *
 * Trocar o tema do usuário reconstrói o objeto de tema. O `Main.loadTheme` do
 * Shell já copia as folhas adicionais do tema anterior para o novo, então o
 * observador de `changed` existe apenas como rede de segurança.
 *
 * Duas armadilhas descobertas rodando isto num Shell de verdade:
 *
 *  - carregar a mesma folha duas vezes corrompe a lista interna do St, e o
 *    `Main.loadTheme` seguinte falha com "Argument file may not be null";
 *  - `unload_stylesheet` faz o próprio `St.ThemeContext` emitir `changed`, de
 *    modo que trocar a folha reentra no observador no meio da troca.
 *
 * Daí o par: uma trava durante as nossas próprias operações e uma conferência de
 * pertinência antes de recarregar.
 *
 * APIs internas usadas:
 *   // GNOME 49: St.ThemeContext.get_for_stage(global.stage).get_theme()
 *   // GNOME 49: St.Theme.load_stylesheet / unload_stylesheet
 *   // GNOME 49: Main.setThemeStylesheet / Main.loadTheme
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import '../../core/gio-promises.js';
import {SignalTracker} from '../../core/signals.js';
import {resolveTheme} from '../../lib/shell-themes.js';

const RUNTIME_SUBDIR = 'gnomecustom';
const STYLESHEET_NAME = 'generated.css';

export class ShellThemeService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._signals = new SignalTracker({name: 'svc:theme', logger});

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._file = null;
        this._loaded = false;
        this._css = null;
        this._reloading = false;
        this._mutating = false;
        this._userThemeApplied = false;

        // Rede de segurança: se algum caminho de reconstrução não transportar a
        // folha, ela é recarregada. O caso normal não faz nada.
        this._signals.connect(this._themeContext, 'changed', () => this._onThemeChanged());
    }

    /**
     * Aplica um CSS. Chamadas repetidas com o mesmo conteúdo não fazem nada.
     *
     * @param {string} css
     * @returns {Promise<boolean>} true se algo mudou
     */
    async apply(css) {
        if (css === this._css)
            return false;

        this._css = css;

        if (!css) {
            await this.clear();
            return true;
        }

        this._mutating = true;
        try {
            const file = await this._writeStylesheet(css);
            this._reload(file);
            return true;
        } catch (e) {
            this._logger.error('falha ao aplicar a folha de estilo gerada', e);
            return false;
        } finally {
            this._mutating = false;
        }
    }

    /** Descarrega e apaga a folha adicional. */
    async clear() {
        this._mutating = true;
        this._unload();
        this._css = null;
        this._mutating = false;

        if (!this._file)
            return;

        await this._deleteQuietly(this._file);
        this._file = null;
    }

    // ------------------------------------------------------- tema do usuário

    /**
     * Aplica um tema de Shell pelo nome. String vazia volta ao tema padrão.
     *
     * @param {string} name
     * @returns {Promise<boolean>} true quando o tema pedido foi encontrado
     */
    async applyUserTheme(name) {
        const path = await resolveTheme(name);

        if (name && !path) {
            this._logger.warn(`tema de Shell '${name}' não encontrado`);
            return false;
        }

        this._userThemeApplied = Boolean(path);
        this._logger.info(path
            ? `tema de Shell: ${name}`
            : 'tema de Shell: padrão do GNOME');

        Main.setThemeStylesheet(path);
        Main.loadTheme();
        return true;
    }

    /** Devolve o tema de Shell ao padrão, se tivermos mexido nele. */
    restoreUserTheme() {
        if (!this._userThemeApplied)
            return;

        this._userThemeApplied = false;
        Main.setThemeStylesheet(null);
        Main.loadTheme();
    }

    // ------------------------------------------------------------- internos

    async _writeStylesheet(css) {
        const dir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), RUNTIME_SUBDIR]));
        try {
            dir.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }

        // Um único caminho estável: descarregar antes de reescrever faz o St
        // reler o conteúdo, e assim não sobram arquivos a cada mudança.
        const file = dir.get_child(STYLESHEET_NAME);
        this._unload();
        await file.replace_contents_async(
            new TextEncoder().encode(css), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        return file;
    }

    /** Carrega a folha recém-escrita no tema corrente. */
    _reload(file) {
        this._file = file;
        try {
            this._themeContext.get_theme()?.load_stylesheet(file);
            this._loaded = true;
            this._logger.debug(`folha carregada: ${file.get_path()}`);
        } catch (e) {
            this._logger.error('St não aceitou a folha de estilo', e);
            this._loaded = false;
        }
    }

    _unload() {
        if (!this._loaded || !this._file)
            return;

        try {
            this._themeContext.get_theme()?.unload_stylesheet(this._file);
        } catch (e) {
            this._logger.debug(`folha já descarregada: ${e.message}`);
        }
        this._loaded = false;
    }

    /**
     * Apaga um arquivo sem propagar erro: é sempre uma folha nossa em diretório
     * de execução, e falhar em removê-la não deve derrubar nada.
     *
     * @param {object} file
     * @returns {Promise<void>}
     */
    async _deleteQuietly(file) {
        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            // `clear()` e `destroy()` podem correr um atrás do outro; o segundo
            // encontrar o arquivo já removido é o caminho normal.
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return;
            this._logger.debug(`não foi possível apagar ${file.get_path()}: ${e.message}`);
        }
    }

    /**
     * O tema foi reconstruído. Normalmente o Shell já trouxe a nossa folha
     * junto; só recarrega se ela de fato não estiver na lista.
     */
    _onThemeChanged() {
        // Durante as nossas próprias trocas o sinal é apenas eco.
        if (this._mutating || this._reloading || !this._file || !this._css)
            return;

        const theme = this._themeContext.get_theme();
        if (!theme)
            return;

        if (this._isLoadedIn(theme)) {
            this._loaded = true;
            return;
        }

        this._reloading = true;
        try {
            theme.load_stylesheet(this._file);
            this._loaded = true;
            this._logger.debug('folha recarregada depois de troca de tema');
        } catch (e) {
            this._logger.error('falha ao recarregar a folha após troca de tema', e);
        } finally {
            this._reloading = false;
        }
    }

    /**
     * @param {object} theme St.Theme
     * @returns {boolean} a nossa folha já consta nas folhas adicionais do tema
     */
    _isLoadedIn(theme) {
        let sheets;
        try {
            sheets = theme.get_custom_stylesheets();
        } catch (e) {
            this._logger.debug(`não foi possível listar as folhas do tema: ${e.message}`);
            return false;
        }

        return (sheets ?? []).some(sheet => sheet?.equal?.(this._file));
    }

    destroy() {
        this._signals.destroy();
        this._unload();
        this.restoreUserTheme();

        if (this._file) {
            this._deleteQuietly(this._file);
            this._file = null;
        }
        this._css = null;
        this._themeContext = null;
    }
}
