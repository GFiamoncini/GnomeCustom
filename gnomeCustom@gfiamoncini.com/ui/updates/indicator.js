// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de atualizações pendentes e o card, no desenho do WinDock.
 *
 * Na barra, o ícone e quantas são. No card: o título com a hora da última
 * busca, uma seção para o sistema e outra para o Flatpak (um programa por linha,
 * com a versão nova à direita), o aviso de reinício quando o Software já baixou
 * tudo, o recado de erro e, no fim, **Verificar agora** e **Atualizar**.
 *
 * As ações são palavras, como no card dos dispositivos externos.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {countPending, panelCount, visibleItems} from '../../lib/updates.js';

const ICON = 'software-update-available-symbolic';

export class UpdatesIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onCheck buscar agora, indo à rede
     * @param {Function} options.onUpdate abrir o GNOME Software
     * @param {Function} options.onClosed o card fechou
     */
    constructor({gettext, onCheck, onUpdate, onClosed}) {
        super(0.5, 'GnomeCustom Updates', false);

        this._ = gettext;
        this._callbacks = {onCheck, onUpdate, onClosed};

        const box = new St.BoxLayout({style_class: 'gnomecustom-updates-panel'});
        box.add_child(new St.Icon({
            icon_name: ICON,
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._count = new St.Label({
            style_class: 'gnomecustom-updates-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._count);
        this.add_child(box);

        this._buildCard();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._callbacks.onClosed?.();
        });
    }

    /**
     * @param {object} state
     * @param {object[]} state.system `Package` de lib/updates.js
     * @param {object[]} state.flatpak `FlatpakRef` de lib/updates.js
     * @param {boolean} state.restartPending o Software já baixou e espera o reinício
     * @param {object} view
     * @param {boolean} view.checking
     * @param {?number} view.checkedAt ms da última busca na rede
     * @param {?{kind: string, text: string}} view.message
     */
    update(state, {checking = false, checkedAt = null, message = null} = {}) {
        const _ = this._;
        const total = countPending(state);

        this._count.text = panelCount(total);
        this._count.visible = total > 0;
        this.accessible_name = total > 0
            ? _('Updates available: %d').replace('%d', total)
            : _('Updates');

        this._when.text = checking ? _('Checking…') : this._checkedText(checkedAt);

        this._list.destroy_all_children();
        if (total === 0) {
            this._list.add_child(this._label(checking ? _('Looking for updates…') : _('Everything is up to date.'),
                'gnomecustom-updates-empty'));
        }
        this._addSection(_('System'), state.system, pkg => pkg.version, pkg => pkg.security);
        this._addSection(_('Flatpak'), state.flatpak, ref => ref.version, () => false);

        this._restart.visible = Boolean(state.restartPending);

        this._message.visible = Boolean(message);
        this._message.text = message?.text ?? '';
        for (const kind of ['ok', 'error'])
            this._message.remove_style_class_name(kind);
        if (message?.kind)
            this._message.add_style_class_name(message.kind);

        this._setSensitive(this._checkButton, !checking);
        this._updateButton.visible = total > 0;
    }

    _checkedText(checkedAt) {
        if (!checkedAt)
            return '';
        const time = GLib.DateTime.new_from_unix_local(Math.floor(checkedAt / 1000)).format('%H:%M');
        return this._('Checked at %s').replace('%s', time);
    }

    _buildCard() {
        const _ = this._;
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-updates-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-updates-card',
        });

        const header = new St.BoxLayout({style_class: 'gnomecustom-updates-header'});
        header.add_child(new St.Icon({
            icon_name: ICON,
            style_class: 'gnomecustom-updates-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: _('Updates'),
            style_class: 'gnomecustom-updates-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._when = new St.Label({
            style_class: 'gnomecustom-updates-when',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._when);
        card.add_child(header);

        this._list = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-updates-list'});
        card.add_child(this._list);

        this._restart = this._wrapped(_('Updates downloaded: restart the computer to install them.'),
            'gnomecustom-updates-restart');
        card.add_child(this._restart);

        this._message = this._wrapped('', 'gnomecustom-updates-message');
        card.add_child(this._message);

        const actions = new St.BoxLayout({style_class: 'gnomecustom-updates-actions', x_align: Clutter.ActorAlign.END});
        this._checkButton = this._action(_('Check now'), _('Look for new updates now'),
            () => this._callbacks.onCheck?.());
        this._updateButton = this._action(_('Update'), _('Open GNOME Software to install the updates'),
            () => this._callbacks.onUpdate?.());
        this._updateButton.add_style_class_name('primary');
        actions.add_child(this._checkButton);
        actions.add_child(this._updateButton);
        card.add_child(actions);

        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    /**
     * @param {string} title
     * @param {object[]} items
     * @param {Function} detailOf item => texto da direita
     * @param {Function} isSecurity item => destacar
     */
    _addSection(title, items, detailOf, isSecurity) {
        if (!items?.length)
            return;
        const _ = this._;

        const header = new St.BoxLayout({style_class: 'gnomecustom-updates-section'});
        header.add_child(this._label(title, 'gnomecustom-updates-section-title', {x_expand: true}));
        // A legenda do âmbar das linhas: sem ela, a cor não diz nada.
        const security = items.filter(isSecurity).length;
        if (security > 0) {
            header.add_child(this._label(_('%d security').replace('%d', security),
                'gnomecustom-updates-section-security'));
        }
        header.add_child(this._label(String(items.length), 'gnomecustom-updates-section-count'));
        this._list.add_child(header);

        const {shown, hidden} = visibleItems(items);
        for (const item of shown) {
            const row = new St.BoxLayout({style_class: 'gnomecustom-updates-row'});
            const name = this._label(item.name, 'gnomecustom-updates-name', {x_expand: true});
            if (isSecurity(item))
                name.add_style_class_name('security');
            row.add_child(name);
            const detail = detailOf(item);
            if (detail)
                row.add_child(this._label(detail, 'gnomecustom-updates-detail'));
            this._list.add_child(row);
        }
        if (hidden > 0)
            this._list.add_child(this._label(_('and %d more').replace('%d', hidden), 'gnomecustom-updates-more'));
    }

    _action(text, accessibleName, onClick) {
        const button = new St.Button({
            label: text,
            style_class: 'gnomecustom-updates-action',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
        });
        button.connect('clicked', onClick);
        return button;
    }

    /** Classe própria, e não `insensitive`: veja o card dos dispositivos externos. */
    _setSensitive(button, sensitive) {
        button.reactive = sensitive;
        if (sensitive)
            button.remove_style_class_name('disabled');
        else
            button.add_style_class_name('disabled');
    }

    _wrapped(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass});
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        label.visible = false;
        return label;
    }

    _label(text, styleClass, props = {}) {
        const label = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    destroy() {
        this._callbacks = {};
        super.destroy();
    }
}
