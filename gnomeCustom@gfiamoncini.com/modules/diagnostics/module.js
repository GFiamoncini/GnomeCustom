// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Conflict Detector (briefing §25).
 *
 * Enquanto o GnomeCustom substitui as extensões originais progressivamente, as
 * duas implementações convivem. Este módulo não desabilita nada por conta
 * própria — ele detecta e informa, porque desligar extensões do usuário sem
 * pedir seria pior do que o conflito.
 *
 * Distingue dois casos:
 *   - *detectada*: a extensão original está ativa, mas o módulo correspondente
 *     do GnomeCustom está desligado. Sem conflito; registrado em nível info.
 *   - *conflito*: ambos ativos ao mesmo tempo, disputando a mesma função.
 *     Registrado em nível warn.
 */

import {Module} from '../../core/module.js';
import {KNOWN_EXTENSIONS} from '../../lib/known-extensions.js';

export class DiagnosticsModule extends Module {
    static get id() {
        return 'diagnostics';
    }

    static get title() {
        return 'Diagnóstico';
    }

    static get requires() {
        return ['shellExtensions', 'status'];
    }

    enable() {
        this._extensions = this.service('shellExtensions');

        // Reavalia quando qualquer extensão muda de estado…
        this._unsubscribe = this._extensions.onStateChanged(() => this._schedule());

        // …e quando um módulo nosso é ligado ou desligado.
        for (const key of this._watchedKeys())
            this.signals.connectSetting(this.settings.base, key, () => this._schedule());

        this.signals.connectSetting(this.settings.base, 'conflict-warnings',
            () => this._schedule());

        this._schedule();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._extensions = null;
        this._lastConflicts = null;
    }

    /**
     * Estado atual, para exibição ou depuração.
     *
     * @returns {{conflicts: object[], detected: object[]}}
     */
    inspect() {
        const conflicts = [];
        const detected = [];

        for (const entry of KNOWN_EXTENSIONS) {
            if (!this._extensions?.isRunning(entry.uuid))
                continue;

            const moduleOn = this._isModuleEnabled(entry.module);
            (moduleOn ? conflicts : detected).push({...entry, moduleEnabled: moduleOn});
        }

        return {conflicts, detected};
    }

    /** Agrupa rajadas de mudanças em uma única avaliação. */
    _schedule() {
        if (this._pendingToken !== undefined)
            return;

        this._pendingToken = this.signals.addIdle(() => {
            this._pendingToken = undefined;
            this._evaluate();
            return false;   // GLib.SOURCE_REMOVE
        }, {label: 'conflict-scan'});
    }

    _evaluate() {
        const {conflicts, detected} = this.inspect();

        const signature = conflicts.map(c => c.uuid).sort().join(',');
        if (signature === this._lastConflicts)
            return;
        this._lastConflicts = signature;

        for (const entry of detected)
            this.log.info(`${entry.name} detectada (módulo '${entry.module}' está desligado)`);

        if (!this.settings.getBoolean('conflict-warnings'))
            return;

        for (const entry of conflicts) {
            this.log.warn(
                `conflito: '${entry.name}' e o módulo '${entry.module}' do GnomeCustom ` +
                `disputam ${entry.feature}. Esta função já é fornecida pelo GnomeCustom — ` +
                `desative '${entry.name}' para evitar comportamento duplicado.`);
        }

        if (conflicts.length === 0)
            this.log.info('nenhum conflito ativo');
    }

    _isModuleEnabled(moduleId) {
        try {
            return this.settings.getBoolean(`${moduleId}-enabled`);
        } catch (e) {
            this.log.debug(`módulo '${moduleId}' sem chave própria: ${e.message}`);
            return false;
        }
    }

    /** Chaves `*-enabled` dos módulos citados na tabela de extensões conhecidas. */
    _watchedKeys() {
        return [...new Set(KNOWN_EXTENSIONS.map(entry => `${entry.module}-enabled`))];
    }
}
