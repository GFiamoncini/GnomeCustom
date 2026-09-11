// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Redução de uma imagem a uma paleta pequena, por corte mediano.
 *
 * Implementação própria do algoritmo clássico de *median cut* com histograma
 * quantizado, escrita a partir da descrição do algoritmo. O Open Bar resolve o
 * mesmo problema com `quantize.js` (MMCQ de Nick Rabinowitz, MIT) — foi a
 * referência de que a abordagem serve bem para papel de parede, mas nenhuma
 * linha veio de lá: aquele arquivo carrega dependências antigas de Protovis e
 * padrões que não sobrevivem a módulos ESM em modo estrito. Ver LICENSE-AUDIT.md §5.
 *
 * Sem dependências: `tests/run.js` exercita este arquivo diretamente.
 */

/** Bits por canal no histograma. 5 bits → 32.768 células, suficiente e leve. */
const SIGNIFICANT_BITS = 5;
const SHIFT = 8 - SIGNIFICANT_BITS;
const SIDE = 1 << SIGNIFICANT_BITS;

/** Índice da célula do histograma para um pixel. */
function cellIndex(r, g, b) {
    return ((r >> SHIFT) << (2 * SIGNIFICANT_BITS)) +
           ((g >> SHIFT) << SIGNIFICANT_BITS) +
            (b >> SHIFT);
}

/** Caixa no espaço de cor reduzido, com os limites de cada eixo. */
class Box {
    constructor(rMin, rMax, gMin, gMax, bMin, bMax, histogram) {
        this.rMin = rMin;
        this.rMax = rMax;
        this.gMin = gMin;
        this.gMax = gMax;
        this.bMin = bMin;
        this.bMax = bMax;
        this._histogram = histogram;
        this._count = null;
        this._average = null;

        this._tighten();
    }

    /**
     * Encolhe os limites até a região realmente ocupada.
     *
     * Sem isto, um corte pode produzir uma metade vazia — e a metade vazia
     * consome uma das cores pedidas sem representar nada. Com os limites justos,
     * uma caixa que contém uma única célula tem volume 1 e simplesmente não é
     * mais candidata a divisão.
     */
    _tighten() {
        let rMin = this.rMax;
        let rMax = this.rMin;
        let gMin = this.gMax;
        let gMax = this.gMin;
        let bMin = this.bMax;
        let bMax = this.bMin;
        let found = false;

        for (let r = this.rMin; r <= this.rMax; r++) {
            for (let g = this.gMin; g <= this.gMax; g++) {
                for (let b = this.bMin; b <= this.bMax; b++) {
                    if (this._histogram[(r << (2 * SIGNIFICANT_BITS)) +
                        (g << SIGNIFICANT_BITS) + b] === 0)
                        continue;

                    found = true;
                    if (r < rMin)
                        rMin = r;
                    if (r > rMax)
                        rMax = r;
                    if (g < gMin)
                        gMin = g;
                    if (g > gMax)
                        gMax = g;
                    if (b < bMin)
                        bMin = b;
                    if (b > bMax)
                        bMax = b;
                }
            }
        }

        if (!found) {
            this._count = 0;
            return;
        }

        this.rMin = rMin;
        this.rMax = rMax;
        this.gMin = gMin;
        this.gMax = gMax;
        this.bMin = bMin;
        this.bMax = bMax;
    }

    /** Número de pixels contidos. Calculado uma vez. */
    get count() {
        if (this._count !== null)
            return this._count;

        let total = 0;
        for (let r = this.rMin; r <= this.rMax; r++) {
            for (let g = this.gMin; g <= this.gMax; g++) {
                for (let b = this.bMin; b <= this.bMax; b++)
                    total += this._histogram[(r << (2 * SIGNIFICANT_BITS)) + (g << SIGNIFICANT_BITS) + b];
            }
        }
        this._count = total;
        return total;
    }

    get volume() {
        return (this.rMax - this.rMin + 1) *
               (this.gMax - this.gMin + 1) *
               (this.bMax - this.bMin + 1);
    }

    /** Eixo mais longo: 0 = vermelho, 1 = verde, 2 = azul. */
    get longestAxis() {
        const spans = [
            this.rMax - this.rMin,
            this.gMax - this.gMin,
            this.bMax - this.bMin,
        ];
        return spans.indexOf(Math.max(...spans));
    }

    /** Média ponderada das cores contidas, em 0–255. */
    get average() {
        if (this._average !== null)
            return this._average;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let total = 0;

        for (let r = this.rMin; r <= this.rMax; r++) {
            for (let g = this.gMin; g <= this.gMax; g++) {
                for (let b = this.bMin; b <= this.bMax; b++) {
                    const weight = this._histogram[
                        (r << (2 * SIGNIFICANT_BITS)) + (g << SIGNIFICANT_BITS) + b];
                    if (weight === 0)
                        continue;
                    total += weight;
                    // +0.5 devolve o centro da célula, não a borda.
                    sumR += weight * (r + 0.5) * (1 << SHIFT);
                    sumG += weight * (g + 0.5) * (1 << SHIFT);
                    sumB += weight * (b + 0.5) * (1 << SHIFT);
                }
            }
        }

        this._average = total === 0
            ? [
                Math.round(((this.rMin + this.rMax + 1) / 2) * (1 << SHIFT)),
                Math.round(((this.gMin + this.gMax + 1) / 2) * (1 << SHIFT)),
                Math.round(((this.bMin + this.bMax + 1) / 2) * (1 << SHIFT)),
            ]
            : [
                Math.min(255, Math.round(sumR / total)),
                Math.min(255, Math.round(sumG / total)),
                Math.min(255, Math.round(sumB / total)),
            ];
        return this._average;
    }

    /**
     * Divide a caixa no ponto que deixa metade dos pixels de cada lado.
     *
     * @returns {?Box[]} as duas metades, ou null se não houver como dividir
     */
    split() {
        if (this.count <= 1 || this.volume <= 1)
            return null;

        const axis = this.longestAxis;
        const [min, max] = [
            [this.rMin, this.rMax],
            [this.gMin, this.gMax],
            [this.bMin, this.bMax],
        ][axis];

        if (min === max)
            return null;

        // Soma acumulada ao longo do eixo escolhido.
        const totals = [];
        let running = 0;
        for (let value = min; value <= max; value++) {
            running += this._sliceCount(axis, value);
            totals.push(running);
        }

        const half = running / 2;
        let cut = min;
        for (let i = 0; i < totals.length; i++) {
            if (totals[i] >= half) {
                // Evita uma metade vazia quando toda a massa está na primeira fatia.
                cut = Math.min(min + i, max - 1);
                break;
            }
        }

        const bounds = [
            [this.rMin, this.rMax],
            [this.gMin, this.gMax],
            [this.bMin, this.bMax],
        ];
        const lower = bounds.map(pair => [...pair]);
        const upper = bounds.map(pair => [...pair]);
        lower[axis][1] = cut;
        upper[axis][0] = cut + 1;

        const halves = [
            new Box(lower[0][0], lower[0][1], lower[1][0], lower[1][1],
                lower[2][0], lower[2][1], this._histogram),
            new Box(upper[0][0], upper[0][1], upper[1][0], upper[1][1],
                upper[2][0], upper[2][1], this._histogram),
        ];

        // Um corte que deixa um lado vazio não divide nada de fato.
        if (halves.some(half => half.count === 0))
            return null;

        return halves;
    }

    /** Pixels em uma fatia perpendicular ao eixo. */
    _sliceCount(axis, value) {
        let total = 0;
        const rRange = axis === 0 ? [value, value] : [this.rMin, this.rMax];
        const gRange = axis === 1 ? [value, value] : [this.gMin, this.gMax];
        const bRange = axis === 2 ? [value, value] : [this.bMin, this.bMax];

        for (let r = rRange[0]; r <= rRange[1]; r++) {
            for (let g = gRange[0]; g <= gRange[1]; g++) {
                for (let b = bRange[0]; b <= bRange[1]; b++)
                    total += this._histogram[(r << (2 * SIGNIFICANT_BITS)) + (g << SIGNIFICANT_BITS) + b];
            }
        }
        return total;
    }
}

/**
 * @param {Array<number[]>|Uint8Array} pixels lista de `[r, g, b]`
 * @returns {{histogram: Int32Array, bounds: number[], total: number}}
 */
function buildHistogram(pixels) {
    const histogram = new Int32Array(SIDE * SIDE * SIDE);
    let rMin = SIDE - 1;
    let rMax = 0;
    let gMin = SIDE - 1;
    let gMax = 0;
    let bMin = SIDE - 1;
    let bMax = 0;
    let total = 0;

    for (const pixel of pixels) {
        const r = pixel[0] >> SHIFT;
        const g = pixel[1] >> SHIFT;
        const b = pixel[2] >> SHIFT;

        histogram[(r << (2 * SIGNIFICANT_BITS)) + (g << SIGNIFICANT_BITS) + b]++;
        total++;

        if (r < rMin)
            rMin = r;
        if (r > rMax)
            rMax = r;
        if (g < gMin)
            gMin = g;
        if (g > gMax)
            gMax = g;
        if (b < bMin)
            bMin = b;
        if (b > bMax)
            bMax = b;
    }

    return {histogram, bounds: [rMin, rMax, gMin, gMax, bMin, bMax], total};
}

/**
 * Reduz os pixels a até `maxColors` cores representativas.
 *
 * @param {Array<number[]>} pixels lista de `[r, g, b]` em 0–255
 * @param {number} [maxColors]
 * @returns {Array<{color: number[], count: number}>} do mais frequente ao menos
 */
export function quantize(pixels, maxColors = 12) {
    if (maxColors < 1)
        throw new Error('quantize: maxColors deve ser >= 1');

    const {histogram, bounds, total} = buildHistogram(pixels);
    if (total === 0)
        return [];

    let boxes = [new Box(...bounds, histogram)];

    // Divide sempre a caixa mais populosa: é o que mantém as cores dominantes
    // separadas em vez de gastar cortes em regiões pouco povoadas.
    while (boxes.length < maxColors) {
        boxes.sort((a, b) => b.count - a.count || b.volume - a.volume);

        let advanced = false;
        for (let i = 0; i < boxes.length && boxes.length < maxColors; i++) {
            const halves = boxes[i].split();
            if (!halves)
                continue;
            boxes.splice(i, 1, ...halves);
            advanced = true;
            break;
        }
        if (!advanced)
            break;
    }

    return boxes
        .filter(box => box.count > 0)
        .map(box => ({color: box.average, count: box.count}))
        .sort((a, b) => b.count - a.count);
}
