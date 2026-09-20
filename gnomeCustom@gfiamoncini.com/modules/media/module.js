// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de mídia: a faixa em reprodução na barra superior, com um card.
 *
 * Na barra ficam a mini capa, o nome da música e os controles (anterior,
 * tocar/pausar, próxima); o clique no nome abre o card (desenho do WinDock) com
 * capa, título, artistas, álbum e a barra de tempo, que aceita clique para pular. Os mesmos controles têm atalhos de teclado, que nascem
 * vazios para o usuário definir (`MEDIA_ACTIONS`).
 *
 * Qualquer player MPRIS pode aparecer, mas só os permitidos em
 * `allowed-players`; entre eles, o que está tocando vence (`lib/mpris.js`).
 */

import Shell from 'gi://Shell';

import {Module} from '../../core/module.js';
import {MEDIA_ACTIONS, canInvoke, pickControlTarget, pickPlayer} from '../../lib/mpris.js';
import {MediaIndicator} from '../../ui/media/indicator.js';

const ROLE = 'gnomecustom-media';

/** Chaves que só mudam a aparência do botão ou do card. */
const APPEARANCE_KEYS = ['panel-max-width', 'show-controls', 'show-progress', 'ambient-background'];

export class MediaModule extends Module {
    static get id() {
        return 'media';
    }

    static get title() {
        return 'Media Controls';
    }

    static get requires() {
        return ['panel', 'mpris', 'coverArt', 'keybindings'];
    }

    enable() {
        this._panel = this.service('panel');
        this._mpris = this.service('mpris');
        this._coverArt = this.service('coverArt');
        this._keybindings = this.service('keybindings');
        this._settings = this.settings.child('media');

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'allowed-players', () => this._sync());
        for (const key of APPEARANCE_KEYS)
            this.signals.connectSetting(this._settings, key, () => this._indicator?.applySettings());

        this._unsubscribe = this._mpris.onChanged(() => this._sync());
        this._sync();

        // O Mutter acompanha sozinho as mudanças das chaves: registrar uma vez basta.
        for (const {key, method} of MEDIA_ACTIONS) {
            this._keybindings.add(key, this._settings, () => this._control(method, 'atalho'), {
                modes: Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            });
        }
    }

    disable() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        for (const {key} of MEDIA_ACTIONS)
            this._keybindings.remove(key);
        this._removeIndicator();

        this._panel = null;
        this._mpris = null;
        this._coverArt = null;
        this._keybindings = null;
        this._settings = null;
        this._player = null;
    }

    _createIndicator() {
        this._indicator = new MediaIndicator({
            settings: this._settings,
            signals: this.signals,
            onOpen: () => this._refreshPosition(),
            onControl: method => this._control(method, 'botão'),
            onSeek: position => this._seek(position),
            gettext: this.ctx.gettext,
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

    /**
     * @param {string} method 'PlayPause' | 'Next' | 'Previous'
     * @param {string} origin só para o log
     */
    _control(method, origin) {
        const target = pickControlTarget(this._mpris.players, this._settings.get_strv('allowed-players'));
        if (!canInvoke(target, method)) {
            this.log.debug(`${method} (${origin}) ignorado: ${target ? `${target.busName} não aceita` : 'nenhum player'}`);
            return;
        }
        this.log.debug(`${method} (${origin}) → ${target.busName}`);
        this._mpris.control(target.busName, method);
    }

    _seek(position) {
        const player = this._player;
        if (!player)
            return;
        this.log.debug(`SetPosition ${Math.round(position / 1e6)} s → ${player.busName}`);
        this._mpris.seek(player.busName, player.track.trackId, position);
    }

    _refreshPosition() {
        if (this._player)
            this._mpris.refreshPosition(this._player.busName);
    }
}
