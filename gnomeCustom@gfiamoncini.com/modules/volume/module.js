// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo do OSD de volume: o nível aparece como número no lugar do ícone.
 *
 * Reimplementação (PROJECT-AUDIT.md: REWRITE) do comportamento que o baseline
 * usa da OSD Volume Number — número à esquerda, ícone escondido, menu do painel
 * intocado. Vale para todo OSD com barra de nível, como no original.
 *
 * O clique do meio no alto-falante da barra liga e desliga o mudo sem abrir o
 * menu, como no WinDock (pedido do usuário, 2026-10-07).
 *
 * O patch fica no escopo do módulo, então é revertido e contado na verificação
 * de limpeza; o acesso à estrutura interna da janela fica no serviço `osd`.
 */

import {Module} from '../../core/module.js';

const STYLE_CLASS = 'gnomecustom-osd-number';

/**
 * Valor da barra de nível em texto. A barra vai de 0 a 2: acima de 1 é a
 * amplificação além de 100%.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatLevel(value) {
    if (!Number.isFinite(value))
        return '';
    return String(Math.round(Math.max(0, value) * 100));
}

export class VolumeModule extends Module {
    static get id() {
        return 'volume';
    }

    static get title() {
        return 'Volume OSD';
    }

    static get requires() {
        return ['osd', 'quickSettings'];
    }

    enable() {
        const osd = this.service('osd');
        const log = this.log;
        const options = {styleClass: STYLE_CLASS, format: formatLevel};
        const settings = this.settings.child('volume');
        this._osd = osd;

        this.patcher.override(osd.windowPrototype, 'show', original => function (...args) {
            // Uma falha aqui não pode impedir o OSD de aparecer.
            try {
                osd.showNumber(this, options);
                osd.place(this, {
                    belowBar: settings.get_boolean('below-bar'),
                    compact: settings.get_boolean('compact'),
                    align: settings.get_string('align'),
                });
            } catch (e) {
                log.error('falha ao exibir o número no OSD', e);
            }
            return original.apply(this, args);
        }, {api: 'OsdWindow.show'});

        const quick = this.service('quickSettings');
        this._undoMiddleClick = quick.onVolumeMiddleClick(() => {
            const muted = quick.toggleOutputMute();
            log.debug(`clique do meio no alto-falante: ${muted === null ? 'sem saída de som' : `mudo ${muted}`}`);
        });
    }

    disable() {
        this._undoMiddleClick?.();
        this._undoMiddleClick = null;
        this._osd?.restorePlacement();
        this._osd?.restoreAll();
        this._osd = null;
    }
}
