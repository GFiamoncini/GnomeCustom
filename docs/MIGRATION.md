# MIGRATION.md

Camada de migração: converte a configuração das extensões originais em configuração do
GnomeCustom. Base factual: `BASELINE-CONFIG.md`.

```
config antiga (dconf + arquivos)  ──►  Migration Layer  ──►  gnomecustom.*
```

Princípios:
1. A migração **nunca escreve** nos esquemas das extensões originais (só lê).
2. É idempotente e versionada (`advanced.migration-version`).
3. Cada importador é independente e opcional (botões separados em Preferências).
4. O que não tem equivalente é **relatado**, não silenciosamente descartado.

---

## 1. Dash to Dock → `gnomecustom.dock`

| Origem | Valor no baseline | Destino | Observação |
|---|---|---|---|
| `dock-position` | `BOTTOM` | `position` | enum idêntico |
| `dock-fixed` | `true` | `fixed` | |
| `height-fraction` | `0.90` | `length-fraction` | renomeado (vale para as duas orientações) |
| `dash-max-icon-size` | `24` | `icon-size` | |
| `custom-theme-shrink` | `true` | `compact` | |
| `running-indicator-style` | `DOTS` | `running-indicator` | |
| `transparency-mode` + `background-opacity` | `FIXED` + `0.0` | `background-alpha` = 0.0, `background-mode` = `fixed` | dois campos → dois campos |
| `preferred-monitor-by-connector` | `HDMI-1` | `monitor-connector` | **usar sempre o conector**, não o índice |
| `preferred-monitor` | `-2` | — | índice legado do D2D; descartar |
| `show-show-apps-button` / `show-trash` / `show-mounts` / `show-icons-emblems` | todos `false` | `show-apps-button` / `show-trash` / `show-mounts` / `show-emblems` | |
| ~90 chaves restantes | default | — | relatar "não migrado (default)" |

## 2. Forge → `gnomecustom.tiling`

| Origem | Valor | Destino |
|---|---|---|
| `tiling-mode-enabled` | `true` | `gnomecustom tiling-enabled` |
| `auto-split-enabled` | `false` | `auto-split` |
| `window-gap-size` / `-increment` | `2` / `1` | `gap-size` / `gap-increment` |
| `window-gap-hidden-on-single` | `true` | `gap-hidden-on-single` |
| `float-always-on-top-enabled` | `true` | `float-always-on-top` |
| `focus-border-toggle` | `true` | `focus-border` |
| `focus-on-hover-enabled` | `false` | `focus-on-hover` |
| `move-pointer-focus-enabled` | `false` | `move-pointer-focus` |
| `preview-hint-enabled` | `true` | `preview-hint` |
| `quick-settings-enabled` | `true` | `quick-settings-toggle` |
| `stacked-` / `tabbed-tiling-mode-enabled` | `false` | `stacked-mode` / `tabbed-mode` |
| `keybindings/*` (40 chaves) | ver baseline | `tiling.keybindings.*` | nomes mantidos 1:1 quando o conceito existe |
| `css-last-update`, `css-updated`, `window-overrides-reload-trigger` | — | — | estado interno; descartar |

### 2.1 Estado fora do GSettings
| Origem | Destino | Tratamento |
|---|---|---|
| `~/.config/forge/config/windows.json` (32 regras) | `tiling.window-rules` (JSON em uma chave `string`) | importar apenas entradas com `wmClass`/`wmTitle`; **descartar as 4 entradas com `wmId`** e informar o usuário |
| `~/.config/forge/stylesheet/forge/stylesheet.css` | `theme.tiling-colors` (tiled/split/stacked/tabbed/floated, largura e raio de borda) | extrair as 5 cores + `border-width` + `border-radius`; não importar CSS cru |

## 3. Open Bar → `gnomecustom.theme`

| Origem | Valor | Destino |
|---|---|---|
| `bartype` | `Floating` | `panel-style` |
| `height` | `29` | `panel-height` |
| `margin` / `bottom-margin` | `1.5` / `2.1` | `panel-margin-top` / `panel-margin-bottom` |
| `bradius` | `15` | `panel-radius` |
| `bwidth` / `balpha` | `2` / `0.5` | `panel-border-width` / `panel-border-alpha` |
| `bgalpha` | `0.90` | `panel-background-alpha` |
| `hcolor` / `bgcolor2` | `(0.110,0.443,0.847)` | `accent-color` (converter para hex `#1C71D8`) |
| `bg-change` + `bguri` | `true` + `~/.config/background` | `palette-from-wallpaper` + (wallpaper lido do sistema, não da chave) |
| `palette1..12`, `light-*`, `dark-*` | paleta do wallpaper | `palette` (cache regenerável) — importar como cache, não como verdade |
| `fitts-widgets` | `true` | `fitts-widgets` |
| `neon`, `dshadow`, `dborder`, `menustyle`, `apply-menu-shell` | `false` | correspondentes (todos default off) |
| `monitor-width/height` | 2560/1080 | — | detectar em runtime; descartar |
| `count1..12`, `pause-reload`, `reloadstyle`, `trigger-reload`, `import-export` | — | — | estado interno; descartar |
| ~250 chaves restantes | default | — | relatar |

## 4. Extensões menores

| Origem | Chave | Destino |
|---|---|---|
| `user-theme name` | `Orchis-Grey-Dark-Compact` | `theme.shell-theme` (a mesma chave global continua sendo a fonte de verdade) |
| `gnome-ui-tune increase-thumbnails-size` | `'100%'` | `overview.thumbnails-scale` (converter `'100%'` → `2.0`) |
| `gnome-ui-tune` (demais, default) | ligados | `overview.hide-search-until-typing`, `.thumbnails-background`, `.thumbnails-always`, `.firefox-pip` |
| `impatience speed-factor` | `0.25` | `animation.speed-factor` |
| `bluetooth_battery_indicator hide-indicator` | `true` | `bluetooth.hide-indicator` |
| `… interval` | `4` (min) | `bluetooth.refresh-interval` (guardar em **segundos**: 240) |
| `… devices` (JSON) | 4 dispositivos | `bluetooth.devices` — descartar a entrada com MAC inválido (`DELL 7FHHV94` / `248`) e relatar |
| `osd-volume-number adapt-panel-menu` | `false` | `volume.adapt-panel-menu` |
| `spotify-controls position` | `'mid-right'` | `media.panel-position` |
| `… controls-position` | `'right'` | `media.controls-position` |
| `… show-playback-controls` / `show-track-info` / `show-spotify-icon` | default | `media.show-controls` / `.show-track-info` / `.show-player-icon` |
| `… enable-volume-control` / `enable-middle-click` / `minimize-on-second-click` | default | correspondentes em `media.*` |
| `… max-width` | default | `media.max-width` |
| `Logo-menu use-custom-icon/symbolic-icon/menu-button-icon-image` | `false/false/0` | `menu.icon-source` / `menu.symbolic` / `menu.icon-index` |
| `… menu-button-icon-size` | `19` | `menu.icon-size` |
| `… show-activities-button` | `false` | `panel.show-activities` |
| `… menu-button-extensions-app` | Extension Manager | `menu.extensions-app` |

## 5. Não migrado

| Item | Motivo |
|---|---|
| — | — |
| `rounded-window-corners-reborn` (resíduo em dconf) | extensão não instalada |
| Atalhos globais do Mutter (`Super+W`, `Super+Z`, `Ctrl+Super+←→`, screenshots) | pertencem ao GNOME, não à extensão; o GnomeCustom deve **detectar colisão** com eles, não movê-los |
| `favorite-apps` | chave do próprio Shell; o dock lê a original |

## 6. Interface

```
Preferências ▸ Avançado ▸ Importar configuração
  [ Importar do Dash to Dock ]   [ Importar do Forge ]
  [ Importar do Open Bar ]       [ Importar dos módulos menores ]
  [ Importar do Spotify Controls ]
  [ Importar tudo (baseline) ]
```

Cada importação abre um relatório: chaves migradas, convertidas, descartadas e por quê.

## 7. Reversão

Antes de qualquer importação, gravar `advanced.pre-migration-backup` com um dump das
chaves do GnomeCustom. `[ Reverter última importação ]` restaura esse dump.
A configuração das extensões originais nunca é tocada, então desabilitar o GnomeCustom
e reabilitar as extensões antigas sempre funciona.
