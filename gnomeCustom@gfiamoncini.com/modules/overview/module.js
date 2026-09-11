// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo da visão geral: os ajustes que o baseline usa do GNOME UI Tune.
 *
 *  - miniaturas de workspace mesmo com um só — o baseline tem `num-workspaces = 1`,
 *    e sem isso a faixa de miniaturas nunca aparece;
 *  - papel de parede atrás das miniaturas, no lugar do cinza;
 *  - caixa de busca escondida até começar a digitar;
 *  - janela picture-in-picture do Firefox na visão geral.
 *
 * O tamanho das miniaturas do baseline (`100%`) é o padrão do próprio GNOME, então
 * não há ajuste de escala.
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4). Cada recurso liga e desliga
 * a quente pela própria chave; os patches ficam no escopo do módulo.
 */

import {Module} from '../../core/module.js';
import {isFirefoxPip} from '../../lib/overview.js';

export const FEATURES = Object.freeze([
    'always-show-thumbnails',
    'thumbnails-background',
    'hide-search',
    'show-firefox-pip',
]);

export class OverviewModule extends Module {
    static get id() {
        return 'overview';
    }

    static get title() {
        return 'Overview';
    }

    static get requires() {
        return ['overview'];
    }

    enable() {
        this._overview = this.service('overview');
        this._settings = this.settings.child('overview');
        this._active = new Set();

        for (const key of FEATURES)
            this.signals.connectSetting(this._settings, key, () => this._sync(key), {fireNow: true});
    }

    disable() {
        for (const key of [...this._active ?? []])
            this._turnOff(key);

        this._overview = null;
        this._settings = null;
        this._active = null;
    }

    _sync(key) {
        const wanted = this._settings.get_boolean(key);
        if (wanted === this._active.has(key))
            return;

        if (wanted)
            this._turnOn(key);
        else
            this._turnOff(key);
    }

    _turnOn(key) {
        const overview = this._overview;

        switch (key) {
        case 'always-show-thumbnails':
            this.patcher.override(overview.thumbnailsBoxPrototype, '_updateShouldShow',
                original => function () {
                    original.call(this);
                    // O Shell esconde a faixa com um só workspace; aqui ela fica.
                    if (!this._shouldShow) {
                        this._shouldShow = true;
                        this.notify('should-show');
                    }
                }, {api: 'ThumbnailsBox._updateShouldShow'});
            overview.refreshThumbnailsVisibility();
            break;

        case 'thumbnails-background':
            this.patcher.override(overview.thumbnailPrototype, '_init',
                original => function (...args) {
                    original.apply(this, args);
                    overview.addThumbnailBackground(this);
                }, {api: 'WorkspaceThumbnail._init'});
            overview.decorateExistingThumbnails();
            break;

        case 'hide-search':
            this._unsubscribeSearch = overview.onSearchActiveChanged(
                active => overview.setSearchHidden(!active));
            overview.setSearchHidden(!overview.searchActive);
            break;

        case 'show-firefox-pip':
            this.patcher.override(overview.workspacePrototype, '_isOverviewWindow',
                original => function (metaWindow) {
                    return original.call(this, metaWindow) ||
                        isFirefoxPip(overview.describeWindow(metaWindow));
                }, {api: 'Workspace._isOverviewWindow'});
            this.patcher.override(overview.thumbnailPrototype, '_isOverviewWindow',
                original => function (windowActor) {
                    const metaWindow = windowActor.get_meta_window();
                    return original.call(this, windowActor) ||
                        (metaWindow.showing_on_its_workspace() &&
                            isFirefoxPip(overview.describeWindow(metaWindow)));
                }, {api: 'WorkspaceThumbnail._isOverviewWindow'});
            break;
        }

        this._active.add(key);
        this.log.debug(`recurso ligado: ${key}`);
    }

    _turnOff(key) {
        const overview = this._overview;

        switch (key) {
        case 'always-show-thumbnails':
            this.patcher.restore(overview.thumbnailsBoxPrototype, '_updateShouldShow');
            overview.refreshThumbnailsVisibility();
            break;

        case 'thumbnails-background':
            this.patcher.restore(overview.thumbnailPrototype, '_init');
            overview.removeThumbnailBackgrounds();
            break;

        case 'hide-search':
            this._unsubscribeSearch?.();
            this._unsubscribeSearch = null;
            overview.restoreSearch();
            break;

        case 'show-firefox-pip':
            this.patcher.restore(overview.workspacePrototype, '_isOverviewWindow');
            this.patcher.restore(overview.thumbnailPrototype, '_isOverviewWindow');
            break;
        }

        this._active.delete(key);
        this.log.debug(`recurso desligado: ${key}`);
    }
}
