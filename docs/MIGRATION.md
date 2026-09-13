# MIGRATION.md

Como a configuração das 11 extensões originais vira configuração do GnomeCustom.

A fonte da verdade é o código: `lib/migration/importers.js` (mapeamento, puro e testado) e
`lib/migration/apply.js` (leitura das extensões, gravação, backup). Este documento resume o
que eles fazem. **Reescrito na Fase 9**: a versão da Fase 0 citava chaves imaginadas antes de
os módulos existirem.

```
extensão original (esquema dela + arquivos do Forge)
        │  só leitura
        ▼
importers.js ──► gravações + notas ──► apply.js ──► gnomecustom.*
                                          │
                                          └─► migration-backup (foto de antes)
```

## Princípios

1. **Só leitura das originais.** O `Gio.Settings` de uma extensão original nunca recebe `set_*`.
2. **Valor efetivo, não só o alterado.** Importa o que o usuário vê hoje, padrão incluído: o Logo
   Menu esconde "bloquear" e "energia" por padrão e o nosso mostra.
3. **Nada some calado.** O que não tem equivalente vira nota no relatório.
4. **Importar não liga módulos.** Isso é perfil ou página Geral.
5. **Reversível.** Antes de gravar, uma foto de todas as chaves do GnomeCustom vai para
   `migration-backup`; "Desfazer" restaura, inclusive voltando ao padrão o que estava no padrão.
6. **Ajuste aos limites.** Números fora do intervalo do nosso esquema são limitados e relatados.

## Mapeamento

| Origem | Vai para | Notas quando não há equivalente |
|---|---|---|
| **Dash to Dock** `dash-max-icon-size`, `height-fraction`, `background-opacity` (se `transparency-mode` for FIXED/DYNAMIC) | `dock/icon-size`, `length-fraction`, `background-opacity` | auto-ocultar, posição ≠ baixo, monitor, estilo do indicador, lixeira/volumes/botão de apps |
| **Forge** 8 opções (`tiling-mode-enabled`, `auto-split-enabled`, gaps, `float-always-on-top-enabled`, `focus-border-toggle`, `quick-settings-enabled`) | `tiling/*` | pilha/abas, foco por hover, ponteiro com o foco |
| Forge `preview-hint-enabled` | `tiling/drag-swap` | a prévia durante o arrasto não existe |
| Forge `workspace-skip-tile` (`"0,2"`) | `tiling/skip-workspaces` (`[0, 2]`) | — |
| Forge `keybindings/*` (39) | `tiling.keybindings/*` (mesmos nomes) | — |
| Forge `~/.config/forge/config/windows.json` | `tiling/window-rules` | regras por `wmId` **descartadas e contadas** |
| Forge `stylesheet.css` (`.window-tiled-border`) | `theme/tiling-border-color/-width/-radius` | — |
| **Open Bar** `bartype` | `theme/panel-style` (Floating→floating, Mainland→attached; Trilands/Islands aproximados) | — |
| Open Bar `height`, `margin`, `bottom-margin`, `bradius`, `bwidth`, `balpha`, `bgalpha` | `theme/panel-*`; laterais = 3 × `margin` | — |
| Open Bar `bg-change` / `bgcolor` / `hcolor` | `palette-from-wallpaper` / `background-color` / `accent-color` | — |
| Open Bar `fitts-widgets`, `menustyle`, `dashdock-style` + `dbradius` | `fitts-widgets`, `style-menus`, `style-dock` + `dock-radius` | as ~270 chaves restantes (neon, sombras, GTK…) |
| **User Themes** `name` | `theme/shell-theme` | — |
| **Impatience** `speed-factor` | `animation/speed-factor` | — |
| **GNOME UI Tune** 4 interruptores | `overview/*` | miniaturas maiores (usa o tamanho do GNOME) |
| **Logo Menu** ícone (`use-custom-icon`, `symbolic-icon`, caminho), `menu-button-icon-size` | `menu/icon-source`, `custom-icon-path`, `icon-size` | galeria de logotipos do Logo Menu |
| Logo Menu `hide-forcequit`, `hide-softwarecentre` (invertidos), `show-lockscreen`, `show-power-options` | `menu/show-force-quit`, `show-software`, `show-lock`, `show-power` | — |
| Logo Menu comandos (`gnome-software`…) | `menu/*-app` (identificadores .desktop) | comando desconhecido; `gnome-terminal` padrão vira "terminal do sistema" |
| Logo Menu `show-activities-button`, `menu-button-extensions-app` | `panel/show-activities`, `menu/extensions-app` | — |
| **Apps Menu** `apps-menu-toggle-menu` | `panel/apps-menu-shortcut` | — |
| **Spotify Controls** `position`, `max-width` (> 0) | `media/panel-position`, `panel-max-width` | controles de reprodução no card; largura ilimitada |
| **Bluetooth Battery Indicator** | — | intervalo (o BlueZ avisa), lista de dispositivos, ocultar indicador |
| **OSD Volume Number** | — | posições de ícone e número (o número sempre substitui o ícone) |

## O que muda para o usuário do baseline

Ensaio só-leitura sobre as extensões instaladas em 2026-09-13: **90 gravações, 3 mudariam
algo** — os padrões do GnomeCustom já são o baseline.

- `theme/shell-theme`: `''` → `'Orchis-Grey-Dark-Compact'`
- `menu/show-lock` e `menu/show-power`: `true` → `false` (como o Logo Menu dele)

As regras fantasmas por `wmId` do `windows.json` real somem na importação, e o resultado são as
28 regras padrão.

## Interface

Preferências ▸ **Migração**: um botão "Importar" por extensão instalada, "Importar todas",
"Desfazer a última importação" e os passos da troca. Cada importação mostra o relatório:
alteradas, iguais, ajustadas, não importadas e sem equivalente.

## Não migrado

| Item | Motivo |
|---|---|
| Atalhos do GNOME (`Super+W`, `Super+Z`, `Ctrl+Super+←→`, capturas) | pertencem ao GNOME, não às extensões |
| `favorite-apps` | chave do próprio Shell; o dock lê a original |
| `rounded-window-corners-reborn` (resíduo em dconf) | extensão não instalada |
