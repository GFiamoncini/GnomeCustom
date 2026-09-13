// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * O cérebro do tiling: decide o que acontece com cada janela.
 *
 * Não fala com o Mutter. Tudo passa por um *adaptador* de sistema de janelas
 * (implementado por `services/shell/windows.js` no Shell, e por um dublê nos
 * testes), então o comportamento inteiro — eventos, flutuar, regras, arrastar,
 * redimensionar com o mouse, trocar de monitor — é testável fora do Shell.
 *
 * Adaptador esperado:
 *   describe(id)          → descrição da janela (ver `WindowDescription` abaixo) ou null
 *   list()                → ids das janelas gerenciáveis
 *   workArea(m, ws)       → área útil do monitor m na área de trabalho ws
 *   activeWorkspace()     → índice da área de trabalho ativa
 *   monitors()            → número de monitores
 *   monitorNeighbor(m, d) → índice do monitor vizinho na direção, ou -1
 *   monitorAt(x, y)       → índice do monitor sob o ponto
 *   frameRect(id)         → retângulo atual da janela
 *   moveResize(id, rect)  → põe a janela no retângulo (desmaximizando antes)
 *   activate(id)          → foca e traz para frente
 *   setAbove(id, above)   → "sempre no topo"
 *   focusedId()           → id da janela focada, ou null
 *   pointer()             → [x, y]
 *
 * O controlador pede renderização por `requestRender()`; quem o usa decide
 * quando rodar `render()` (no Shell, num idle, para agrupar rajadas).
 */

import {TilingTree} from './tree.js';
import {computeLayout} from './layout.js';
import {shouldFloat, toggleClassRule} from './rules.js';
import {
    snapRect, centerRect, floatRect, containsPoint, sameRect,
    grabEdges, edgeDeltas, nearestInDirection,
} from './geometry.js';

/**
 * @typedef {object} WindowDescription
 * @property {number} id
 * @property {?string} wmClass
 * @property {?string} title
 * @property {string} type 'normal' | 'dialog' | 'modal-dialog' | 'other'
 * @property {boolean} transient
 * @property {boolean} allowsResize
 * @property {boolean} minimized
 * @property {boolean} fullscreen
 * @property {boolean} maximized
 * @property {boolean} skipTaskbar
 * @property {number} monitor
 * @property {number} workspace índice, ou -1 para "em todas"
 */

/** Configuração padrão: o baseline do Forge do usuário. */
export const DEFAULT_TILING_CONFIG = Object.freeze({
    tilingMode: true,
    autoSplit: false,
    gapSize: 2,
    gapIncrement: 1,
    smartGaps: true,
    floatOnTop: true,
    focusBorder: true,
    rules: [],
    skipWorkspaces: [],
    resizeAmount: 15,
    dragSwap: true,
});

/** Chave da árvore para uma janela: monitor e área de trabalho ('*' = todas). */
export function keyFor(desc) {
    return `${desc.monitor}:${desc.workspace < 0 ? '*' : desc.workspace}`;
}

function parseKey(key) {
    const [monitor, workspace] = key.split(':');
    return {monitor: Number(monitor), workspace: workspace === '*' ? -1 : Number(workspace)};
}

/** Quantas janelas recentes guardar para desempatar a navegação. */
const RECENT_LIMIT = 32;

/** Limites do passo do gap, como no Forge. */
export const GAP_INCREMENT_MAX = 8;

export class TilingController {
    /**
     * @param {object} options
     * @param {object} options.windows adaptador do sistema de janelas
     * @param {object} [options.logger]
     * @param {Function} [options.requestRender] chamado quando é preciso renderizar
     * @param {Function} [options.onRequestSetting] (chave do esquema, valor final)
     *   — o controlador pede, quem o usa grava no GSettings e devolve a mudança
     *   por `setConfig`. O valor é sempre o definitivo, nunca "alternar" ou delta.
     */
    constructor({windows, logger = null, requestRender = () => {}, onRequestSetting = () => {}}) {
        this._win = windows;
        this._log = logger;
        this._requestRender = requestRender;
        this._requestSetting = onRequestSetting;

        this._config = {...DEFAULT_TILING_CONFIG};
        this._tree = new TilingTree();
        this._floating = new Set();      // flutuação manual: só em memória (sem wmId)
        this._raised = new Set();        // janelas em que *nós* ligamos "sempre no topo"
        this._recent = [];
        this._layouts = new Map();       // chave → último layout
        this._lastRects = new Map();     // id → último retângulo do layout
        this._requested = new Map();     // id → último retângulo pedido ao Mutter
        this._grab = null;
        this._running = false;
    }

    // ------------------------------------------------------------- estado

    get running() {
        return this._running;
    }

    get config() {
        return {...this._config};
    }

    /** @returns {TilingTree} para testes e depuração */
    get tree() {
        return this._tree;
    }

    /** @returns {boolean} a janela está na árvore */
    isTiled(id) {
        return this._tree.has(id);
    }

    /** @returns {number} espaçamento configurado, antes de "gaps ocultos" */
    get gap() {
        return this._config.gapSize * this._config.gapIncrement;
    }

    /** @returns {boolean} a janela foi posta para flutuar manualmente */
    isFloating(id) {
        return this._floating.has(id);
    }

    /** @returns {number} espaçamento efetivo da chave da janela (0 com janela única) */
    gapFor(id) {
        const key = this._tree.keyOf(id);
        return key ? this._layouts.get(key)?.gap ?? 0 : 0;
    }

    /**
     * Resumo legível do último layout, para o log de depuração:
     * `0:0 h[101 v[102 103]] | 101=4,36 794x860 …`.
     *
     * @returns {string}
     */
    describeLayout() {
        return [...this._layouts.entries()].map(([key, layout]) => {
            const rects = [...layout.windows.entries()]
                .map(([id, r]) => `${id}=${r.x},${r.y} ${r.width}x${r.height}`)
                .join(' ');
            return `${key} ${this._tree.describe(key)} | ${rects}`;
        }).join(' ; ');
    }

    /** @returns {?object} último retângulo que o layout deu para a janela */
    layoutRect(id) {
        return this._lastRects.get(id) ?? null;
    }

    // --------------------------------------------------------- ciclo de vida

    /** Adota as janelas que já existem e faz o primeiro layout. */
    start() {
        if (this._running)
            return;
        this._running = true;

        for (const id of this._orderedIds())
            this._sync(id, {anchor: 'end'});

        const focused = this._win.focusedId();
        if (focused !== null)
            this._touch(focused);

        this._log?.info(`tiling iniciado com ${this._tree.size} janela(s) na árvore`);
        this._requestRender();
    }

    /**
     * Solta tudo. As janelas ficam onde estão; só o "sempre no topo" que nós
     * ligamos é desfeito.
     */
    stop() {
        if (!this._running)
            return;
        this._running = false;

        for (const id of this._raised) {
            try {
                this._win.setAbove(id, false);
            } catch (e) {
                this._log?.debug(`janela ${id} já não existe ao desfazer "no topo": ${e.message}`);
            }
        }
        this._raised.clear();
        this._tree = new TilingTree();
        this._floating.clear();
        this._layouts.clear();
        this._lastRects.clear();
        this._requested.clear();
        this._recent = [];
        this._grab = null;
    }

    /**
     * Atualiza a configuração e reconcilia o que mudou.
     *
     * @param {object} partial
     */
    setConfig(partial) {
        const before = this._config;
        this._config = {...before, ...partial};
        if (!this._running)
            return;

        const membershipChanged = ['tilingMode', 'rules', 'skipWorkspaces']
            .some(key => key in partial && JSON.stringify(partial[key]) !== JSON.stringify(before[key]));

        if (membershipChanged) {
            if ('tilingMode' in partial && !partial.tilingMode && before.tilingMode)
                this._releaseAll();
            for (const id of this._orderedIds())
                this._sync(id, {anchor: 'end'});
        }
        this._requestRender();
    }

    // ------------------------------------------------------------- eventos

    windowAdded(id) {
        if (!this._running)
            return;
        this._sync(id, {anchor: 'focus'});
        this._requestRender();
    }

    windowRemoved(id) {
        this._floating.delete(id);
        this._raised.delete(id);
        this._lastRects.delete(id);
        this._requested.delete(id);
        this._recent = this._recent.filter(other => other !== id);
        if (this._grab?.id === id)
            this._grab = null;

        if (this._tree.remove(id))
            this._requestRender();
    }

    /**
     * @param {number} id
     * @param {string} what 'workspace' | 'monitor' | 'title' | 'class' |
     *   'minimized' | 'fullscreen' | 'maximized'
     */
    windowChanged(id, what) {
        if (!this._running)
            return;

        if (['workspace', 'monitor', 'title', 'class'].includes(what))
            this._sync(id, {anchor: 'end'});
        // O estado mudou por fora: o próximo layout precisa repor a janela mesmo
        // que o retângulo calculado seja o mesmo de antes.
        this._requested.delete(id);
        this._requestRender();
    }

    focusChanged(id) {
        if (id !== null && id !== undefined)
            this._touch(id);
    }

    workspaceSwitched() {
        if (this._running)
            this._requestRender();
    }

    monitorsChanged() {
        if (!this._running)
            return;
        for (const id of this._win.list())
            this._sync(id, {anchor: 'end'});
        this._requestRender();
    }

    workAreasChanged() {
        if (this._running)
            this._requestRender();
    }

    grabBegin(id, op) {
        if (!this._running || !this._tree.has(id))
            return;
        const kind = grabEdges(op);
        if (!kind.moving && !kind.resizing)
            return;
        this._grab = {id, op, before: this._lastRects.get(id) ?? this._win.frameRect(id)};
    }

    grabEnd(id, op) {
        const grab = this._grab;
        this._grab = null;
        // O usuário arrastou a janela: o pedido antigo não vale mais.
        this._requested.delete(id);
        if (!this._running || !grab || grab.id !== id || !this._tree.has(id))
            return;

        const kind = grabEdges(op);
        if (kind.resizing)
            this._finishResizeGrab(id, grab.before, kind.edges);
        else if (kind.moving && this._config.dragSwap)
            this._finishMoveGrab(id);

        this._requestRender();
    }

    // -------------------------------------------------------------- ações

    /**
     * Executa uma ação do catálogo (`actions.js`) sobre a janela focada.
     *
     * @param {object} action
     * @returns {boolean} true se algo mudou
     */
    run(action) {
        if (!this._running)
            return false;

        // Ligar/desligar o tiling e trocar a área de trabalho funcionam sem foco.
        switch (action.type) {
        case 'setting-toggle': {
            const current = action.setting === 'tiling-mode'
                ? this._config.tilingMode
                : this._config.focusBorder;
            this._requestSetting(action.setting, !current);
            return true;
        }
        case 'workspace-toggle':
            return this._toggleWorkspace();
        case 'gap': {
            const next = Math.min(GAP_INCREMENT_MAX,
                Math.max(0, this._config.gapIncrement + action.amount));
            if (next === this._config.gapIncrement)
                return false;
            this._requestSetting('gap-increment', next);
            return true;
        }
        case 'unsupported':
            this._log?.info(`ação sem efeito nesta versão: modo '${action.feature}'`);
            return false;
        }

        const id = this._win.focusedId();
        if (id === null || id === undefined || !this._win.describe(id))
            return false;

        switch (action.type) {
        case 'focus':
            return this._focusDirection(id, action.direction);
        case 'move':
            return this._moveDirection(id, action.direction);
        case 'swap':
            return this._swapDirection(id, action.direction);
        case 'swap-last':
            return this._swapLast(id);
        case 'split':
            return this._treeOp(this._tree.split(id, action.orientation));
        case 'layout-toggle':
            return this._treeOp(this._tree.toggleLayout(id));
        case 'float-toggle':
            return this._toggleFloat(id);
        case 'float-class-toggle':
            return this._toggleClassFloat(id);
        case 'resize':
            return this._resizeKeyboard(id, action.edge, action.sign);
        case 'snap':
            return this._snap(id, action.side, action.fraction);
        default:
            this._log?.warn(`ação desconhecida: '${action.type}'`);
            return false;
        }
    }

    // ------------------------------------------------------------- render

    /**
     * Calcula o layout das chaves visíveis e move o que estiver fora do lugar.
     *
     * Não reage a `size-changed`: um cliente Wayland com tamanho mínimo pode
     * recusar o retângulo, e insistir a cada mudança viraria um laço. O layout é
     * reaplicado só quando algo na árvore ou no ambiente muda.
     *
     * @returns {number} quantas janelas foram movidas
     */
    render() {
        if (!this._running)
            return 0;

        let moved = 0;
        const active = this._win.activeWorkspace();

        for (const key of this._tree.keys) {
            const {monitor, workspace} = parseKey(key);
            if (workspace >= 0 && workspace !== active)
                continue;
            if (monitor >= this._win.monitors())
                continue;
            if (this._isSkipped(workspace >= 0 ? workspace : active))
                continue;

            const area = this._win.workArea(monitor, workspace >= 0 ? workspace : active);
            const layout = computeLayout(this._tree, key, area, {
                gap: this.gap,
                smartGaps: this._config.smartGaps,
                isTiled: id => this._occupiesSpace(id),
            });
            this._layouts.set(key, layout);

            for (const [id, rect] of layout.windows) {
                this._lastRects.set(id, rect);
                if (this._grab?.id === id)
                    continue;
                if (sameRect(this._win.frameRect(id), rect))
                    continue;
                // No Wayland o retângulo real só muda quando o aplicativo confirma
                // o novo tamanho. Um segundo layout antes disso veria a janela
                // "fora do lugar" e pediria de novo — o que se viu no Shell. Se o
                // mesmo retângulo já foi pedido, espera.
                if (sameRect(this._requested.get(id), rect))
                    continue;
                this._win.moveResize(id, rect);
                this._requested.set(id, rect);
                moved++;
            }
        }
        return moved;
    }

    // ----------------------------------------------------------- internos

    /**
     * Decide se a janela deve estar na árvore, e onde, e corrige.
     *
     * @param {number} id
     * @param {object} options
     * @param {'focus'|'end'} options.anchor onde uma janela nova entra
     */
    _sync(id, {anchor}) {
        const desc = this._win.describe(id);
        if (!desc) {
            this._tree.remove(id);
            return;
        }

        if (!this._wantsTree(desc)) {
            this._tree.remove(id);
            return;
        }

        const key = keyFor(desc);
        if (this._tree.has(id)) {
            this._tree.moveToKey(id, key);
            return;
        }

        // Âncora: a janela usada por último *antes* desta. Quando uma janela
        // nova aparece, o foco em geral já passou para ela — usar o foco atual
        // mandaria toda janela nova para o fim.
        let after = null;
        if (anchor === 'focus') {
            const previous = this._recent.find(other => other !== id && this._tree.keyOf(other) === key);
            if (previous !== undefined) {
                after = previous;
                if (this._config.autoSplit) {
                    const frame = this._win.frameRect(previous);
                    this._tree.split(previous, frame.width >= frame.height ? 'h' : 'v');
                }
            }
        }
        this._tree.insert(id, key, {after});
    }

    /**
     * Por que uma janela está (ou não) no tiling, para o log e as preferências.
     *
     * @returns {string}
     */
    explain(id) {
        const desc = this._win.describe(id);
        if (!desc)
            return 'desconhecida';
        if (this._tree.has(id))
            return 'no tiling';
        if (!this._config.tilingMode)
            return 'tiling desligado';
        if (desc.skipTaskbar)
            return 'fora da barra de tarefas';
        if (this._floating.has(id))
            return 'flutuando por atalho';
        if (desc.workspace >= 0 && this._isSkipped(desc.workspace))
            return 'área de trabalho sem tiling';
        const reasons = [];
        if (desc.type !== 'normal')
            reasons.push(`tipo ${desc.type}`);
        if (desc.transient)
            reasons.push('transitória');
        if (!desc.wmClass)
            reasons.push('sem classe');
        if (!desc.title)
            reasons.push('sem título');
        if (!desc.allowsResize)
            reasons.push('tamanho fixo');
        if (reasons.length === 0)
            reasons.push('regra de janela');
        return `flutuando: ${reasons.join(', ')}`;
    }

    /** @returns {boolean} a janela deveria estar na árvore */
    _wantsTree(desc) {
        if (!this._config.tilingMode)
            return false;
        if (desc.skipTaskbar)
            return false;
        if (this._floating.has(desc.id))
            return false;
        if (desc.workspace >= 0 && this._isSkipped(desc.workspace))
            return false;
        return !shouldFloat(desc, this._config.rules);
    }

    /**
     * Janela na árvore mas que não deve ocupar espaço agora: minimizada ou em
     * tela cheia (vídeo, jogo).
     *
     * Maximizada **ocupa**: o layout a desmaximiza, como o Forge. Descoberto
     * rodando no Shell: o Mutter maximiza sozinho janelas que abrem quase do
     * tamanho da tela, e respeitar isso deixava essas janelas fora do tiling.
     * Para maximizar de propósito, flutua-se a janela primeiro.
     */
    _occupiesSpace(id) {
        const desc = this._win.describe(id);
        return Boolean(desc) && !desc.minimized && !desc.fullscreen;
    }

    _isSkipped(workspace) {
        return this._config.skipWorkspaces.includes(workspace);
    }

    _touch(id) {
        this._recent = [id, ...this._recent.filter(other => other !== id)].slice(0, RECENT_LIMIT);
    }

    _treeOp(changed) {
        if (changed)
            this._requestRender();
        return Boolean(changed);
    }

    _releaseAll() {
        for (const id of this._raised)
            this._win.setAbove(id, false);
        this._raised.clear();
        this._floating.clear();
    }

    _focusDirection(id, direction) {
        let target = null;

        if (this._tree.has(id)) {
            target = this._tree.neighbor(id, direction, {recent: this._recent});
            if (target === null)
                target = this._neighborMonitorWindow(id, direction);
        } else {
            // Janela flutuante: vai pela geometria, entre as janelas visíveis.
            const from = this._win.frameRect(id);
            const candidates = this._visibleIds()
                .filter(other => other !== id)
                .map(other => ({id: other, rect: this._win.frameRect(other)}));
            target = nearestInDirection(from, candidates, direction);
        }

        if (target === null)
            return false;
        this._win.activate(target);
        this._touch(target);
        return true;
    }

    /** Janela de chegada no monitor vizinho: a mais recente dali, ou a mais próxima. */
    _neighborMonitorWindow(id, direction) {
        const desc = this._win.describe(id);
        const neighbor = this._win.monitorNeighbor(desc.monitor, direction);
        if (neighbor < 0)
            return null;

        const there = this._visibleIds().filter(other => this._win.describe(other)?.monitor === neighbor);
        const recent = this._recent.find(other => there.includes(other));
        if (recent !== undefined)
            return recent;

        return nearestInDirection(this._win.frameRect(id),
            there.map(other => ({id: other, rect: this._win.frameRect(other)})), direction) ??
            there[0] ?? null;
    }

    _moveDirection(id, direction) {
        if (!this._tree.has(id))
            return false;

        const result = this._tree.move(id, direction);
        if (result.moved) {
            this._requestRender();
            return true;
        }
        if (!result.edge)
            return false;

        // Na borda: vai para o monitor vizinho, se houver.
        const desc = this._win.describe(id);
        const neighbor = this._win.monitorNeighbor(desc.monitor, direction);
        if (neighbor < 0)
            return false;

        this._tree.moveToKey(id, this._keyOnMonitor(neighbor));
        this._requestRender();
        return true;
    }

    /**
     * Chave de destino num monitor: a que já tem janelas ali (respeita o caso de
     * monitores secundários onde toda janela fica "em todas as áreas"), senão a
     * da área de trabalho ativa. O evento de troca de monitor corrige depois.
     */
    _keyOnMonitor(monitor) {
        const active = this._win.activeWorkspace();
        const candidates = [`${monitor}:${active}`, `${monitor}:*`];
        return candidates.find(key => this._tree.ids(key).length > 0) ?? candidates[0];
    }

    _swapDirection(id, direction) {
        if (!this._tree.has(id))
            return false;
        const target = this._tree.neighbor(id, direction, {recent: this._recent});
        if (target === null)
            return false;
        this._tree.swap(id, target);
        this._requestRender();
        return true;
    }

    _swapLast(id) {
        if (!this._tree.has(id))
            return false;
        const key = this._tree.keyOf(id);
        const previous = this._recent.find(other => other !== id && this._tree.keyOf(other) === key);
        if (previous === undefined)
            return false;
        this._tree.swap(id, previous);
        this._requestRender();
        return true;
    }

    _toggleFloat(id) {
        const desc = this._win.describe(id);

        if (this._floating.has(id)) {
            this._floating.delete(id);
            this._setRaised(id, false);
            this._sync(id, {anchor: 'focus'});
            this._requestRender();
            return true;
        }

        if (!this._tree.has(id)) {
            // Já flutuava por regra ou tipo: não há o que alternar por aqui.
            this._log?.info(`'${desc.wmClass}' flutua por regra; use "sempre flutuar" para mudar`);
            return false;
        }

        this._floating.add(id);
        this._tree.remove(id);
        this._win.moveResize(id, floatRect(this._win.workArea(desc.monitor, this._workspaceOf(desc))));
        this._setRaised(id, this._config.floatOnTop);
        this._requestRender();
        return true;
    }

    _toggleClassFloat(id) {
        const desc = this._win.describe(id);
        if (!desc.wmClass)
            return false;

        const {rules, floating} = toggleClassRule(this._config.rules, desc.wmClass);

        // Antes de pedir a gravação: ela volta por `setConfig` na mesma pilha e
        // já tira a janela da árvore, então o "estava no tiling?" tem de ser lido
        // agora.
        const wasTiled = this._tree.has(id);
        if (floating && wasTiled) {
            this._win.moveResize(id, floatRect(this._win.workArea(desc.monitor, this._workspaceOf(desc))));
            this._setRaised(id, this._config.floatOnTop);
        } else if (!floating) {
            this._setRaised(id, false);
        }

        this._requestSetting('window-rules', rules);
        return true;
    }

    _resizeKeyboard(id, edge, sign) {
        const key = this._tree.keyOf(id);
        if (!key)
            return false;
        const layout = this._layouts.get(key);
        const changed = this._tree.resize(id, edge, sign * this._config.resizeAmount,
            layout?.containers ?? new Map());
        return this._treeOp(changed);
    }

    _snap(id, side, fraction) {
        const desc = this._win.describe(id);
        const area = this._win.workArea(desc.monitor, this._workspaceOf(desc));

        // Como no Forge, um snap tira a janela do tiling — mas só esta janela,
        // e só em memória.
        if (this._tree.has(id)) {
            this._floating.add(id);
            this._tree.remove(id);
            this._requestRender();
        }

        const rect = side === 'center'
            ? centerRect(area, this._win.frameRect(id))
            : snapRect(area, side, fraction, this.gap);
        this._win.moveResize(id, rect);
        return true;
    }

    _toggleWorkspace() {
        const active = this._win.activeWorkspace();
        const skip = this._config.skipWorkspaces.includes(active)
            ? this._config.skipWorkspaces.filter(ws => ws !== active)
            : [...this._config.skipWorkspaces, active].sort((a, b) => a - b);
        this._requestSetting('skip-workspaces', skip);
        return true;
    }

    _finishResizeGrab(id, before, edges) {
        const key = this._tree.keyOf(id);
        const layout = this._layouts.get(key);
        if (!layout || !before)
            return;

        const deltas = edgeDeltas(before, this._win.frameRect(id), edges);
        for (const [edge, delta] of Object.entries(deltas))
            this._tree.resize(id, edge, delta, layout.containers);
    }

    _finishMoveGrab(id) {
        const [x, y] = this._win.pointer();

        let target = null;
        for (const [key, layout] of this._layouts) {
            if (!this._isVisibleKey(key))
                continue;
            for (const [other, rect] of layout.windows) {
                if (other !== id && this._tree.has(other) && containsPoint(rect, x, y)) {
                    target = other;
                    break;
                }
            }
            if (target !== null)
                break;
        }

        if (target !== null) {
            if (this._tree.keyOf(target) === this._tree.keyOf(id)) {
                this._tree.swap(id, target);
            } else {
                // Soltou sobre uma janela de outro monitor: vai para lá, ao lado dela.
                const key = this._tree.keyOf(target);
                this._tree.remove(id);
                this._tree.insert(id, key, {after: target});
            }
            return;
        }

        // Soltou em espaço vazio de outro monitor: entra no fim daquela árvore.
        const monitor = this._win.monitorAt(x, y);
        const desc = this._win.describe(id);
        if (monitor >= 0 && monitor !== desc.monitor)
            this._tree.moveToKey(id, this._keyOnMonitor(monitor));
    }

    /** Janelas em ordem visual: esquerda para a direita, depois de cima para baixo. */
    _orderedIds() {
        return this._win.list()
            .filter(id => this._win.describe(id))
            .sort((a, b) => {
                const ra = this._win.frameRect(a);
                const rb = this._win.frameRect(b);
                return ra.x - rb.x || ra.y - rb.y;
            });
    }

    _isVisibleKey(key) {
        const {workspace} = parseKey(key);
        return workspace < 0 || workspace === this._win.activeWorkspace();
    }

    _visibleIds() {
        const active = this._win.activeWorkspace();
        return this._win.list().filter(id => {
            const desc = this._win.describe(id);
            return desc && !desc.minimized && (desc.workspace < 0 || desc.workspace === active);
        });
    }

    _workspaceOf(desc) {
        return desc.workspace >= 0 ? desc.workspace : this._win.activeWorkspace();
    }

    _setRaised(id, above) {
        if (above) {
            this._win.setAbove(id, true);
            this._raised.add(id);
        } else if (this._raised.has(id)) {
            this._win.setAbove(id, false);
            this._raised.delete(id);
        }
    }
}
