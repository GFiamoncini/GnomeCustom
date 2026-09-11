# FEATURE-MATRIX.md

Matriz funcionalidade × configuração atual × nova implementação (§11 do briefing).
Estado: `⬜` não iniciado · `🟡` em andamento · `✅` pronto · `⏸` adiado · `❌` descartado

---

## 1. Panel

| Funcionalidade | Extensão atual | Configuração atual (baseline) | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Menu de aplicações por categoria | apps-menu 70 | default (1 chave) | `ui/panel/apps-menu.js` | ADAPT | ✅ |
| Logo da distro + menu de sistema | Logo Menu 43 | Fedora, colorido, 19px, sem Activities, Extensions→Extension Manager | `modules/menu` | REWRITE | ✅ |
| Bateria de dispositivo Bluetooth | BT Battery 46 | `hide-indicator=true`, `interval=4`, 4 devices (1 ativo) | `modules/bluetooth` + `services/bluetooth` (BlueZ `Battery1`, sem intervalo) | REWRITE | ✅ |
| Card dos conectados, com conectar/desconectar | não existe (pedido do usuário) | — | `ui/bluetooth/indicator.js` | NOVO | ✅ (conectar/desconectar ainda não testado ao vivo) |
| Número no OSD de volume | OSD Volume 14 | `adapt-panel-menu=false` | `modules/volume` + `services/shell/osd.js` | REWRITE | ✅ |
| Botão Activities | Logo Menu | oculto | `modules/panel` | REWRITE | ✅ |
| Faixa atual na barra: mini capa + nome | spotify-controls 15 (substituído) | `position='mid-right'` → **direita**, por decisão do usuário | `modules/media` + `ui/media/indicator.js` | ADAPT (spotify-controller) | ✅ |
| Card: capa redonda, título, artistas / álbum | spotify-controller (referência) | — | `ui/media/indicator.js` | ADAPT | ✅ |
| Tempo decorrido, só leitura | " | — | " | ADAPT | ✅ |
| Fundo do card com a cor da capa | " | — | `services/system/cover-art.js` + `theme/engine/color.js` | ADAPT | ✅ |
| Largura máxima do nome | spotify-controls | default | chave `panel-max-width` | ADAPT | ✅ |
| Players permitidos, configuráveis | não existe | — | `services/mpris` + chave `allowed-players` | NOVO | ✅ |
| Botões de playback, scroll de volume, clique do meio | spotify-controls | default (ligado) | **não implementar**: card sem controles, pedido do usuário | DROP | ❌ |
| Curtir, playlists locais, letra, capa girando | spotify-controller | — | **não implementar**, pedido do usuário | DROP | ❌ |

## 2. Dock

| Funcionalidade | Extensão atual | Configuração atual | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Dash como dock | Dash to Dock 105 | ativo | `modules/dock` + `services/shell/dash.js` | ADAPT | ✅ |
| Posição | " | `BOTTOM` | " | ADAPT | ✅ |
| Modo fixo (sem auto-hide) | " | `dock-fixed=true` | struts; some em tela cheia | ADAPT | ✅ |
| Comprimento | " | `height-fraction=0.90` | chave `length-fraction` | ADAPT | ✅ |
| Tamanho de ícone | " | 24px, `custom-theme-shrink=true` | chave `icon-size` + CSS compacto | ADAPT | ✅ |
| Indicador de execução | " | `DOTS` | pontos por janela, até 4 | ADAPT | ✅ |
| Transparência | " | `FIXED`, opacidade 0.0 | chave `background-opacity` | ADAPT | ✅ |
| Multi-monitor | " | `by-connector='HDMI-1'` | **monitor principal** (decisão do usuário; o conector do LG muda) | ADAPT | ✅ |
| Botão de apps / lixeira / volumes / emblemas | " | todos desligados | não implementados | ADAPT | ✅ |
| Cliques: alternar janelas, Shift minimiza, meio abre nova | " | padrão | `lib/dock.js` | ADAPT | ✅ |
| Dock visível na visão geral, sem dash duplicado | " | padrão | dash da visão geral escondido com a altura do dock | ADAPT | ✅ |
| Miniaturas de janelas no menu de contexto | " | padrão (ligado) | menu do próprio GNOME, com os títulos | ADAPT | ⏸ |
| Auto-hide / intellihide / pressure | " | **não usado** | `modules/dock` (fase pós-MVP) | ADAPT | ⏸ |
| App spread, integração Nautilus, launcher API | " | não usado | — | DROP | ⏸ |

## 3. Window Management (Tiling)

| Funcionalidade | Extensão atual | Configuração atual | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Tiling em árvore | Forge 89 | `tiling-mode-enabled=true` | `modules/tiling` | ADAPT (arquitetura) | ⬜ |
| Split H / V / toggle | " | `Super+K` / `Super+V` / `Super+G` | " | ADAPT | ⬜ |
| Auto-split | " | **desligado** | " | ADAPT | ⬜ |
| Foco direcional | " | `Super+←↑↓→` | " | ADAPT | ⬜ |
| Mover janela | " | `Shift+Super+←↑↓→` | " | ADAPT | ⬜ |
| Swap | " | `Ctrl+Super+H/J/K/L`, `Super+Return` | " | ADAPT | ⬜ |
| Resize | " | `Ctrl+Super+Y/U/I/O` (+`Shift` p/ reduzir) | " | ADAPT | ⬜ |
| Snap (centro, 1/3, 2/3) | " | `Ctrl+Alt+C/D/G/E/T` | " | ADAPT | ⬜ |
| Float por janela / sempre | " | `Super+C` / `Shift+Super+C` | " | ADAPT | ⬜ |
| Float sempre no topo | " | ligado | " | ADAPT | ⬜ |
| Smart gaps | " | `size=2`, oculto em janela única | " | ADAPT | ⬜ |
| Borda de foco + CSS custom | " | ligado, `stylesheet.css` próprio | `modules/tiling` + Theme Engine | ADAPT | ⬜ |
| Regras de override por app | " | `windows.json`, 32 regras | `modules/tiling` (só `wmClass`/`wmTitle`) | REWRITE | ⬜ |
| Override por `wmId` | " | 4 regras corrompidas | **não implementar** | DROP | ❌ |
| Stacked / tabbed | " | desligados | `modules/tiling` (pós-MVP) | ADAPT | ⏸ |
| Foco por hover / mouse tile | " | desligados | " | ADAPT | ⏸ |
| Toggle no Quick Settings | " | ligado | `modules/tiling` | ADAPT | ⬜ |

## 4. Overview

| Funcionalidade | Extensão atual | Configuração atual | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Esconder busca até digitar | UI Tune 25 | ligado (default) | `modules/overview` + `services/shell/overview.js` | REWRITE | ✅ |
| Thumbnails maiores | " | `increase-thumbnails-size='100%'` = escala padrão do GNOME | nada a fazer | DROP | ✅ |
| Wallpaper nos thumbnails | " | ligado | `modules/overview` | REWRITE | ✅ |
| Thumbnails com workspace único | " | ligado (**crítico**: `num-workspaces=1`) | " | REWRITE | ✅ |
| PiP do Firefox no overview | " | ligado | critério próprio: janela do Firefox com `skip_taskbar` | REWRITE | ✅ (não testado ao vivo) |

## 5. Animation

| Funcionalidade | Extensão atual | Configuração atual | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Fator de velocidade | Impatience 30 | `speed-factor=0.25` | `modules/animation` + `services/shell/animation.js` | ADAPT | ✅ |
| Aviso de `enable-animations=false` | — | não existe | página de preferências + log | NOVO | ✅ |

## 6. Theming

| Funcionalidade | Extensão atual | Configuração atual | Nova implementação | Classe | Status |
|---|---|---|---|---|---|
| Barra flutuante | Open Bar 49 | `Floating`, h29, margin 1.5/2.1, raio 15, borda 2 | `theme/engine` + `modules/theme` | REWRITE | ✅ |
| Opacidade de fundo | " | `bgalpha=0.90`, `balpha=0.5` | " | REWRITE | ✅ |
| Paleta extraída do wallpaper | " | `bg-change=true`, 12 cores | `theme/engine/quantize.js` | REWRITE (ver LICENSE-AUDIT §5) | ✅ |
| Cor de destaque | " | `(0.110,0.443,0.847)` = `#1C71D8` | `theme/engine/tokens.js` | REWRITE | ✅ |
| Geração de CSS em runtime | " | — | `theme/engine/stylesheet.js` | REWRITE | ✅ |
| Fitts widgets | " | ligado | `theme/engine/stylesheet.js` | REWRITE | ✅ |
| Shell theme do usuário | User Themes 69 | `Orchis-Grey-Dark-Compact` | `services/shell/theme.js` | REWRITE | ✅ |
| Paleta clara/escura em variantes | " | 3 variantes de 12 cores | uma paleta por papel de parede em uso | DROP | ⏸ |
| Tema de menus | Open Bar | **desligado** | `theme/engine/menu` | REWRITE | ⏸ |
| Tema do Shell / apps GTK-Flatpak | " | **desligado** | — | DROP | ⏸ |
| Neon / sombra / borda dupla | " | desligados | " | REWRITE | ⏸ |

## 7. Sistema

| Funcionalidade | Existe hoje? | Nova implementação | Status |
|---|---|---|---|
| Um único esquema GSettings | não (11 esquemas, ~500 chaves) | `org.gnome.shell.extensions.gnomecustom` (base, 15 chaves) | ✅ base |
| Preferências unificadas | não | `prefs/` (Adwaita): Geral + Avançado | ✅ |
| Logger com níveis | não | `core/logger.js` | ✅ |
| Module manager / lifecycle | não | `core/lifecycle.js` + `core/module-manager.js` | ✅ |
| Isolamento de API interna | não | `services/shell/*` (7) + `services/system/*` (2) | ✅ |
| Atalhos de teclado rastreados | não | `services/shell/keybindings.js` | ✅ |
| Conflict Detector | não | `modules/diagnostics` | ✅ |
| Verificação de limpeza | não | `strict-cleanup-check` + `collectLeaks()` | ✅ |
| Testes automatizados | Forge tem `TESTS.md` | `tests/` (98 do núcleo + 17 das prefs) | ✅ |
| Build reproduzível | não | `Makefile` (build, check, install, pack) | ✅ |
| Tradução pt-BR | parcial | `po/pt_BR.po` (57/57 das strings atuais) | ✅ |
| Migração de config antiga | não | `core/migration/*` | ⬜ |
| Presets/perfis | não | `core/profiles` | ⏸ |
