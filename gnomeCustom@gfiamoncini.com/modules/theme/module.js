// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de tematização.
 *
 * Junta as peças: paleta do papel de parede → tokens → CSS → folha adicional no
 * tema corrente. Também assume o papel da extensão User Themes, carregando o
 * tema de Shell escolhido pelo usuário.
 *
 * O CSS gerado é somado ao tema do usuário e nunca o substitui (AD-8); quando
 * nenhuma cor é resolvida, a folha traz apenas geometria e as cores continuam
 * sendo as do tema instalado.
 */

import {Module} from '../../core/module.js';
import {buildTokens, SETTINGS_KEYS} from '../../theme/engine/tokens.js';
import {generateStylesheet} from '../../theme/engine/stylesheet.js';

/** Chaves que, ao mudar, exigem regerar a folha: a lista única do engine. */
const STYLE_KEYS = Object.keys(SETTINGS_KEYS);

/** Espera antes de regerar, para agrupar mudanças em rajada. */
const REBUILD_DEBOUNCE_MS = 120;

export class ThemeModule extends Module {
    static get id() {
        return 'theme';
    }

    static get title() {
        return 'Theme';
    }

    static get requires() {
        return ['shellTheme', 'wallpaper', 'style', 'appTheme'];
    }

    enable() {
        this._theme = this.service('shellTheme');
        this._wallpaper = this.service('wallpaper');
        this._style = this.service('style');
        this._appTheme = this.service('appTheme');
        this._settings = this.settings.child('theme');
        this._rebuildToken = undefined;

        for (const key of STYLE_KEYS)
            this.signals.connectSetting(this._settings, key, () => this._scheduleRebuild());

        for (const key of ['shell-theme', 'amoled-black'])
            this.signals.connectSetting(this._settings, key, () => this._applyUserTheme());
        for (const key of ['shell-theme', 'apply-to-apps'])
            this.signals.connectSetting(this._settings, key, () => this._syncAppTheme());

        this._unsubscribePalette = this._wallpaper.onPaletteChanged(
            palette => this._onPaletteChanged(palette));

        this._applyUserTheme();
        this._syncAppTheme();
        this._rebuild();
        this._refreshPaletteIfNeeded();
    }

    disable() {
        this._unsubscribePalette?.();
        this._unsubscribePalette = null;

        // O serviço pode continuar vivo para outros módulos, então é este
        // módulo que precisa desfazer o que aplicou.
        this._theme?.clear().catch(e =>
            this.log.error('falha ao remover a folha de estilo', e));
        this._theme?.restoreUserTheme();
        this._style?.clear();
        this._appTheme = null;   // o tema dos apps fica: ver _syncAppTheme

        this._theme = null;
        this._wallpaper = null;
        this._style = null;
        this._settings = null;
    }

    /** Tokens atuais, para outros módulos e para depuração. */
    get tokens() {
        return buildTokens(this._readConfig());
    }

    _scheduleRebuild() {
        if (this._rebuildToken !== undefined)
            return;

        this._rebuildToken = this.signals.addTimeout(REBUILD_DEBOUNCE_MS, () => {
            this._rebuildToken = undefined;
            this._rebuild();
            return false;   // GLib.SOURCE_REMOVE
        }, {label: 'theme-rebuild'});
    }

    _rebuild() {
        const tokens = buildTokens(this._readConfig());
        const css = generateStylesheet(tokens);

        // Quem não se estiliza por CSS (o dock) recebe os tokens direto.
        this._style?.publish(tokens);

        this._theme?.apply(css)
            .then(changed => {
                if (changed) {
                    this.log.debug(tokens.enabled
                        ? `folha regerada (${css.length} bytes; ${describeSurfaces(tokens)})`
                        : 'nenhuma superfície estilizada');
                }
            })
            .catch(e => this.log.error('falha ao aplicar o estilo', e));
    }

    /** Extrai a paleta quando ela é necessária e ainda não existe. */
    _refreshPaletteIfNeeded() {
        if (!this._settings.get_boolean('palette-from-wallpaper'))
            return;

        if (this._settings.get_strv('palette').length > 0) {
            // Já há paleta em cache; confirma em segundo plano se o papel de
            // parede mudou desde a última extração.
            this._wallpaper.extract().catch(e =>
                this.log.error('falha ao conferir a paleta', e));
            return;
        }

        this._wallpaper.extract({force: true}).catch(e =>
            this.log.error('falha ao extrair a paleta', e));
    }

    _onPaletteChanged(palette) {
        if (palette.length === 0)
            return;

        const current = this._settings.get_strv('palette');
        if (current.length === palette.length &&
            current.every((color, i) => color === palette[i]))
            return;

        // Gravar a paleta dispara o observador de 'palette', que regera a folha.
        this._settings.set_strv('palette', palette);
        this.log.debug(`paleta atualizada: ${palette.slice(0, 3).join(' ')}…`);
    }

    /** Tema dos apps: não é desfeito no disable (ver services/system/app-theme.js). */
    _syncAppTheme() {
        this._appTheme?.sync({
            themeName: this._settings.get_string('shell-theme'),
            enabled: this._settings.get_boolean('apply-to-apps'),
            settings: this._settings,
        }).catch(e => this.log.error('falha ao aplicar o tema aos aplicativos', e));
    }

    _applyUserTheme() {
        const name = this._settings.get_string('shell-theme');
        const amoled = this._settings.get_boolean('amoled-black');
        this._theme?.applyUserTheme(name, {amoled}).catch(e =>
            this.log.error(`falha ao aplicar o tema de Shell '${name}'`, e));
    }

    /**
     * Traduz o GSettings para o objeto simples que o engine espera.
     *
     * `get_value().recursiveUnpack()` serve a todos os tipos do esquema (enum
     * volta como o nick), então a leitura segue a lista única sem casos à parte.
     */
    _readConfig() {
        const config = {};
        for (const [key, name] of Object.entries(SETTINGS_KEYS))
            config[name] = this._settings.get_value(key).recursiveUnpack();
        return config;
    }
}

/** Resumo das superfícies ativas, para o log de depuração. */
function describeSurfaces(tokens) {
    const on = [];
    if (tokens.panel.enabled)
        on.push('barra');
    if (tokens.menu.enabled)
        on.push('menus');
    if (tokens.osd.enabled)
        on.push('OSD');
    if (tokens.dock.enabled)
        on.push('dock');
    return on.join(', ');
}
