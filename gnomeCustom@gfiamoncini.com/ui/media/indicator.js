// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de mídia da barra superior e o card que ele abre.
 *
 * Baseado no card do spotify-controller (© 2026 NarkAgni, GPL-3.0-or-later —
 * reuso permitido, ver LICENSE-AUDIT.md §4): capa grande e redonda, título,
 * "artistas / álbum", tempo e fundo em degradê a partir da cor da capa. Por
 * decisão do usuário ficaram de fora curtir, playlists e letra; a barra de tempo
 * é reta e só mostra, sem arrastar.
 *
 * Na barra: mini capa, nome da música e os controles (anterior, tocar/pausar,
 * próxima). Os botões consomem o clique, então não abrem o card.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {canInvoke, estimatePosition, formatTime, playPauseIcon, progressFraction,
    trackSubtitle} from '../../lib/mpris.js';
import {darkenForContrast, rgba} from '../../theme/engine/color.js';

/** Intervalo de atualização do tempo, só com o card aberto e tocando. */
const TICK_MS = 1000;

/** Cor do degradê enquanto a capa não chega ou quando ela não tem cor útil. */
const FALLBACK_COLOR = [46, 52, 64];

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

export class MediaIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {object} options.settings Gio.Settings de `…gnomecustom.media`
     * @param {object} options.signals SignalTracker do módulo, dono do temporizador
     * @param {Function} [options.onOpen] chamado ao abrir o card
     * @param {Function} [options.onControl] chamado com 'PlayPause', 'Next' ou 'Previous'
     */
    constructor({settings, signals, onOpen = null, onControl = null}) {
        super(0.5, 'GnomeCustom Media', false);

        this._settings = settings;
        this._signals = signals;
        this._onOpen = onOpen;
        this._onControl = onControl;
        this._state = null;
        this._cover = null;
        this._tickToken = undefined;

        this._buildPanel();
        this._buildCard();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._syncProgress();
                this._onOpen?.();
            }
            this._syncTick();
        });
        this.connect('destroy', () => this._stopTick());
    }

    /**
     * O `PanelMenu.Button` abre o card já no pressionar, e o `St.Button` do GNOME
     * 49 só reconhece o clique ao soltar: sem este desvio, clicar num controle
     * abria o card e o menu roubava o soltar. Eventos vindos dos controles não
     * chegam ao tratamento do botão do painel.
     */
    vfunc_event(event) {
        const source = global.stage.get_event_actor(event);
        if (source && this._controls.contains(source))
            return Clutter.EVENT_PROPAGATE;
        return super.vfunc_event(event);
    }

    /**
     * @param {?object} player retrato do serviço `mpris`; null esconde o botão
     */
    setPlayer(player) {
        this._state = player;
        this.visible = player !== null;

        if (!player) {
            this.menu.close();
            this._syncTick();
            return;
        }

        const {track} = player;
        this._panelTitle.text = track.title;
        this._syncControls();
        this._source.text = player.identity;
        this._title.text = track.title;
        this._subtitle.text = trackSubtitle(track);
        this._subtitle.visible = this._subtitle.text !== '';
        this._total.text = formatTime(track.length);

        this._syncProgress();
        this._syncTick();
    }

    /**
     * @param {?{uri: string, color: ?number[]}} cover null volta ao ícone genérico
     */
    setCover(cover) {
        this._cover = cover;
        const image = cover?.uri
            ? `background-image: url("${cover.uri}"); background-size: cover;`
            : '';

        this._thumb.style = image;
        this._thumbIcon.visible = !image;
        this._coverArt.style = image;
        this._coverIcon.visible = !image;
        this._syncBackground();
    }

    /** Relê as chaves de aparência. */
    applySettings() {
        this._panelTitle.style = `max-width: ${this._settings.get_uint('panel-max-width')}px;`;
        this._controls.visible = this._settings.get_boolean('show-controls');
        this._controlsSeparator.visible = this._controls.visible;
        this._syncBackground();
        this._syncProgress();
        this._syncTick();
    }

    _buildPanel() {
        const box = new St.BoxLayout({style_class: 'gnomecustom-media-panel'});

        this._thumb = new St.Bin({
            style_class: 'gnomecustom-media-thumb',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._thumbIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'gnomecustom-media-thumb-icon',
        });
        this._thumb.set_child(this._thumbIcon);

        this._panelTitle = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._panelTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._controls = new St.BoxLayout({
            style_class: 'gnomecustom-media-controls',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._controlButtons = new Map([
            ['Previous', this._controlButton('media-skip-backward-symbolic', 'Previous')],
            ['PlayPause', this._controlButton(playPauseIcon('Paused'), 'PlayPause')],
            ['Next', this._controlButton('media-skip-forward-symbolic', 'Next')],
        ]);
        for (const button of this._controlButtons.values())
            this._controls.add_child(button);

        // capa | nome | controles
        this._controlsSeparator = this._separator();
        box.add_child(this._thumb);
        box.add_child(this._separator());
        box.add_child(this._panelTitle);
        box.add_child(this._controlsSeparator);
        box.add_child(this._controls);
        this.add_child(box);
    }

    _separator() {
        return new St.Widget({
            style_class: 'gnomecustom-media-separator',
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _controlButton(iconName, method) {
        const button = new St.Button({
            style_class: 'gnomecustom-media-control',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: iconName, style_class: 'gnomecustom-media-control-icon'}),
        });
        button.connect('clicked', () => this._onControl?.(method));
        return button;
    }

    _syncControls() {
        for (const [method, button] of this._controlButtons) {
            const enabled = canInvoke(this._state, method);
            button.reactive = enabled;
            button.opacity = enabled ? 255 : 110;
        }
        this._controlButtons.get('PlayPause').child.icon_name =
            playPauseIcon(this._state?.status);
    }

    _buildCard() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-media-item',
        });

        this._card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-media-card',
        });

        this._source = this._cardLabel('gnomecustom-media-source');

        this._coverArt = new St.Bin({
            style_class: 'gnomecustom-media-cover',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._coverIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'gnomecustom-media-cover-icon',
        });
        this._coverArt.set_child(this._coverIcon);

        this._title = this._cardLabel('gnomecustom-media-title');
        this._subtitle = this._cardLabel('gnomecustom-media-subtitle');

        this._progress = new St.BoxLayout({
            vertical: true,
            style_class: 'gnomecustom-media-progress',
        });
        // Caixa horizontal, e não BinLayout: o BinLayout centraliza o preenchimento
        // de largura fixa mesmo com `x_align: START`, e a barra crescia do meio.
        this._track = new St.BoxLayout({
            style_class: 'gnomecustom-media-track',
            x_expand: true,
        });
        this._fill = new St.Widget({
            style_class: 'gnomecustom-media-fill',
            y_expand: true,
        });
        this._track.add_child(this._fill);
        this._track.connect('notify::width', () => this._syncProgress());

        const times = new St.BoxLayout({style_class: 'gnomecustom-media-times'});
        this._elapsed = new St.Label({style_class: 'gnomecustom-media-time', x_expand: true});
        this._total = new St.Label({style_class: 'gnomecustom-media-time'});
        times.add_child(this._elapsed);
        times.add_child(this._total);

        this._progress.add_child(this._track);
        this._progress.add_child(times);

        for (const child of [this._source, this._coverArt, this._title, this._subtitle, this._progress])
            this._card.add_child(child);

        item.add_child(this._card);
        this.menu.addMenuItem(item);
    }

    _cardLabel(styleClass) {
        const label = new St.Label({style_class: styleClass, x_expand: true});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    /**
     * Degradê da cor da capa para o preto. O topo é escurecido o bastante para o
     * texto branco manter contraste AA, seja qual for a capa.
     */
    _syncBackground() {
        if (!this._settings.get_boolean('ambient-background')) {
            this.menu.box.remove_style_class_name('gnomecustom-media-menu');
            this._card.remove_style_class_name('gnomecustom-media-ambient');
            this._card.style = '';
            return;
        }

        const top = darkenForContrast(this._cover?.color ?? FALLBACK_COLOR, WHITE, 4.5);
        this.menu.box.add_style_class_name('gnomecustom-media-menu');
        this._card.add_style_class_name('gnomecustom-media-ambient');
        this._card.style =
            'background-gradient-direction: vertical; ' +
            `background-gradient-start: ${rgba(top, 0.96)}; ` +
            `background-gradient-end: ${rgba(BLACK, 0.96)};`;
    }

    _syncProgress() {
        const length = this._state?.track.length ?? 0;
        this._progress.visible = length > 0 && this._settings.get_boolean('show-progress');
        if (!this._progress.visible)
            return;

        const position = estimatePosition(this._state.anchor, GLib.get_monotonic_time(), length);
        this._elapsed.text = formatTime(position);
        this._fill.width = Math.round(this._track.width * progressFraction(position, length));
    }

    _syncTick() {
        const needed = this.menu.isOpen &&
            this._state?.status === 'Playing' &&
            this._settings.get_boolean('show-progress');

        if (!needed) {
            this._stopTick();
        } else if (this._tickToken === undefined) {
            this._tickToken = this._signals.addTimeout(TICK_MS, () => {
                this._syncProgress();
                return GLib.SOURCE_CONTINUE;
            }, {label: 'media-progress'});
        }
    }

    _stopTick() {
        if (this._tickToken === undefined)
            return;
        this._signals.removeSource(this._tickToken);
        this._tickToken = undefined;
    }

    destroy() {
        this._stopTick();
        this._state = null;
        this._cover = null;
        this._onOpen = null;
        this._onControl = null;
        super.destroy();
    }
}
