// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Isolamento das configurações rápidas (COMPATIBILITY.md §2).
 *
 * APIs internas usadas:
 *   // GNOME 49: Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)
 *   // GNOME 49: SystemIndicator.quickSettingsItems
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class QuickSettingsService {
    /** @param {object} options @param {object} options.logger */
    constructor({logger}) {
        this._logger = logger;
        this._indicators = new Set();
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

    destroy() {
        for (const indicator of [...this._indicators])
            this.remove(indicator);
    }
}
