// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de mídia: a faixa em reprodução na barra superior, com um card.
 *
 * Na barra fica a mini capa e o nome da música; o clique abre o card com capa
 * grande, título, artistas, álbum e tempo. Sem controles de reprodução — decisão
 * do usuário ao trocar a base para o spotify-controller (ROADMAP, Fase 3).
 *
 * Qualquer player MPRIS pode aparecer, mas só os permitidos em
 * `allowed-players`; entre eles, o que está tocando vence (`lib/mpris.js`).
 */

import {Module} from '../../core/module.js';
import {pickPlayer} from '../../lib/mpris.js';
import {MediaIndicator} from '../../ui/media/indicator.js';

const ROLE = 'gnomecustom-media';

/** Chaves que só mudam a aparência do botão ou do card. */
const APPEARANCE_KEYS = ['panel-max-width', 'show-progress', 'ambient-background'];

export class MediaModule extends Module {
    static get id() {
        return 'media';
    }

    static get title() {
        return 'Media Controls';
    }

    static get requires() {
        return ['panel', 'mpris', 'coverArt'];
    }

    enable() {
        this._panel = this.service('panel');
        this._mpris = this.service('mpris');
        this._coverArt = this.service('coverArt');
        this._settings = this.settings.child('media');

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'allowed-players', () => this._sync());
        for (const key of APPEARANCE_KEYS)
            this.signals.connectSetting(this._settings, key, () => this._indicator?.applySettings());

        this._unsubscribe = this._mpris.onChanged(() => this._sync());
        this._sync();
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._removeIndicator();

        this._panel = null;
        this._mpris = null;
        this._coverArt = null;
        this._settings = null;
        this._player = null;
    }

    _createIndicator() {
        this._indicator = new MediaIndicator({
            settings: this._settings,
            signals: this.signals,
            onOpen: () => this._refreshPosition(),
        });
        this._indicator.applySettings();
        this._artUrl = null;

        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            position: 0,
        });
    }

    _removeIndicator() {
        if (!this._indicator)
            return;
        this._panel.remove(ROLE);
        this._indicator = null;
    }

    _recreate() {
        this._removeIndicator();
        this._createIndicator();
        this._sync();
    }

    _sync() {
        if (!this._indicator)
            return;

        const player = pickPlayer(this._mpris.players, this._settings.get_strv('allowed-players'));
        this._player = player;
        this._indicator.setPlayer(player);

        const shown = player ? `${player.busName} — ${player.track.title}` : 'nenhum';
        if (shown !== this._shown) {
            this._shown = shown;
            this.log.debug(`player exibido: ${shown}`);
        }

        const url = player?.track.artUrl ?? '';
        if (!player || url === this._artUrl)
            return;
        this._artUrl = url;

        if (!url) {
            this._indicator.setCover(null);
            return;
        }

        // A capa anterior fica até a nova chegar, para o botão não piscar.
        this._coverArt.load(url).then(cover => {
            if (this._indicator && this._artUrl === url)
                this._indicator.setCover(cover);
        });
    }

    _refreshPosition() {
        if (this._player)
            this._mpris.refreshPosition(this._player.busName);
    }
}
