# Dracula-AMOLED

Tema derivado do **Dracula** (<https://github.com/dracula/gtk>, © Eliver Lara e
colaboradores, **GPL-3.0**), gerado pelo `build.py` desta pasta a partir de um commit
fixado das fontes (ver `DRACULA_COMMIT` no `Makefile`).

O que muda em relação ao Dracula:

- fundo **preto puro** (`#000000`), para telas OLED;
- **destaque branco** no lugar do roxo;
- **densidade compacta**, com a mesma regra do Orchis Compact (espaçamentos 12→8,
  6→4, 3→2; alturas mínimas 36→32, 28→24, 24→22; fonte do Shell ≈ 7% menor);
- **botões das janelas nas cores do macOS**, com o símbolo ao passar o mouse;
- **apps libadwaita** recoloridos por `libadwaita/gtk.css`, que só troca as cores
  nomeadas do libadwaita (o desenho dos widgets continua o do GNOME).
- **cantos das janelas GTK 3/4 com 15px nos quatro lados**, como no libadwaita (o
  Dracula usa 4px só em cima, e o Chrome no modo "GTK" vazava da borda do mosaico);
- **receita para apps Electron** em `apps/`: cores pretas e moldura do sistema no
  VS Code e no Obsidian; moldura do sistema no GitHub Desktop.

## Partes

| Pasta | Para quê |
|---|---|
| `gnome-shell/` | tema do Shell (barra, menus, calendário) — escolhido no GnomeCustom |
| `gtk-3.20/` | apps GTK 3 |
| `gtk-4.0/` | apps GTK 4 que não usam libadwaita |
| `libadwaita/gtk.css` | apps libadwaita, ligado em `~/.config/gtk-4.0/gtk.css` |
| `apps/vscode.json` | configurações postas num bloco marcado do `settings.json` do VS Code |
| `apps/obsidian.json` | moldura nativa (`obsidian.json`) e cor de destaque de cada cofre |
| `apps/obsidian.css` | snippet ligado em cada cofre do Obsidian |
| `apps/github-desktop.json` | barra de título do sistema no GitHub Desktop (as cores dele só têm Claro/Escuro) |

## Gerar e instalar

    make theme-dracula-amoled

Instala em `~/.themes/Dracula-AMOLED`. Na extensão, **Tema › Tema do Shell** passa a
oferecê-lo; com **"Aplicar também aos aplicativos"** ligado, o GnomeCustom troca o tema
GTK, liga o CSS do libadwaita e aplica a receita de `apps/` nos apps instalados (e
desfaz tudo ao trocar de tema ou desligar a opção; os arquivos originais ficam com
uma cópia `.gnomecustom-backup`). O Chrome não entra na receita: nele, escolha
Configurações › Aparência › Tema "GTK".

Licença do tema: GPL-3.0 (`COPYING`), a mesma do Dracula.
