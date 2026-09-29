// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de cota de IA da barra superior e o card.
 *
 * Na barra: o robô e, opcionalmente, a janela de 5 horas colorida pela faixa.
 * No card, no desenho do `AiUsageCard` do WinDock: uma conta por bloco,
 * separados por uma linha — robô, nome e a cápsula do plano; depois uma barra
 * por janela de cota. Dois modos, alternados pela seta do rodapé:
 *
 * - compacto: cada janela numa linha só, com a barra entre o nome e a
 *   porcentagem — cabe com várias contas;
 * - detalhado: a linha da conta (e-mail, organização) e, em cada janela, a
 *   barra larga com o "zera em" embaixo.
 *
 * Números que sobreviveram a uma leitura que falhou ficam, com um aviso em
 * âmbar dizendo de quando são: sem a hora, o card mentiria com cara de novo.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    State, WINDOW_NAMES, describeAccount, describeReset, formatClock, formatPercent,
    panelPercent, planLabel, severity,
} from '../../lib/ai-usage.js';

/** Larguras das barras, em px lógicos; o card tem largura fixa (stylesheet). */
const COMPACT_BAR = 132;
const DETAILED_BAR = 300;

const SEVERITIES = ['calm', 'warning', 'critical'];

function iconFile(moduleUrl = import.meta.url) {
    const path = decodeURIComponent(moduleUrl.replace(/^file:\/\//, ''));
    return Gio.File.new_for_path(path.replace(/\/ui\/aiusage\/indicator\.js$/,
        '/assets/icons/ai-usage-symbolic.svg'));
}

const sub = (text, ...args) => args.reduce((out, arg) => out.replace('%s', arg), text);

export class AiUsageIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onOpen o card abriu (o serviço decide se pergunta de novo)
     * @param {Function} options.onRefresh atualizar agora
     * @param {Function} options.onToggleExpanded seta do rodapé
     * @param {Function} options.onSettings abrir as preferências
     */
    constructor({gettext, onOpen, onRefresh, onToggleExpanded, onSettings}) {
        super(0.5, 'GnomeCustom AI Usage', false);

        this._ = gettext;
        this._callbacks = {onOpen, onRefresh, onToggleExpanded, onSettings};
        this._gicon = new Gio.FileIcon({file: iconFile()});

        const box = new St.BoxLayout({style_class: 'gnomecustom-aiusage-panel'});
        box.add_child(new St.Icon({
            gicon: this._gicon,
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._panelLabel = new St.Label({
            text: '',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnomecustom-aiusage-panel-value',
        });
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._buildCard();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._callbacks.onOpen?.();
        });
    }

    /**
     * @param {object[]} accounts leituras do serviço (`AccountUsage`)
     * @param {object} options
     * @param {?number} options.readAt ms da última leitura bem-sucedida
     * @param {boolean} options.expanded
     * @param {boolean} options.showPercent
     */
    show(accounts, {readAt, expanded, showPercent}) {
        const _ = this._;

        const percent = panelPercent(accounts);
        this._panelLabel.visible = showPercent && percent !== null;
        this._panelLabel.text = percent === null ? '' : formatPercent(percent);
        this._setSeverity(this._panelLabel, percent);

        this._accounts.destroy_all_children();
        if (accounts.length === 0) {
            this._accounts.add_child(this._message(
                _('No Claude Code account was found on this computer. Sign in to Claude Code and the card fills itself.')));
        }
        accounts.forEach((account, index) =>
            this._accounts.add_child(this._accountBlock(account, index === 0, expanded)));

        this._updated.text = readAt ? sub(_('Updated at %s'), formatClock(readAt)) : '';
        this._expandIcon.icon_name = expanded ? 'pan-up-symbolic' : 'pan-down-symbolic';
        this._expandButton.accessible_name = expanded ? _('Show only the essentials') : _('Show the details');
    }

    _buildCard() {
        const _ = this._;
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-aiusage-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-aiusage-card',
        });

        this._accounts = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-aiusage-accounts'});

        // Rodapé: a hora da leitura à esquerda; atualizar, configurações e a seta à direita.
        const footer = new St.BoxLayout({style_class: 'gnomecustom-aiusage-footer'});
        this._updated = new St.Label({
            style_class: 'gnomecustom-aiusage-updated',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(this._updated);
        footer.add_child(this._iconButton('view-refresh-symbolic', _('Update now'),
            () => this._callbacks.onRefresh?.()));
        footer.add_child(this._iconButton('emblem-system-symbolic', _('AI usage settings'), () => {
            this.menu.close();
            this._callbacks.onSettings?.();
        }));
        this._expandIcon = new St.Icon({icon_name: 'pan-down-symbolic', icon_size: 14});
        this._expandButton = this._iconButton(null, _('Show the details'),
            () => this._callbacks.onToggleExpanded?.(), this._expandIcon);
        footer.add_child(this._expandButton);

        card.add_child(this._accounts);
        card.add_child(footer);
        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    _accountBlock(account, first, expanded) {
        const _ = this._;
        const block = new St.BoxLayout({
            vertical: true,
            style_class: first ? 'gnomecustom-aiusage-account first' : 'gnomecustom-aiusage-account',
        });
        const {title, line} = describeAccount(account.profile);

        // Cabeçalho: robô, nome e a cápsula do plano.
        const header = new St.BoxLayout({style_class: 'gnomecustom-aiusage-header'});
        header.add_child(new St.Icon({
            gicon: this._gicon,
            style_class: 'gnomecustom-aiusage-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const name = new St.Label({
            text: title,
            style_class: 'gnomecustom-aiusage-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(name);
        const plan = planLabel(account.plan);
        if (plan) {
            header.add_child(new St.Label({
                text: plan,
                style_class: 'gnomecustom-aiusage-plan',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        block.add_child(header);

        if (expanded && line) {
            const detail = new St.Label({text: line, style_class: 'gnomecustom-aiusage-line'});
            detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            block.add_child(detail);
        }

        // Sem medidor não há barra: fica o motivo, em uma linha.
        if (account.gauges.length === 0) {
            block.add_child(this._message(this._stateMessage(account), expanded ? '' : 'indented'));
            return block;
        }

        const gauges = new St.BoxLayout({
            vertical: true,
            style_class: expanded ? 'gnomecustom-aiusage-gauges' : 'gnomecustom-aiusage-gauges indented',
        });
        for (const gauge of account.gauges)
            gauges.add_child(expanded ? this._detailedGauge(gauge) : this._compactGauge(gauge));
        block.add_child(gauges);

        if (account.since) {
            block.add_child(new St.Label({
                text: sub(_('Not updated since %s'), formatClock(account.since)),
                style_class: expanded ? 'gnomecustom-aiusage-stale' : 'gnomecustom-aiusage-stale indented',
            }));
        }
        return block;
    }

    _compactGauge(gauge) {
        const row = new St.BoxLayout({style_class: 'gnomecustom-aiusage-row'});
        const name = new St.Label({
            text: this._gaugeName(gauge),
            style_class: 'gnomecustom-aiusage-gauge-name compact',
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(name);
        row.add_child(this._bar(gauge.percent, COMPACT_BAR));
        row.add_child(this._percentLabel(gauge.percent, 'compact'));
        return row;
    }

    _detailedGauge(gauge) {
        const box = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-aiusage-detail'});

        const top = new St.BoxLayout();
        const name = new St.Label({
            text: this._gaugeName(gauge),
            style_class: 'gnomecustom-aiusage-gauge-name',
            x_expand: true,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        top.add_child(name);
        top.add_child(this._percentLabel(gauge.percent));
        box.add_child(top);

        box.add_child(this._bar(gauge.percent, DETAILED_BAR));

        const reset = describeReset(gauge.resetsAt, Date.now());
        if (reset) {
            box.add_child(new St.Label({
                text: sub(this._(reset.message), ...reset.args),
                style_class: 'gnomecustom-aiusage-reset',
            }));
        }
        return box;
    }

    /** Trilho por baixo, preenchimento por cima, com a largura da porcentagem. */
    _bar(percent, width) {
        // BoxLayout, e não St.Bin: o Bin centraliza o filho e o preenchimento
        // ficava no meio do trilho.
        const track = new St.BoxLayout({
            style_class: 'gnomecustom-aiusage-track',
            style: `width: ${width}px;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const fill = new St.Widget({
            style_class: 'gnomecustom-aiusage-fill',
            style: `width: ${Math.round(width * percent / 100)}px;`,
            visible: percent > 0,
        });
        this._setSeverity(fill, percent);
        track.add_child(fill);
        return track;
    }

    _percentLabel(percent, extraClass = '') {
        const label = new St.Label({
            text: formatPercent(percent),
            style_class: `gnomecustom-aiusage-percent ${extraClass}`.trim(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._setSeverity(label, percent);
        return label;
    }

    _setSeverity(actor, percent) {
        for (const level of SEVERITIES)
            actor.remove_style_class_name(level);
        if (percent !== null && percent !== undefined)
            actor.add_style_class_name(severity(percent));
    }

    _gaugeName(gauge) {
        const _ = this._;
        if (gauge.window === 'session')
            return _(WINDOW_NAMES.session);
        if (gauge.window === 'weekly')
            return gauge.model ? `${_(WINDOW_NAMES.weekly)} · ${gauge.model}` : _(WINDOW_NAMES.weekly);
        return gauge.model ?? gauge.name;
    }

    _stateMessage(account) {
        const _ = this._;
        switch (account.state) {
        case State.UNKNOWN:
            return _('Checking…');
        case State.NO_CREDENTIALS:
            return _('No credentials in this folder.');
        case State.EXPIRED:
            return _('Session expired — use Claude Code once to renew it.');
        }

        const error = account.error ?? {};
        switch (error.kind) {
        case 'rate-limited':
            return sub(_('Too many requests — trying again at %s.'), formatClock(error.until));
        case 'credentials':
            return _('Could not read the credentials.');
        case 'network':
            return _('Could not reach the API.');
        case 'http':
            return sub(_('The API answered %s.'), String(error.status));
        case 'empty':
            return _('The answer had no usage data.');
        default:
            return _('Could not read the usage now.');
        }
    }

    _message(text, extraClass = '') {
        const label = new St.Label({
            text,
            style_class: `gnomecustom-aiusage-message ${extraClass}`.trim(),
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        return label;
    }

    _iconButton(iconName, accessibleName, onClick, icon = null) {
        const button = new St.Button({
            style_class: 'gnomecustom-aiusage-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
            child: icon ?? new St.Icon({icon_name: iconName, icon_size: 14}),
        });
        button.connect('clicked', onClick);
        return button;
    }

    destroy() {
        this._callbacks = {};
        super.destroy();
    }
}
