// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento das configurações rápidas (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)
 *   // GNOME 49: SystemIndicator.quickSettingsItems
 *   // GNOME 49: Main.panel.statusArea.quickSettings._volumeOutput._indicator
 *   //           (o alto-falante da barra; já é reativo, por causa da roda)
 *   // GNOME 49: Volume.getMixerControl().get_default_sink()
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

/** De quanto em quanto, e por quantas vezes, o alto-falante é procurado. */
const VOLUME_RETRY_MS = 500;
const VOLUME_RETRIES = 40;

export class QuickSettingsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._indicators = new Set();
        this._undos = new Set();
    }

    /** @param {object} indicator SystemIndicator com seus itens */
    add(indicator) {
        const menu = Main.panel.statusArea.quickSettings;
        if (!menu?.addExternalIndicator) {
            this._logger.warn('configurações rápidas indisponíveis neste modo de sessão');
            indicator.destroy();
            return false;
        }
        menu.addExternalIndicator(indicator);
        this._indicators.add(indicator);
        return true;
    }

    remove(indicator) {
        if (!this._indicators.delete(indicator))
            return;
        try {
            indicator.destroy();
        } catch (e) {
            this._logger.debug(`indicador já destruído: ${e.message}`);
        }
    }

    /**
     * Clique do meio no alto-falante da barra, sem abrir o menu.
     *
     * O menu rápido monta os ícones de forma assíncrona: no login o alto-falante
     * ainda não existe quando a extensão liga, então a busca é repetida por
     * alguns segundos antes de desistir.
     *
     * @param {Function} callback
     * @returns {Function} desfaz
     */
    onVolumeMiddleClick(callback) {
        let icon = null;
        let handler = 0;
        let timer = 0;
        let tries = 0;

        const attach = () => {
            icon = Main.panel.statusArea.quickSettings?._volumeOutput?._indicator ?? null;
            if (!icon)
                return false;
            // Parar o evento aqui impede o botão da barra de abrir o menu rápido.
            handler = icon.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_MIDDLE)
                    return Clutter.EVENT_PROPAGATE;
                callback();
                return Clutter.EVENT_STOP;
            });
            return true;
        };

        if (!attach()) {
            timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VOLUME_RETRY_MS, () => {
                if (attach() || ++tries >= VOLUME_RETRIES) {
                    if (!icon)
                        this._logger.warn('alto-falante da barra não encontrado; clique do meio indisponível');
                    timer = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        const undo = () => {
            this._undos.delete(undo);
            if (timer)
                GLib.source_remove(timer);
            timer = 0;
            if (!handler)
                return;
            try {
                icon.disconnect(handler);
            } catch (e) {
                this._logger.debug(`alto-falante já destruído: ${e.message}`);
            }
            handler = 0;
        };
        this._undos.add(undo);
        return undo;
    }

    /**
     * Liga ou desliga o mudo da saída de som padrão.
     *
     * @returns {?boolean} o estado novo; null sem saída de som
     */
    toggleOutputMute() {
        const stream = Volume.getMixerControl()?.get_default_sink();
        if (!stream)
            return null;
        const muted = !stream.is_muted;
        stream.change_is_muted(muted);
        return muted;
    }

    /**
     * Soma `delta` ao volume dos fluxos de áudio de um aplicativo (e não ao da
     * saída de som). Um app pode ter mais de um fluxo; todos vão para o mesmo valor.
     *
     * @param {Function} belongs ({name, appId}) => boolean
     * @param {Function} step (atual: 0–1) => novo: 0–1
     * @returns {?number} o volume novo, 0–1; null quando o app não está tocando nada
     */
    changeAppVolume(belongs, step) {
        const control = Volume.getMixerControl();
        const all = control?.get_sink_inputs() ?? [];
        const streams = all.filter(stream => belongs({
            name: stream.get_name(),
            appId: stream.get_application_id(),
        }));
        if (streams.length === 0) {
            this._logger.debug(`nenhum fluxo do app entre: ${
                all.map(s => `${s.get_name()} (${s.get_application_id()})`).join(', ') || 'nenhum'}`);
            return null;
        }

        const norm = control.get_vol_max_norm();
        const level = step(streams[0].volume / norm);
        for (const stream of streams) {
            stream.volume = Math.round(level * norm);
            stream.push_volume();
            if (level > 0 && stream.is_muted)
                stream.change_is_muted(false);
        }
        return level;
    }

    destroy() {
        for (const undo of [...this._undos])
            undo();
        for (const indicator of [...this._indicators])
            this.remove(indicator);
    }
}
