// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Visão geral: miniaturas de workspace, caixa de busca e janelas mostradas
 * (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: WorkspaceThumbnail.ThumbnailsBox.prototype._updateShouldShow, ._shouldShow, 'should-show'
 *   // GNOME 49: WorkspaceThumbnail.WorkspaceThumbnail.prototype._init, ._isOverviewWindow; ._contents, .monitorIndex
 *   // GNOME 49: Workspace.Workspace.prototype._isOverviewWindow
 *   // GNOME 49: Main.overview._overview.controls._thumbnailsBox, ._thumbnails
 *   // GNOME 49: Main.overview.searchEntry (e o St.Bin pai, medido pelo layout)
 *   // GNOME 49: Main.overview.searchController, 'notify::search-active'
 *   // GNOME 49: Background.BackgroundManager
 *
 * Reimplementação independente (LICENSE-AUDIT.md §4): o GNOME UI Tune foi lido só
 * para saber quais pontos do Shell controlam cada comportamento.
 *
 * Os patches ficam no escopo do módulo; o serviço entrega os protótipos e faz o que
 * precisa de estado interno — fundos das miniaturas e a caixa da busca —, sempre
 * com um jeito de desfazer.
 */

import Clutter from 'gi://Clutter';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

import {SignalTracker} from '../../core/signals.js';

const SEARCH_ANIMATION_MS = 120;

export class ShellOverviewService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._signals = new SignalTracker({name: 'svc:overview', logger});
        this._backgrounds = new Map();   // thumbnail -> {manager, changedId, destroyId}
        this._search = null;             // {bin, clip}
    }

    get thumbnailsBoxPrototype() {
        return WorkspaceThumbnail.ThumbnailsBox.prototype;
    }

    get thumbnailPrototype() {
        return WorkspaceThumbnail.WorkspaceThumbnail.prototype;
    }

    get workspacePrototype() {
        return Workspace.Workspace.prototype;
    }

    get _thumbnailsBox() {
        return Main.overview._overview?.controls?._thumbnailsBox ?? null;
    }

    /** Recalcula se a faixa de miniaturas aparece, depois de ligar ou desligar o patch. */
    refreshThumbnailsVisibility() {
        this._thumbnailsBox?._updateShouldShow();
    }

    /**
     * @param {object} metaWindow Meta.Window
     * @returns {{wmClass: string, skipTaskbar: boolean}}
     */
    describeWindow(metaWindow) {
        return {
            wmClass: metaWindow?.get_wm_class?.() ?? '',
            skipTaskbar: Boolean(metaWindow?.skip_taskbar),
        };
    }

    /**
     * Papel de parede atrás das janelas de uma miniatura. O BackgroundManager põe o
     * fundo por cima do contêiner; ele é descido para baixo das janelas agora e a
     * cada troca de papel de parede.
     *
     * @param {object} thumbnail WorkspaceThumbnail
     */
    addThumbnailBackground(thumbnail) {
        if (this._backgrounds.has(thumbnail) || !thumbnail._contents)
            return;

        const contents = thumbnail._contents;
        const manager = new Background.BackgroundManager({
            container: contents,
            monitorIndex: thumbnail.monitorIndex,
            vignette: false,
        });

        const lower = () => {
            const actor = manager.backgroundActor;
            if (actor?.get_parent() === contents)
                contents.set_child_below_sibling(actor, null);
        };
        lower();

        const changedId = manager.connect('changed', lower);
        const destroyId = thumbnail.connect('destroy', () => this._dropBackground(thumbnail));
        this._backgrounds.set(thumbnail, {manager, changedId, destroyId});
    }

    /** Aplica o fundo às miniaturas que já existem (visão geral aberta). */
    decorateExistingThumbnails() {
        for (const thumbnail of this._thumbnailsBox?._thumbnails ?? [])
            this.addThumbnailBackground(thumbnail);
    }

    removeThumbnailBackgrounds() {
        for (const thumbnail of [...this._backgrounds.keys()])
            this._dropBackground(thumbnail, true);
    }

    _dropBackground(thumbnail, disconnectDestroy = false) {
        const entry = this._backgrounds.get(thumbnail);
        if (!entry)
            return;

        this._backgrounds.delete(thumbnail);
        try {
            entry.manager.disconnect(entry.changedId);
            if (disconnectDestroy)
                thumbnail.disconnect(entry.destroyId);
            entry.manager.destroy();
        } catch (e) {
            this._logger.debug(`fundo de miniatura já liberado: ${e.message}`);
        }
    }

    /** @returns {boolean} há uma busca em andamento */
    get searchActive() {
        return Main.overview.searchController?.searchActive ?? false;
    }

    /**
     * @param {Function} callback recebe `searchActive`
     * @returns {Function} remove o observador
     */
    onSearchActiveChanged(callback) {
        const controller = Main.overview.searchController;
        if (!controller)
            return () => {};

        const token = this._signals.connect(controller, 'notify::search-active',
            () => callback(controller.searchActive));
        return () => this._signals.disconnect(token);
    }

    /**
     * Esconde ou mostra a caixa de busca. Escondida, o contêiner fica com altura
     * zero, e o layout da visão geral sobe o resto.
     *
     * A caixa nunca é desenhada com altura zero: a entrada do Shell usa
     * `offscreen_redirect`, e pintar com tamanho zero gera CRITICAL no Cogl. Por
     * isso a altura só vai a zero depois que a opacidade chega a zero, e volta ao
     * normal antes de a opacidade subir.
     *
     * @param {boolean} hidden
     */
    setSearchHidden(hidden) {
        const bin = Main.overview.searchEntry?.get_parent();
        if (!bin)
            return;

        if (!this._search)
            this._search = {bin, clip: bin.clip_to_allocation};
        bin.clip_to_allocation = true;

        const duration = Main.overview.visible ? SEARCH_ANIMATION_MS : 0;
        const mode = Clutter.AnimationMode.EASE_OUT_QUAD;
        bin.remove_all_transitions();

        if (hidden) {
            bin.ease({
                opacity: 0,
                duration,
                mode,
                onComplete: () => {
                    if (this._search)
                        bin.set_height(0);
                },
            });
        } else {
            bin.set_height(-1);
            bin.ease({opacity: 255, duration, mode});
        }
    }

    restoreSearch() {
        if (!this._search)
            return;

        const {bin, clip} = this._search;
        this._search = null;
        try {
            bin.remove_all_transitions();
            bin.set_height(-1);
            bin.opacity = 255;
            bin.clip_to_allocation = clip;
        } catch (e) {
            this._logger.debug(`caixa de busca já destruída: ${e.message}`);
        }
    }

    destroy() {
        this.removeThumbnailBackgrounds();
        this.restoreSearch();
        this._signals.destroy();
    }
}
