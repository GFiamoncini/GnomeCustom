// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Árvore de tiling: onde cada janela está, sem saber o que é uma janela.
 *
 * Folhas guardam só um id numérico; contêineres dividem o espaço na horizontal
 * ('h', lado a lado) ou na vertical ('v', um sobre o outro). Existe uma raiz por
 * *chave* — um par monitor/área de trabalho, montado pelo módulo — e a raiz nunca
 * é removida, mesmo vazia.
 *
 * A navegação segue o modelo do i3, que é o mesmo que o Forge adapta
 * (`lib/extension/tree.js`, "borrowed logic from tree.c of i3"): subir até o
 * primeiro contêiner cuja orientação combina com a direção pedida e que tenha um
 * vizinho daquele lado. O código aqui é próprio, e tudo é puro — sem Meta, sem
 * GObject —, para ser testado por inteiro fora do Shell.
 *
 * Direções: 'left', 'right', 'up', 'down'.
 */

/** Menor fatia que um filho pode ocupar do seu contêiner, ao redimensionar. */
export const MIN_FRACTION = 0.1;

const AXIS = Object.freeze({left: 'h', right: 'h', up: 'v', down: 'v'});
const FORWARD = Object.freeze({left: false, right: true, up: false, down: true});

/** @returns {'h'|'v'} eixo da direção */
export function axisOf(direction) {
    const axis = AXIS[direction];
    if (!axis)
        throw new Error(`direção inválida: '${direction}'`);
    return axis;
}

/** @returns {boolean} a direção aponta para o fim do contêiner (direita/baixo) */
export function isForward(direction) {
    axisOf(direction);
    return FORWARD[direction];
}

function makeSplit(layout, parent = null) {
    return {kind: 'split', layout, children: [], parent, weight: 1};
}

function makeLeaf(id, parent) {
    return {kind: 'leaf', id, parent, weight: 1};
}

export class TilingTree {
    constructor() {
        /** @type {Map<string, object>} chave → raiz */
        this._roots = new Map();
        /** @type {Map<number, object>} id → folha */
        this._leaves = new Map();
        /** @type {Map<object, string>} raiz → chave */
        this._keyOfRoot = new Map();
    }

    // ------------------------------------------------------------ consulta

    /** @returns {string[]} chaves com raiz criada */
    get keys() {
        return [...this._roots.keys()];
    }

    /** @returns {number} total de janelas na árvore */
    get size() {
        return this._leaves.size;
    }

    has(id) {
        return this._leaves.has(id);
    }

    /**
     * @param {string} key
     * @param {object} [options]
     * @param {boolean} [options.create] cria a raiz se não existir
     * @param {'h'|'v'} [options.layout] orientação de uma raiz nova
     * @returns {?object}
     */
    root(key, {create = true, layout = 'h'} = {}) {
        let root = this._roots.get(key);
        if (!root && create) {
            root = makeSplit(layout);
            this._roots.set(key, root);
            this._keyOfRoot.set(root, key);
        }
        return root ?? null;
    }

    /** @returns {?string} chave onde a janela está */
    keyOf(id) {
        const leaf = this._leaves.get(id);
        if (!leaf)
            return null;
        return this._keyOfRoot.get(this._rootOf(leaf)) ?? null;
    }

    /**
     * @param {string} key
     * @returns {number[]} janelas da chave, na ordem visual (profundidade primeiro)
     */
    ids(key) {
        const root = this._roots.get(key);
        return root ? leavesOf(root).map(leaf => leaf.id) : [];
    }

    /** @returns {?object} a folha (para layout e testes) */
    leaf(id) {
        return this._leaves.get(id) ?? null;
    }

    /**
     * Representação compacta, para testes e depuração: `h[1 v[2 3]]`.
     *
     * @param {string} key
     * @returns {string}
     */
    describe(key) {
        const root = this._roots.get(key);
        return root ? describeNode(root) : '';
    }

    // ------------------------------------------------------------ inserção

    /**
     * Insere uma janela.
     *
     * Com `after`, a janela nova entra logo depois dela, **dentro do mesmo
     * contêiner** — é o que faz um `split` seguido de janela nova abrir na
     * divisão pedida. Sem `after` (ou com `after` em outra chave), entra no fim
     * da raiz.
     *
     * @param {number} id
     * @param {string} key
     * @param {object} [options]
     * @param {?number} [options.after] id da janela de referência (a focada)
     * @returns {boolean} false se o id já estava na árvore
     */
    insert(id, key, {after = null} = {}) {
        if (this._leaves.has(id))
            return false;

        const root = this.root(key);
        const anchor = after !== null ? this._leaves.get(after) : null;

        let parent = root;
        let index = root.children.length;
        if (anchor && this._rootOf(anchor) === root) {
            parent = anchor.parent;
            index = parent.children.indexOf(anchor) + 1;
        }

        const leaf = makeLeaf(id, parent);
        parent.children.splice(index, 0, leaf);
        this._leaves.set(id, leaf);
        equalize(parent);
        return true;
    }

    /**
     * Remove uma janela e desfaz contêineres que ficaram sem sentido.
     *
     * @param {number} id
     * @returns {boolean}
     */
    remove(id) {
        const leaf = this._leaves.get(id);
        if (!leaf)
            return false;

        this._detach(leaf);
        this._leaves.delete(id);
        return true;
    }

    /**
     * Leva uma janela para outra chave (outro monitor ou área de trabalho).
     *
     * @param {number} id
     * @param {string} key
     * @returns {boolean} true se mudou de lugar
     */
    moveToKey(id, key) {
        const leaf = this._leaves.get(id);
        if (!leaf || this.keyOf(id) === key)
            return false;

        this._detach(leaf);
        const root = this.root(key);
        leaf.parent = root;
        leaf.weight = 1;
        root.children.push(leaf);
        equalize(root);
        return true;
    }

    // ------------------------------------------------------ estrutura/foco

    /**
     * Divide na orientação pedida, no estilo do i3.
     *
     * Se a janela é a única do seu contêiner, só a orientação do contêiner muda.
     * Senão, ela desce para um contêiner novo com aquela orientação — e a
     * próxima janela aberta ao lado dela entra ali.
     *
     * @param {number} id
     * @param {'h'|'v'} orientation
     * @returns {boolean}
     */
    split(id, orientation) {
        const leaf = this._leaves.get(id);
        if (!leaf || (orientation !== 'h' && orientation !== 'v'))
            return false;

        const parent = leaf.parent;
        if (parent.children.length === 1) {
            parent.layout = orientation;
            return true;
        }

        const container = makeSplit(orientation, parent);
        container.weight = leaf.weight;
        parent.children[parent.children.indexOf(leaf)] = container;
        leaf.parent = container;
        leaf.weight = 1;
        container.children.push(leaf);
        return true;
    }

    /**
     * Alterna a orientação do contêiner da janela.
     *
     * @param {number} id
     * @returns {boolean}
     */
    toggleLayout(id) {
        const leaf = this._leaves.get(id);
        if (!leaf)
            return false;
        leaf.parent.layout = leaf.parent.layout === 'h' ? 'v' : 'h';
        return true;
    }

    /**
     * Janela vizinha numa direção.
     *
     * Ao descer para dentro de um contêiner vizinho, prefere a janela usada mais
     * recentemente (`recent`, do mais novo ao mais velho); sem histórico, a mais
     * próxima do lado de onde se veio.
     *
     * @param {number} id
     * @param {string} direction
     * @param {object} [options]
     * @param {number[]} [options.recent] ids em ordem de uso recente
     * @returns {?number} id do vizinho, ou null na borda
     */
    neighbor(id, direction, {recent = []} = {}) {
        const leaf = this._leaves.get(id);
        if (!leaf)
            return null;

        const axis = axisOf(direction);
        const forward = isForward(direction);

        let cur = leaf;
        while (cur.parent) {
            const parent = cur.parent;
            if (parent.layout === axis) {
                const index = parent.children.indexOf(cur) + (forward ? 1 : -1);
                if (index >= 0 && index < parent.children.length)
                    return this._descend(parent.children[index], axis, forward, recent);
            }
            cur = parent;
        }
        return null;
    }

    /**
     * Troca duas janelas de lugar (e de tamanho).
     *
     * @returns {boolean}
     */
    swap(a, b) {
        const la = this._leaves.get(a);
        const lb = this._leaves.get(b);
        if (!la || !lb || la === lb)
            return false;

        const pa = la.parent;
        const pb = lb.parent;
        const ia = pa.children.indexOf(la);
        const ib = pb.children.indexOf(lb);

        pa.children[ia] = lb;
        pb.children[ib] = la;
        la.parent = pb;
        lb.parent = pa;
        [la.weight, lb.weight] = [lb.weight, la.weight];
        return true;
    }

    /**
     * Move a janela uma posição na direção pedida, no estilo do i3.
     *
     *  - vizinha no mesmo contêiner é janela → trocam de lugar;
     *  - vizinha é contêiner → a janela entra nele, pelo lado de onde veio;
     *  - janela na ponta do seu contêiner → sai dele e fica ao lado, no primeiro
     *    ancestral com a orientação certa;
     *  - na ponta da raiz de orientação contrária → a raiz é envolvida numa
     *    divisão nova, e a janela vai para aquele lado da tela.
     *
     * @param {number} id
     * @param {string} direction
     * @returns {{moved: boolean, edge: boolean}} `edge` indica que não havia para
     *   onde ir nesta chave — o módulo pode então tentar o monitor vizinho
     */
    move(id, direction) {
        const leaf = this._leaves.get(id);
        if (!leaf)
            return {moved: false, edge: false};

        const axis = axisOf(direction);
        const forward = isForward(direction);
        const root = this._rootOf(leaf);

        if (leavesOf(root).length === 1)
            return {moved: false, edge: true};

        // Caso direto: vizinho no próprio contêiner, com a orientação certa.
        const parent = leaf.parent;
        if (parent.layout === axis) {
            const index = parent.children.indexOf(leaf);
            const target = index + (forward ? 1 : -1);
            if (target >= 0 && target < parent.children.length) {
                const sibling = parent.children[target];
                if (sibling.kind === 'leaf') {
                    parent.children[index] = sibling;
                    parent.children[target] = leaf;
                    return {moved: true, edge: false};
                }
                this._detach(leaf, {keepEmpty: true});
                leaf.parent = sibling;
                leaf.weight = 1;
                if (forward)
                    sibling.children.unshift(leaf);
                else
                    sibling.children.push(leaf);
                equalize(sibling);
                this._normalize(parent);
                return {moved: true, edge: false};
            }
        }

        // Subir: o primeiro ancestral com a orientação certa recebe a janela ao
        // lado do ramo que a continha.
        //
        // Exceção: se todo o caminho até ali tem a mesma orientação e o ramo já
        // está na ponta, pôr a janela "ao lado" não muda nada na tela — é só
        // `h[1 h[2 3]]` virando `h[1 2 3]`. Nesse caso continua subindo, e se não
        // houver mais nada, é borda de verdade.
        let crossedOrthogonal = parent.layout !== axis;
        let cur = parent;
        while (cur.parent) {
            const ancestor = cur.parent;
            const index = ancestor.children.indexOf(cur);
            const atEdge = forward ? index === ancestor.children.length - 1 : index === 0;
            if (ancestor.layout === axis && (crossedOrthogonal || !atEdge)) {
                const oldParent = leaf.parent;
                this._detach(leaf, {keepEmpty: true});
                // O ramo pode ter sido desfeito pelo detach; relocaliza o ponto.
                const branch = ancestor.children.includes(cur) ? cur : null;
                let insertAt = branch ? ancestor.children.indexOf(branch) : ancestor.children.length;
                if (forward)
                    insertAt += 1;
                leaf.parent = ancestor;
                leaf.weight = 1;
                ancestor.children.splice(Math.min(insertAt, ancestor.children.length), 0, leaf);
                equalize(ancestor);
                // Normaliza a partir do pai antigo: ele pode estar vários níveis
                // abaixo do ramo, e todos os contêineres no caminho podem ter
                // ficado vazios ou com um filho só.
                this._normalize(oldParent);
                return {moved: true, edge: false};
            }
            if (ancestor.layout !== axis)
                crossedOrthogonal = true;
            cur = ancestor;
        }

        // Raiz de orientação contrária: envolve o conteúdo e põe a janela ao lado.
        if (root.layout !== axis) {
            const oldParent = leaf.parent;
            this._detach(leaf, {keepEmpty: true});
            const inner = makeSplit(root.layout, root);
            inner.children = root.children;
            for (const child of inner.children)
                child.parent = inner;
            root.layout = axis;
            leaf.parent = root;
            leaf.weight = 1;
            inner.weight = 1;
            root.children = forward ? [inner, leaf] : [leaf, inner];
            // Se a janela estava direto na raiz, o que sobrou dela agora é o
            // `inner`; senão, o pai antigo está em algum ponto abaixo dele.
            this._normalize(oldParent === root ? inner : oldParent);
            return {moved: true, edge: false};
        }

        return {moved: false, edge: true};
    }

    /**
     * Redimensiona uma janela empurrando uma de suas bordas.
     *
     * Procura o primeiro ancestral com a orientação da borda em que a janela (ou
     * o ramo que a contém) tenha vizinho daquele lado, e passa espaço entre os
     * dois. Na borda da tela não há vizinho: aí o espaço vem do lado oposto, que
     * é o que se espera de "aumentar a largura".
     *
     * @param {number} id
     * @param {string} edge 'left' | 'right' | 'up' | 'down'
     * @param {number} deltaPx positivo cresce, negativo encolhe
     * @param {Map<object, {width: number, height: number}>} rects retângulos dos
     *   contêineres, vindos do último layout
     * @returns {boolean} true se algum peso mudou
     */
    resize(id, edge, deltaPx, rects) {
        const leaf = this._leaves.get(id);
        if (!leaf || !deltaPx)
            return false;

        const axis = axisOf(edge);
        const forward = isForward(edge);

        const attempt = wantForward => {
            let cur = leaf;
            while (cur.parent) {
                const parent = cur.parent;
                if (parent.layout === axis && parent.children.length > 1) {
                    const index = parent.children.indexOf(cur) + (wantForward ? 1 : -1);
                    if (index >= 0 && index < parent.children.length)
                        return {parent, cur, sibling: parent.children[index]};
                }
                cur = parent;
            }
            return null;
        };

        const found = attempt(forward) ?? attempt(!forward);
        if (!found)
            return false;

        const {parent, cur, sibling} = found;
        const rect = rects?.get(parent);
        const size = rect ? (axis === 'h' ? rect.width : rect.height) : 0;
        if (!size)
            return false;

        const total = parent.children.reduce((sum, child) => sum + child.weight, 0);
        const unit = size / total;
        const minWeight = MIN_FRACTION * total;

        let delta = deltaPx / unit;
        delta = Math.min(delta, sibling.weight - minWeight);
        delta = Math.max(delta, minWeight - cur.weight);
        if (Math.abs(delta) < 1e-9)
            return false;

        cur.weight += delta;
        sibling.weight -= delta;
        return true;
    }

    // ------------------------------------------------------------ internos

    _rootOf(node) {
        let cur = node;
        while (cur.parent)
            cur = cur.parent;
        return cur;
    }

    /**
     * Desce até uma folha dentro de um nó.
     *
     * @returns {number}
     */
    _descend(node, axis, forward, recent) {
        if (node.kind === 'leaf')
            return node.id;

        const inside = leavesOf(node);
        for (const id of recent) {
            if (inside.some(leaf => leaf.id === id))
                return id;
        }

        let cur = node;
        while (cur.kind === 'split') {
            // Vindo pela esquerda, entra-se pela ponta esquerda do vizinho;
            // num contêiner perpendicular, a primeira janela.
            const pickLast = cur.layout === axis && !forward;
            cur = pickLast ? cur.children.at(-1) : cur.children[0];
        }
        return cur.id;
    }

    /**
     * Tira um nó do pai e arruma o que sobrou.
     *
     * @param {object} node
     * @param {object} [options]
     * @param {boolean} [options.keepEmpty] não desfaz o pai imediatamente
     */
    _detach(node, {keepEmpty = false} = {}) {
        const parent = node.parent;
        if (!parent)
            return;

        parent.children.splice(parent.children.indexOf(node), 1);
        node.parent = null;
        equalize(parent);

        if (!keepEmpty)
            this._normalize(parent);
    }

    /**
     * Remove contêineres vazios e achata os de um filho só, subindo até a raiz.
     *
     * A raiz nunca some; se ficar com um único contêiner, herda a orientação e
     * os filhos dele (senão sobraria um nível sem função).
     */
    _normalize(node) {
        let cur = node;
        while (cur) {
            const parent = cur.parent;

            if (!parent) {
                if (cur.children.length === 1 && cur.children[0].kind === 'split') {
                    const only = cur.children[0];
                    cur.layout = only.layout;
                    cur.children = only.children;
                    for (const child of cur.children)
                        child.parent = cur;
                }
                return;
            }

            if (cur.children.length === 0) {
                parent.children.splice(parent.children.indexOf(cur), 1);
                cur.parent = null;
                equalize(parent);
            } else if (cur.children.length === 1) {
                const only = cur.children[0];
                only.parent = parent;
                only.weight = cur.weight;
                parent.children[parent.children.indexOf(cur)] = only;
                cur.parent = null;
            } else {
                return;
            }
            cur = parent;
        }
    }
}

/** Folhas de um nó, em ordem. */
export function leavesOf(node) {
    if (node.kind === 'leaf')
        return [node];
    return node.children.flatMap(leavesOf);
}

/** Todos os filhos com o mesmo peso: o espaço volta a ser dividido igualmente. */
function equalize(container) {
    for (const child of container.children)
        child.weight = 1;
}

function describeNode(node) {
    if (node.kind === 'leaf')
        return String(node.id);
    return `${node.layout}[${node.children.map(describeNode).join(' ')}]`;
}
