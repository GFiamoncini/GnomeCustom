// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de atualizações: o que o dnf e o Flatpak têm para atualizar, na barra.
 *
 * Pedido do usuário em 2026-09-29, pelo que o WinDock ganhou (Windows Update +
 * winget). O ícone **só existe com pendência**, como o dos dispositivos
 * externos; "Atualizar" abre o GNOME Software, que é quem instala.
 *
 * Quando se busca:
 *
 * - um minuto depois de ativar, para não disputar o login, e depois a cada
 *   `interval-hours` (6 h de fábrica), baixando as listas quando passaram do prazo;
 * - pelo "Verificar agora" do card, do mesmo jeito;
 * - quando o PackageKit ou o Flatpak avisam que algo mudou nesta máquina — aí só
 *   relendo o que está guardado, que é o que basta para tirar do card o que o
 *   Software acabou de instalar.
 *
 * As regras estão em `lib/updates.js`; a leitura, em `services/system/updates.js`.
 */

import {Module} from '../../core/module.js';
import {countPending, nextCheckDelay, summarize} from '../../lib/updates.js';
import {UpdatesIndicator} from '../../ui/updates/indicator.js';

const ROLE = 'gnomecustom-updates';

/** A primeira busca espera o login assentar. */
const FIRST_CHECK_MS = 60 * 1000;

/** De quanto em quanto o prazo é conferido pela hora de verdade. */
const WAKE_MS = 30 * 60 * 1000;

export class UpdatesModule extends Module {
    static get id() {
        return 'updates';
    }

    static get title() {
        return 'Updates';
    }

    static get requires() {
        return ['panel', 'updates'];
    }

    enable() {
        this._panel = this.service('panel');
        this._updates = this.service('updates');
        this._settings = this.settings.child('updates');
        this._state = {system: [], flatpak: [], errors: {system: null, flatpak: null}, restartPending: false};
        this._checking = false;
        this._queued = null;       // aviso de mudança que chegou durante uma busca
        this._checkedAt = null;    // última busca que foi à rede
        this._message = null;
        this._timer = undefined;
        // Não volta a zero: uma busca do enable anterior ainda pode chegar e
        // precisa continuar sendo reconhecida como velha.
        this._generation ??= 0;
        this._summary = null;

        this._createIndicator();

        this.signals.connectSetting(this._settings, 'panel-position', () => this._recreate());
        this.signals.connectSetting(this._settings, 'interval-hours', () => this._schedule());

        this._unsubscribe = this._updates.onChanged(sources => this._check({refresh: false, sources}));
        this._schedule(FIRST_CHECK_MS);
    }

    disable() {
        this._generation++;   // buscas que voltarem depois são descartadas
        this._stopTimer();
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._removeIndicator();

        this._panel = null;
        this._updates = null;
        this._settings = null;
        this._state = null;
    }

    _createIndicator() {
        this._indicator = new UpdatesIndicator({
            gettext: this.ctx.gettext,
            onCheck: () => this._check({refresh: true}),
            onUpdate: () => this._openSoftware(),
            onClosed: () => {
                this._message = null;
                this._render();
            },
        });
        this._panel.add(ROLE, this._indicator, {
            box: this._settings.get_string('panel-position'),
            position: 0,
        });
        this._render();
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
    }

    _render() {
        if (!this._indicator)
            return;
        this._indicator.update(this._state, {
            checking: this._checking,
            checkedAt: this._checkedAt,
            message: this._message ?? this._errorMessage(),
        });
        // Com o card aberto o botão fica, mesmo sem pendência: é nele que está o
        // "tudo em dia" de quem acabou de pedir "Verificar agora".
        this._indicator.visible = countPending(this._state) > 0 || this._indicator.menu.isOpen;
    }

    _errorMessage() {
        const _ = this.ctx.gettext;
        const {system, flatpak} = this._state.errors;
        if (system && flatpak)
            return {kind: 'error', text: _('Could not check for updates. Is the computer online?')};
        if (system)
            return {kind: 'error', text: _('Could not check the system updates: %s').replace('%s', system)};
        if (flatpak)
            return {kind: 'error', text: _('Could not check the Flatpak updates: %s').replace('%s', flatpak)};
        return null;
    }

    /**
     * @param {object} options
     * @param {boolean} options.refresh ir à rede
     * @param {{system?: boolean, flatpak?: boolean}} [options.sources]
     */
    async _check({refresh, sources = {system: true, flatpak: true}}) {
        if (!this._updates)
            return;
        if (this._checking) {
            // Uma busca de rede já cobre um aviso local; o contrário, não.
            if (refresh || !this._queued)
                this._queued = {refresh, sources};
            return;
        }
        if (refresh)
            this._stopTimer();

        this._checking = true;
        this._message = null;
        this._render();

        const generation = ++this._generation;
        try {
            const result = await this._updates.check({refresh, sources});
            if (generation !== this._generation)
                return;   // desativado no meio
            for (const source of ['system', 'flatpak']) {
                if (!sources[source])
                    continue;
                if (result[source] !== null)
                    this._state[source] = result[source];
                this._state.errors[source] = result.errors[source];
            }
            this._state.restartPending = result.restartPending;
            if (refresh)
                this._checkedAt = Date.now();
        } catch (e) {
            if (generation !== this._generation)
                return;
            this.log.warn(`busca de atualizações interrompida: ${e.message}`);
        }

        this._checking = false;
        const summary = summarize(this._state);
        if (summary !== this._summary) {
            this._summary = summary;
            this.log.info(`atualizações: ${summary}`);
        }
        this._render();
        if (refresh)
            this._schedule();

        const queued = this._queued;
        this._queued = null;
        if (queued)
            this._check(queued);
    }

    _openSoftware() {
        const _ = this.ctx.gettext;
        try {
            this._updates.openSoftware();
            this._indicator.menu.close();
        } catch (e) {
            this.log.warn(`não foi possível abrir o GNOME Software: ${e.message}`);
            this._message = {kind: 'error', text: _('Could not open GNOME Software: %s').replace('%s', e.message)};
            this._render();
        }
    }

    /**
     * O relógio do GLib para durante a suspensão; por isso o prazo é conferido
     * pela hora de verdade a cada meia hora, e uma máquina que dormiu a noite
     * busca logo que acorda, e não seis horas depois.
     *
     * @param {?number} [delayMs] fixo (a primeira busca); sem ele, conta da última
     */
    _schedule(delayMs = null) {
        this._stopTimer();
        if (!this._settings)
            return;
        const due = delayMs ?? nextCheckDelay(this._checkedAt,
            this._settings.get_uint('interval-hours'), Date.now(), FIRST_CHECK_MS);
        const wait = Math.min(due, WAKE_MS);
        this._timer = this.signals.addTimeout(wait, () => {
            this._timer = undefined;
            if (wait < due && delayMs === null)
                this._schedule();   // ainda não é hora: confere de novo
            else
                this._check({refresh: true});
            return false;   // GLib.SOURCE_REMOVE: a próxima é agendada pela busca
        }, {label: 'updates-check'});
    }

    _stopTimer() {
        if (this._timer === undefined)
            return;
        this.signals.removeSource(this._timer);
        this._timer = undefined;
    }
}
