// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Interruptor "Mosaico" nas configurações rápidas.
 *
 * Ligado direto à chave `tiling-mode`: o interruptor, o atalho e as preferências
 * mudam a mesma coisa, sem sincronização à parte.
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ICON = 'view-grid-symbolic';

export const TilingQuickToggle = GObject.registerClass(
class TilingQuickToggle extends QuickToggle {
    /**
     * @param {object} settings Gio.Settings de `…gnomecustom.tiling`
     * @param {string} title
     */
    _init(settings, title) {
        super._init({title, iconName: ICON, toggleMode: true});
        settings.bind('tiling-mode', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
    }
});

export const TilingIndicator = GObject.registerClass(
class TilingIndicator extends SystemIndicator {
    /**
     * @param {object} settings
     * @param {string} title
     */
    _init(settings, title) {
        super._init();
        this.quickSettingsItems.push(new TilingQuickToggle(settings, title));
    }

    destroy() {
        for (const item of this.quickSettingsItems)
            item.destroy();
        super.destroy();
    }
});
