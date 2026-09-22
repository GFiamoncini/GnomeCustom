#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Gera o tema Dracula-AMOLED a partir das fontes do Dracula (github.com/dracula/gtk,
GPL-3.0, de Eliver Lara e colaboradores).

O que muda em relação ao Dracula (pedido do usuário, 2026-09-21):
  - fundo preto puro (#000000), para telas OLED;
  - destaque branco no lugar do roxo;
  - densidade do Orchis Compact (mesma regra de redução de medidas);
  - botões das janelas nas cores do macOS, com o símbolo ao passar o mouse;
  - um CSS curto que recolore os apps libadwaita pelas cores nomeadas.

Como é feito:
  - Shell: as fontes Sass do Dracula compilam limpo no dart-sass (`npx sass`), então a
    paleta é trocada nas próprias variáveis;
  - GTK 3 e 4: as fontes usam `@extend` de seletores compostos, que o Sass atual recusa.
    Parte-se do CSS que o Dracula publica já compilado e as cores são convertidas uma a
    uma (`recolor`), como as imagens das caixas de seleção.

Depende de Python 3, Pillow (imagens) e npx (dart-sass).

Uso: build.py <fontes do Dracula> <saída>
"""

import colorsys
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
THEME_NAME = 'Dracula-AMOLED'

# --------------------------------------------------------------- paleta

WHITE = '#f8f8f2'   # o "branco" do Dracula, levemente quente

# Variável → valor novo no arquivo de cores do Shell; o resto deriva destas.
SHELL_COLORS = {
    'base_color': '#000000',
    'bg_color': '#000000',
    'purple': WHITE,
    'teal': WHITE,
    # Seleção como no macOS: branco sólido com texto preto (um véu branco sob texto
    # branco ficava ilegível, e as variações mais transparentes sumiam).
    'selected_bg_color': WHITE,
    'selected_fg_color': '#000000',
}


def override_variables(path, values):
    """Troca `$nome: valor;` no começo da linha; falha se alguma não existir."""
    text = path.read_text()
    for name, value in values.items():
        pattern = re.compile(rf'^\${re.escape(name)}\s*:[^;]*;', re.M)
        if not pattern.search(text):
            raise SystemExit(f'variável ${name} não encontrada em {path}')
        text = pattern.sub(f'${name}: {value};', text, count=1)
    path.write_text(text)


# ----------------------------------------------- recolorir o GTK pronto

# O fundo do Dracula (#282a36, #1e1f29…) é um cinza-azulado; estes limites
# levam essa família ao preto, mantendo a ordem entre os tons (um botão continua
# um passo acima do fundo). O roxo vira branco, na mesma luminosidade relativa.
DRACULA_BLACK_POINT = 0x36    # o canal mais alto do #282a36
DARK_LIMIT = 0x90             # acima disto, nada muda
PURPLE_LIGHTNESS = 0.776      # luminosidade do #bd93f9


def recolor_rgb(r, g, b, *, marks_to_white=False):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if s > 0.3 and 0.68 < h < 0.82:                       # família do roxo
        v = min(248, round(248 * l / PURPLE_LIGHTNESS))
        return v, v, max(0, v - 6)
    if marks_to_white and s > 0.5 and 0.28 < h < 0.45:    # marca verde das caixas
        return 248, 248, 242
    top = max(r, g, b)
    if l < 0.45 and s < 0.45 and top < DARK_LIMIT:        # cinzas escuros tingidos
        v = 0 if top <= DRACULA_BLACK_POINT else round(
            (top - DRACULA_BLACK_POINT) * DARK_LIMIT / (DARK_LIMIT - DRACULA_BLACK_POINT))
        return v, v, v
    return r, g, b


def recolor_css(css):
    def hex_color(m):
        digits = m.group(1)
        full = ''.join(c * 2 for c in digits) if len(digits) == 3 else digits
        r, g, b = (int(full[i:i + 2], 16) for i in (0, 2, 4))
        return '#{:02x}{:02x}{:02x}'.format(*recolor_rgb(r, g, b))

    def func_color(m):
        r, g, b = (int(float(x)) for x in (m.group(2), m.group(3), m.group(4)))
        nr, ng, nb = recolor_rgb(r, g, b)
        return f'{m.group(1)}({nr}, {ng}, {nb}{m.group(5) or ""})'

    css = re.sub(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', hex_color, css)
    return re.sub(r'(rgba?)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(,\s*[\d.]+)?\s*\)',
                  func_color, css)


def recolor_png(path):
    from PIL import Image
    image = Image.open(path).convert('RGBA')
    marks = any(key in path.name for key in ('check', 'radio'))
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a:
                pixels[x, y] = (*recolor_rgb(r, g, b, marks_to_white=marks), a)
    image.save(path)


# ------------------------------------------------------------- densidade

# A mesma regra do Orchis Compact, medida comparando Orchis-Grey-Dark com
# Orchis-Grey-Dark-Compact: espaçamentos 12→8, 6→4, 3→2 (dois terços); alturas
# mínimas 36→32, 28→24, 24→22; no Shell, fonte ≈ 7% menor.
SPACING_PROPS = ('padding', 'margin', 'spacing', 'border-spacing')
SIZE_PROPS = ('min-height', 'min-width')


def compact_spacing(px):
    return px if px <= 2 else max(2, round(px * 2 / 3))


def compact_size(px):
    if px >= 28:
        return px - 4
    if px >= 20:
        return px - 2
    return px


def _map_px(values, fn):
    return re.sub(r'(?<![\d.])(\d+)px', lambda m: f'{fn(int(m.group(1)))}px', values)


def compact_css(css, *, fonts=False):
    def repl(m):
        prop, value = m.group(1), m.group(2)
        base = prop.split('-')[0] if prop.startswith(('padding', 'margin')) else prop
        if base in SPACING_PROPS:
            value = _map_px(value, compact_spacing)
        elif prop in SIZE_PROPS:
            value = _map_px(value, compact_size)
        elif fonts and prop == 'font-size':
            value = re.sub(r'(\d+(?:\.\d+)?)(pt|em|px)',
                lambda f: f'{round(float(f.group(1)) * 0.93, 2):g}{f.group(2)}', value)
        return f'{prop}: {value}'
    # Só declarações (terminam em ';' ou '}'); `button:hover {` é seletor e fica como está.
    return re.sub(r'(?<=[{;\s])([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])', repl, css)


# --------------------------------------------------- botões das janelas

MAC = {
    'close': ('#ff5f57', '#e2463f', 'M5.5 5.5l5 5M10.5 5.5l-5 5'),
    'min': ('#febc2e', '#dea123', 'M5 8h6'),
    'maximize': ('#28c840', '#1aab29', 'M8 5v6M5 8h6'),
}
UNFOCUSED = ('#3a3a3a', '#2e2e2e')


def button_svg(fill, stroke, glyph=None, pressed=False):
    """Círculo de 14 px num quadro de 16, como os do macOS."""
    shade = '<circle cx="8" cy="8" r="6.5" fill="#000" fill-opacity="0.18"/>' if pressed else ''
    mark = (f'<path d="{glyph}" stroke="#000" stroke-opacity="0.55" stroke-width="1.4" '
            'stroke-linecap="round" fill="none"/>') if glyph else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
            f'<circle cx="8" cy="8" r="6.5" fill="{fill}" stroke="{stroke}" stroke-width="0.8"/>'
            f'{shade}{mark}</svg>\n')


def write_buttons(assets):
    assets.mkdir(parents=True, exist_ok=True)
    for name, (fill, stroke, glyph) in MAC.items():
        (assets / f'{name}.svg').write_text(button_svg(fill, stroke))
        (assets / f'{name}_prelight.svg').write_text(button_svg(fill, stroke, glyph))
        (assets / f'{name}_pressed.svg').write_text(button_svg(fill, stroke, glyph, pressed=True))
        (assets / f'{name}_unfocused.svg').write_text(button_svg(*UNFOCUSED))


def buttons_to_svg(css):
    """O Dracula aponta os botões para PNG em duas escalas; aqui, um SVG só."""
    return re.sub(
        r'-gtk-scaled\(url\("(\.\./assets/)(close|min|maximize)(_[a-z]+)?\.png"\)\s*,\s*url\("[^"]+"\)\)',
        lambda m: f'url("{m.group(1)}{m.group(2)}{m.group(3) or ""}.svg")', css)


# ---------------------------------------------------------------- build

def sass(source, target):
    subprocess.run(['npx', '--yes', 'sass', '--no-source-map', '--quiet',
        '--silence-deprecation=import,global-builtin,color-functions,slash-div,mixed-decls',
        str(source), str(target)], check=True)


def main(src, out):
    src, out = Path(src), Path(out)
    work = out.parent / f'{THEME_NAME}-src'
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(src, work, ignore=shutil.ignore_patterns('.git'))

    override_variables(work / 'gnome-shell' / '_colors.scss', SHELL_COLORS)
    write_buttons(work / 'assets')

    shutil.rmtree(out, ignore_errors=True)
    for part in ('gtk-3.20', 'gtk-4.0', 'gnome-shell'):
        (out / part).mkdir(parents=True)

    for part in ('gtk-3.20', 'gtk-4.0'):
        css = (work / part / 'gtk-dark.css').read_text()
        (out / part / 'gtk.css').write_text(recolor_css(css) + (HERE / 'gtk-extra.css').read_text())
    sass(work / 'gnome-shell' / 'gnome-shell.scss', out / 'gnome-shell' / 'gnome-shell.css')
    shell_css = out / 'gnome-shell' / 'gnome-shell.css'
    shell_css.write_text(shell_css.read_text() + (HERE / 'shell-extra.css').read_text())

    for part, fonts in (('gtk-3.20', False), ('gtk-4.0', False), ('gnome-shell', True)):
        for name in ('gtk.css', 'gnome-shell.css'):
            css_file = out / part / name
            if css_file.exists():
                css_file.write_text(buttons_to_svg(compact_css(css_file.read_text(), fonts=fonts)))
    # Tema escuro por inteiro: a variante "dark" é a mesma folha.
    for part in ('gtk-3.20', 'gtk-4.0'):
        shutil.copy(out / part / 'gtk.css', out / part / 'gtk-dark.css')

    for part in ('gtk-3.20', 'gtk-4.0', 'gnome-shell'):
        if (work / part / 'assets').is_dir():
            shutil.copytree(work / part / 'assets', out / part / 'assets')
    shutil.copytree(work / 'assets', out / 'assets')
    for png in (out / 'assets').glob('*.png'):
        recolor_png(png)
    shutil.copy(work / 'LICENSE', out / 'COPYING')

    (out / 'libadwaita').mkdir()
    shutil.copy(HERE / 'libadwaita.css', out / 'libadwaita' / 'gtk.css')
    shutil.copy(HERE / 'README.md', out / 'README.md')
    # Receita para os apps Electron (VS Code, Obsidian), aplicada pelo GnomeCustom.
    shutil.copytree(HERE / 'apps', out / 'apps')
    (out / 'index.theme').write_text(
        '[Desktop Entry]\nType=X-GNOME-Metatheme\n'
        f'Name={THEME_NAME}\n'
        'Comment=Dracula em preto AMOLED, destaque branco e densidade compacta (derivado do Dracula, GPL-3.0)\n'
        'Encoding=UTF-8\n\n[X-GNOME-Metatheme]\n'
        f'GtkTheme={THEME_NAME}\nMetacityTheme={THEME_NAME}\nButtonLayout=close,minimize,maximize:\n')
    shutil.rmtree(work)
    print(f'{THEME_NAME} gerado em {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
