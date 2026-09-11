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
import {buildTokens} from '../../theme/engine/tokens.js';
import {generateStylesheet} from '../../theme/engine/stylesheet.js';

/** Chaves que, ao mudar, exigem regerar a folha. */
const STYLE_KEYS = [
    'panel-style', 'panel-height', 'panel-margin-top', 'panel-margin-bottom',
    'panel-margin-sides', 'panel-radius', 'panel-border-width',
    'panel-border-alpha', 'panel-background-alpha', 'accent-color',
    'background-color', 'foreground-color', 'palette-from-wallpaper',
    'palette', 'palette-slot', 'fitts-widgets',
];

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
        return ['shellTheme', 'wallpaper'];
    }

    enable() {
        this._theme = this.service('shellTheme');
        this._wallpaper = this.service('wallpaper');
        this._settings = this.settings.child('theme');
        this._rebuildToken = undefined;

        for (const key of STYLE_KEYS)
            this.signals.connectSetting(this._settings, key, () => this._scheduleRebuild());

        this.signals.connectSetting(this._settings, 'shell-theme',
            () => this._applyUserTheme());

        this._unsubscribePalette = this._wallpaper.onPaletteChanged(
            palette => this._onPaletteChanged(palette));

        this._applyUserTheme();
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

        this._theme = null;
        this._wallpaper = null;
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

        this._theme?.apply(css)
            .then(changed => {
                if (changed) {
                    this.log.debug(tokens.enabled
                        ? `folha regerada (${css.length} bytes)`
                        : 'estilo do painel desligado');
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

    _applyUserTheme() {
        const name = this._settings.get_string('shell-theme');
        this._theme?.applyUserTheme(name).catch(e =>
            this.log.error(`falha ao aplicar o tema de Shell '${name}'`, e));
    }

    /** Traduz o GSettings para o objeto simples que o engine espera. */
    _readConfig() {
        const s = this._settings;
        return {
            panelStyle: s.get_string('panel-style'),
            panelHeight: s.get_uint('panel-height'),
            marginTop: s.get_double('panel-margin-top'),
            marginBottom: s.get_double('panel-margin-bottom'),
            marginSides: s.get_double('panel-margin-sides'),
            radius: s.get_double('panel-radius'),
            borderWidth: s.get_double('panel-border-width'),
            borderAlpha: s.get_double('panel-border-alpha'),
            backgroundAlpha: s.get_double('panel-background-alpha'),
            accentColor: s.get_string('accent-color'),
            backgroundColor: s.get_string('background-color'),
            foregroundColor: s.get_string('foreground-color'),
            paletteFromWallpaper: s.get_boolean('palette-from-wallpaper'),
            palette: s.get_strv('palette'),
            paletteSlot: s.get_uint('palette-slot'),
            fittsWidgets: s.get_boolean('fitts-widgets'),
        };
    }
}
