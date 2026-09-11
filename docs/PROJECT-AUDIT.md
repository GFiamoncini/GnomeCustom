# PROJECT-AUDIT.md

Fase 0 — auditoria das fontes de referência.
Clones rasos (`--depth 1`) em `reference/` (não versionado).
Data: 2026-09-09.

---

## 1. Commits fixados

| Projeto | Origem | Commit | Data | `metadata.json` |
|---|---|---|---|---|
| gnome-shell-extensions | gitlab.gnome.org/GNOME | `a154ca4c6ecc` | 2026-09-09 | por extensão |
| dash-to-dock | github.com/micheleg | `7b1567924917` | 2026-09-08 | v**106**, shell 45–**51** |
| forge | github.com/forge-ext | `46736af63815` | 2026-06-25 | shell 45–**50.1** |
| openbar | github.com/neuromorph | `01fb24217e0c` | **2025-10-05** | v**42**, shell 45–49 |
| bluetooth-battery-indicator | github.com/MichalW | `7b7165d95f15` | 2026-08-25 | shell 45–50 |
| gnome-ui-tune | github.com/axxapy | `c288f0ba1e58` | 2026-06-12 | shell **['50']** |
| osd-volume-number | github.com/Deminder | `8836bcdea124` | 2026-04-18 | v14, shell 45–50 |
| logomenu | github.com/Aryan20 | `cf988c0287e6` | 2026-06-27 | v43 (24.8), shell 49–50 |
| impatience | github.com/timbertson | `f3f145d33d88` | 2026-03-11 | shell 45–50 |
| spotify-controls | github.com/Sonath21 | `6c328e88981a` | 2026-05-01 | v15, shell 45–50 |
| spotify-controller | github.com/NarkAgni | `640d3f6a5fe2` | 2026-03-27 | v5, shell 45–50 (base do `modules/media` desde 2026-09-10) |

Notas de manutenção detectadas:
- **openbar**: o branch `main` está em v42/shell≤49 e sem commits há ~11 meses, mas a
  versão **instalada é a 49**. Existem branches `openbar2.0` e `nixfix` e apenas duas
  tags antigas. Ou seja, o que roda na máquina **não corresponde ao `main` público** →
  ao estudar Open Bar, comparar sempre com `~/.local/share/gnome-shell/extensions/openbar@neuromorph/`.
- **gnome-ui-tune**: upstream já declara **somente GNOME 50**; a versão instalada (25)
  cobre 45–49. Fonte de referência divergente do alvo.
- **forge**: `README` do upstream declara "needs a new maintainer".
- **dash-to-dock**: o mais saudável do conjunto (v106, já declara GNOME 51).

Reprodutibilidade: `reference/` é ignorado pelo git; os commits acima são o registro
canônico. `osd-volume-number` usa Git LFS — clonar com `GIT_LFS_SKIP_SMUDGE=1`
(`git-lfs` não está instalado).

## 2. Tamanho e superfície de API

| Projeto | JS LOC | Arquivos | Chaves GSettings | Módulos internos do Shell importados |
|---|---:|---:|---:|---|
| openbar | 16.470 | 11 | **286** | `main`, `calendar`, `panelMenu`, `layout`, `messageList`, `config` |
| dash-to-dock | 13.739 | 24 | **107** | 20 módulos (`dash`, `appDisplay`, `overview`, `overviewControls`, `workspace*`, `switcherPopup`, `dnd`, `appMenu`, `appFavorites`, `layout`, `searchController`, …) |
| forge | 8.210 | 18 | 69 | `main`, `quickSettings`, `popupMenu`, `config` |
| gnome-shell-extensions | 6.226 | 24 | 1–5 por ext. | `main`, `panelMenu`, `popupMenu`, `dnd`, `workspace`, `windowPreview`, … |
| spotify-controls | 1.439 | 2 | 9 | `main`, `panelMenu` |
| logomenu | 1.240 | 6 | 16 | `main`, `panelMenu`, `popupMenu`, `util`, `config`, `signals` |
| bluetooth-battery-indicator | 582 | 8 | 3 | `main`, `panelMenu`, `popupMenu`, `util` |
| osd-volume-number | 570 | 6 | 3 | `main` |
| gnome-ui-tune | 443 | 11 | 5 | `main`, `workspaceThumbnail`, `workspacesView`, `workspace`, `background` |
| impatience | 123 | 3 | 1 | — (só `extension.js`) |
| **Total** | **~49.000** | | **~500** | |

Conclusão de escala: **Open Bar e Dash to Dock somam 64% do código e 80% das chaves de
configuração.** São eles que definem o custo do projeto, não o Forge.

## 3. Risco por acoplamento a APIs internas

Contagem de acessos a estado interno do Shell (`Main.*` privado, `prototype.x =`,
`Object.defineProperty`, `InjectionManager`):

| Projeto | Risco | Evidência |
|---|---|---|
| dash-to-dock | **Muito alto** | 8× `Object.defineProperty`, `Main.wm._workspaceSwitcherPopup`, `Main.layoutManager._startingUp`, `Main.overview.isDummy` |
| openbar | **Muito alto** | `Main.messageTray._bannerBin` (12×), `Main.layoutManager._bgManagers`, `Main.layoutManager.panelBox` (11×), manipulação direta de pseudo-classes do painel |
| gnome-ui-tune | **Alto** | substitui 6 métodos privados via `prototype._x =` (`_updateShouldShow`, `_getThumbnailsHeight`, `_isOverviewWindow`, `_init`, `_onDestroy`) |
| forge | Médio | usa API pública de keybindings (`Main.wm.addKeybinding`), `Main.wm.allowKeybinding`, `Main.sessionMode` |
| osd-volume-number | Médio | `Main.osdWindowManager._osdWindows`, mas via `InjectionManager` (reversível) |
| logomenu | Baixo | `Main.panel.addToStatusArea`, `Main.overview.toggle` |
| bluetooth-battery-indicator | Baixo | apenas `addToStatusArea` |
| spotify-controls | Baixo | `Main.panel` + `panelMenu`; lógica toda em D-Bus |
| impatience | Muito baixo | nenhum acesso interno |

Isso valida diretamente a §15 do briefing: os pontos que **têm** de ficar isolados em
`services/shell/` são `layoutManager` (painel, chrome, backgrounds, monitores),
`overview`/`overviewControls`, `messageTray`, `osdWindowManager`, `workspaceThumbnail`
e `dash`. `InjectionManager` (API oficial de extensões) deve ser o **único** mecanismo
de patch permitido — `prototype.x =` cru fica proibido.

## 4. Classificação por funcionalidade

`REUSE` = copiar com adaptação mínima · `ADAPT` = derivar do original ·
`REWRITE` = implementação própria · `DROP` = fora de escopo.

| Funcionalidade | Fonte | Licença permite copiar? | Classificação | Justificativa |
|---|---|---|---|---|
| Ciclo de vida / lifecycle | gnome-shell-extensions | sim | **REUSE** (padrão, não código) | seguir os padrões oficiais de `Extension`/`InjectionManager` |
| Apps Menu (menu de aplicações) | gnome-shell-extensions `apps-menu` | sim (GPL-2.0-or-later) | **ADAPT** | código oficial, pequeno, alinhado ao Shell 49 |
| User Theme integration | gnome-shell-extensions `user-theme` | sim | **ADAPT** | 1 chave, trivial; integrar ao Theme Engine |
| Logo Menu | logomenu | **NÃO** (GPL-2.0-only) | **REWRITE** | 1.240 LOC, API simples (`panelMenu` + `popupMenu` + `Util.spawn`) |
| Bluetooth battery | bluetooth-battery-indicator | **NÃO** (GPL-3.0-only) | **REWRITE** | 582 LOC; a lógica real é UPower/BlueZ via D-Bus |
| Volume OSD numérico | osd-volume-number | sim (GPL-3.0-or-later) | **REWRITE** | 570 LOC; mais barato reimplementar sobre `InjectionManager` do que herdar o acoplamento a `_osdWindows` |
| Animation speed | impatience | sim (GPL-3.0-or-later) | **REWRITE** | 123 LOC; é essencialmente `St.Settings.slow_down_factor` |
| Overview tweaks | gnome-ui-tune | **NÃO** (GPL-3.0-only) | **REWRITE** | 443 LOC, mas 6 patches em métodos privados → reescrever com `InjectionManager` |
| Dock | dash-to-dock | sim (GPL-2.0-or-later) | **ADAPT (subconjunto)** | ver §5 |
| Tiling | forge | sim (GPL-3.0-or-later) | **ADAPT (arquitetura)** | árvore i3-like é o valor real; reimplementar a árvore, estudar o original |
| Theme Engine | openbar | sim (GPL-2.0-or-later) | **REWRITE (engine) + ADAPT (algoritmos)** | ver §6 |
| Controles de mídia | spotify-controls | sim (GPL-3.0-or-later) | **ADAPT (generalizando)** | 1.439 LOC, acoplamento mínimo ao Shell; reescrever como MPRIS genérico com Spotify como caso padrão |
| Faixa atual + card (redefinido em 2026-09-10) | spotify-controller | sim (GPL-3.0-or-later) | **ADAPT** | só o card e o cache de capas; ficam de fora controles, playlists, letra e a I/O síncrona do original |

## 5. Dash to Dock — recorte para o baseline

Do baseline do usuário (dock fixo, bottom, HDMI-1, transparente, 24px, DOTS, sem
show-apps/trash/mounts) decorre que a Fase 3 precisa de **muito menos** que as 107 chaves:

**Necessário:** posicionamento (`position`, `monitor por conector`), `dock-fixed`,
`height-fraction`, tamanho de ícone, indicador de janelas em execução (dots),
transparência fixa, modo compacto, clique/scroll em ícone de app, favoritos + janelas,
multi-monitor.

**Adiado:** auto-hide, intellihide, *pressure barrier*, `appSpread`, integração com
`fileManager1API`/`locations`/`desktopIconsIntegration`, `notificationsMonitor`,
emblemas de progresso, menus DBus (`dbusmenuUtils`), `launcherAPI`.

Isso corta aproximadamente metade da complexidade do `docking.js` original sem perder
nada do baseline.

## 6. Open Bar — recorte para o baseline

Das 286 chaves, o baseline usa ~25. O núcleo a reimplementar:
1. **barra flutuante** (`bartype='Floating'`: altura, margens, raio, borda, alfa);
2. **extração de paleta do wallpaper** (`quantize.js` + `autothemes.js`) — este é o
   algoritmo com valor real e é GPL-2.0-or-later, portanto **ADAPT** é legítimo;
3. geração de folha de estilo em runtime (`stylesheets.js`) → base do Theme Engine.

Fora do baseline (adiar): tematização de menus, do Shell inteiro, de apps GTK/Flatpak,
neon/sombras, estilos de calendário e message list (que é justamente a parte mais
acoplada a `Main.messageTray._bannerBin`).

## 7. Conflitos previstos

| Conflito | Origem | Mitigação |
|---|---|---|
| Duas extensões movendo o Dash | GnomeCustom + Dash to Dock | Conflict Detector (§25) + desabilitar D2D |
| Dois gestores de tiling disputando `Main.wm` keybindings | GnomeCustom + Forge | `Main.wm.allowKeybinding` colide; detectar e recusar habilitar `tiling` |
| Duas folhas de estilo do painel | GnomeCustom + Open Bar | detectar e recusar habilitar `theme` |
| `user-theme` duplicado | GnomeCustom + User Themes | ler a mesma chave; nunca gravar as duas |
| Atalhos `Super+←→` | Forge × `toggle-tiled-*` do Mutter | já resolvido no baseline (chaves do Mutter vazias) |
| `Ctrl+Super+←→` | Forge (resize) × `move-to-monitor` do Mutter | **sem colisão**: Forge usa `Ctrl+Super+Y/U/I/O` |
| Estado fora do GSettings | `~/.config/forge/*` | Migration Layer precisa importar `windows.json` |

## 8. Achados que alteram o briefing

1. **Logo Menu e Bluetooth passam de "Adaptar" para "Reimplementar"** por
   incompatibilidade de licença (ver `LICENSE-AUDIT.md` §2.2/§2.3).
2. **Open Bar, não Forge, é o maior risco técnico** (16.5k LOC, 286 chaves, upstream
   `main` defasado da versão instalada).
3. **O baseline dispensa auto-hide/intellihide do dock**, o que reduz muito a Fase 3.
4. **`enable-animations = false`** torna o módulo Animation cosmético hoje.
5. **`num-workspaces = 1`** é um caso de borda permanente para tiling e overview.
6. **Forge tem estado fora do GSettings** (`windows.json`, `stylesheet.css`) com 4
   regras corrompidas por `wmId` — o novo módulo não deve repetir esse desenho.
7. **`meson` não está instalado** → build por `Make`.
8. **`spotify-controls` entrou no escopo** (decisão do usuário) como `modules/media`.
   É a melhor notícia da auditoria: GPL-3.0-or-later (copiável), 9 chaves, e toda a
   lógica em `org.mpris.MediaPlayer2` via `Gio.DBus` — praticamente nenhum acoplamento a
   API interna do Shell. Deve ser implementado como **MPRIS genérico**, com o Spotify
   como player padrão, em vez de amarrado a um único aplicativo.
