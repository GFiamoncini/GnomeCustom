// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Botão de processador e memória e o cartão do sistema, no desenho do WinDock.
 *
 * Na barra, dois ícones apertados com a porcentagem ao lado. No cartão:
 * processador, memória e rede, cada um com o número de agora e o gráfico das
 * últimas leituras. A rede só aparece no cartão — dois números de velocidade
 * mudando o tempo todo ocupariam mais barra que qualquer outro item, para uma
 * informação que só se olha quando se está procurando por ela.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatBytes, formatPercent, formatRate, severity, sparklinePoints} from '../../lib/sysmon.js';

const SEVERITIES = ['calm', 'warning', 'critical'];

function iconFile(name, moduleUrl = import.meta.url) {
    const path = decodeURIComponent(moduleUrl.replace(/^file:\/\//, ''));
    return Gio.File.new_for_path(path.replace(/\/ui\/sysmon\/indicator\.js$/, `/assets/icons/${name}.svg`));
}

/**
 * As cores dos gráficos do WinDock (PanelWindow.xaml): laranja no processador,
 * lilás na memória, verde no que chega e azul no que sai. As mesmas estão na
 * folha de estilo, nos ícones das seções.
 */
const SERIES_COLORS = {
    cpu: [0xf4 / 255, 0xa2 / 255, 0x61 / 255],
    memory: [0xb0 / 255, 0x8a / 255, 0xe8 / 255],
    down: [0x7f / 255, 0xd1 / 255, 0x8b / 255],
    up: [0x7f / 255, 0xb2 / 255, 0xf0 / 255],
};

export class SysmonIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {Function} options.gettext
     * @param {Function} options.onMonitor abrir o Monitor do sistema
     */
    constructor({gettext, onMonitor}) {
        super(0.5, 'GnomeCustom System Monitor', false);

        this._ = gettext;
        this._callbacks = {onMonitor};
        this._icons = {
            cpu: new Gio.FileIcon({file: iconFile('sysmon-cpu-symbolic')}),
            memory: new Gio.FileIcon({file: iconFile('sysmon-memory-symbolic')}),
        };
        // Translators: decimal separator used in "7.4 GiB"
        this._decimal = gettext('.');
        this._graphs = [];

        const box = new St.BoxLayout({style_class: 'gnomecustom-sysmon-panel'});
        this._panelCpu = this._panelItem(box, this._icons.cpu, 'cpu');
        this._panelMemory = this._panelItem(box, this._icons.memory, 'memory');
        this.add_child(box);

        this._buildCard();
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._repaint();
        });
    }

    /**
     * @param {object} state
     * @param {?number} state.cpu de 0 a 100
     * @param {?object} state.memory de `parseMeminfo`
     * @param {?{down: number, up: number}} state.net bytes por segundo
     * @param {number} state.cores
     * @param {{cpu: number[], memory: number[], down: number[], up: number[]}} state.history
     */
    update({cpu, memory, net, cores, history}) {
        const _ = this._;
        this._history = history;

        this._setPanel(this._panelCpu, cpu);
        this._setPanel(this._panelMemory, memory?.percent ?? null);
        this.accessible_name = _('Processor %s, memory %s')
            .replace('%s', formatPercent(cpu)).replace('%s', formatPercent(memory?.percent ?? null));

        if (!this.menu.isOpen)
            return;   // o cartão fechado não precisa de texto nem de desenho

        this._cpuValue.text = formatPercent(cpu);
        this._cpuDetail.text = _('%d logical processors').replace('%d', String(cores));

        this._memoryValue.text = formatPercent(memory?.percent ?? null);
        this._memoryDetail.text = memory ? this._memoryText(memory) : '';

        this._netValue.text = net
            ? `↓ ${formatRate(net.down, this._decimal)}   ↑ ${formatRate(net.up, this._decimal)}`
            : '–';
        this._repaint();
    }

    _memoryText(memory) {
        const _ = this._;
        const used = _('%s of %s').replace('%s', formatBytes(memory.used, this._decimal))
            .replace('%s', formatBytes(memory.total, this._decimal));
        if (!memory.swapTotal)
            return used;
        return `${used}  ·  ${_('swap %s').replace('%s', formatBytes(memory.swapUsed, this._decimal))}`;
    }

    _panelItem(box, gicon, series) {
        const item = new St.BoxLayout({style_class: 'gnomecustom-sysmon-panel-item'});
        item.add_child(new St.Icon({
            gicon,
            style_class: `system-status-icon gnomecustom-sysmon-panel-icon ${series}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            style_class: 'gnomecustom-sysmon-panel-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(label);
        box.add_child(item);
        return {item, label};
    }

    _setPanel({item, label}, percent) {
        label.text = formatPercent(percent);
        const level = severity(percent);
        for (const name of SEVERITIES) {
            if (name === level)
                item.add_style_class_name(name);
            else
                item.remove_style_class_name(name);
        }
    }

    _buildCard() {
        const _ = this._;
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'gnomecustom-sysmon-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomecustom-sysmon-card',
        });

        const header = new St.BoxLayout({style_class: 'gnomecustom-sysmon-header'});
        header.add_child(new St.Label({
            text: _('System'),
            style_class: 'gnomecustom-sysmon-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const monitor = new St.Button({
            label: _('System Monitor'),
            style_class: 'gnomecustom-sysmon-link',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        monitor.connect('clicked', () => {
            this.menu.close();
            this._callbacks.onMonitor?.();
        });
        header.add_child(monitor);
        card.add_child(header);

        const cpu = this._section(card, _('Processor'), this._icons.cpu,
            [{key: 'cpu', max: 100}], {tone: 'cpu'});
        this._cpuValue = cpu.value;
        this._cpuDetail = cpu.detail;

        const memory = this._section(card, _('Memory'), this._icons.memory,
            [{key: 'memory', max: 100}], {tone: 'memory'});
        this._memoryValue = memory.value;
        this._memoryDetail = memory.detail;

        // Recebido cheio e enviado só em linha, na mesma escala: é a comparação
        // entre os dois que interessa.
        const net = this._section(card, _('Network'), 'network-transmit-receive-symbolic',
            [{key: 'down'}, {key: 'up', fill: false}], {shared: true, tone: 'down'});
        this._netValue = net.value;
        net.detail.visible = false;

        item.add_child(card);
        this.menu.addMenuItem(item);
    }

    _section(card, title, icon, series, {shared = false, tone} = {}) {
        const section = new St.BoxLayout({vertical: true, style_class: 'gnomecustom-sysmon-section'});

        const head = new St.BoxLayout({style_class: 'gnomecustom-sysmon-section-head'});
        head.add_child(new St.Icon({
            ...typeof icon === 'string' ? {icon_name: icon} : {gicon: icon},
            style_class: `gnomecustom-sysmon-section-icon ${tone}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        head.add_child(new St.Label({
            text: title,
            style_class: 'gnomecustom-sysmon-section-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const value = new St.Label({
            style_class: 'gnomecustom-sysmon-section-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        head.add_child(value);
        section.add_child(head);

        const detail = new St.Label({style_class: 'gnomecustom-sysmon-section-detail'});
        section.add_child(detail);

        const graph = new St.DrawingArea({style_class: 'gnomecustom-sysmon-graph', x_expand: true});
        graph.connect('repaint', area => this._draw(area, series, shared));
        section.add_child(graph);
        this._graphs.push(graph);

        card.add_child(section);
        return {value, detail};
    }

    _repaint() {
        for (const graph of this._graphs)
            graph.queue_repaint();
    }

    _draw(area, series, shared) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const color = area.get_theme_node().get_foreground_color();
        const base = [color.red / 255, color.green / 255, color.blue / 255];
        const history = this._history ?? {};

        // Linha de base, para o gráfico vazio não parecer um buraco.
        cr.setSourceRGBA(...base, 0.15);
        cr.setLineWidth(1);
        cr.moveTo(0, height - 0.5);
        cr.lineTo(width, height - 0.5);
        cr.stroke();

        const top = shared
            ? Math.max(1, ...series.flatMap(({key}) => history[key] ?? []))
            : null;

        for (const {key, max = top, fill = true} of series) {
            const points = sparklinePoints(history[key] ?? [], width, height - 2, {max});
            if (points.length < 2)
                continue;
            const rgb = SERIES_COLORS[key] ?? base;

            if (fill) {
                cr.moveTo(points[0][0], height);
                for (const [x, y] of points)
                    cr.lineTo(x, y + 1);
                cr.lineTo(points.at(-1)[0], height);
                cr.closePath();
                cr.setSourceRGBA(...rgb, 0.18);
                cr.fill();
            }

            cr.moveTo(points[0][0], points[0][1] + 1);
            for (const [x, y] of points.slice(1))
                cr.lineTo(x, y + 1);
            cr.setSourceRGBA(...rgb, 0.95);
            cr.setLineWidth(1.5);
            cr.stroke();
        }
        cr.$dispose();
    }

    destroy() {
        this._callbacks = {};
        this._history = null;
        super.destroy();
    }
}
