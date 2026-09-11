# COMPATIBILITY.md

## 1. Alvo

| | Versão | Política |
|---|---|---|
| GNOME Shell | **49** (49.9 na máquina) | alvo primário, único declarado em `metadata.json` até haver teste |
| GNOME Shell | 50 | desejável; declarar só após teste real |
| GNOME Shell | 51+ | avaliar depois |
| Sessão | Wayland | primária |
| Sessão | X11 | compatibilidade secundária, sem código específico |
| Distro | Fedora 43 | única testada |

Regra: **não declarar `shell-version` não testada.** As referências divergem justamente
nesse ponto (dash-to-dock declara até 51; gnome-ui-tune declara *só* 50; openbar até 49).

## 2. Camada de isolamento obrigatória

Todo acesso a API interna do Shell vive em `services/shell/`. Nenhum `modules/*`
importa `resource:///org/gnome/shell/ui/*` diretamente.

| Serviço | Encapsula | APIs internas envolvidas | Risco |
|---|---|---|---|
| `services/shell/panel.js` | painel, status area, pseudo-classes | `Main.panel`, `Main.layoutManager.panelBox` | alto |
| `services/shell/animation.js` | velocidade das animações | `St.Settings.slow_down_factor`, `St.Settings.enable_animations` (API pública do St) | baixo |
| `services/shell/overview.js` | miniaturas, busca, janelas da visão geral | `ThumbnailsBox._updateShouldShow`, `WorkspaceThumbnail._init`/`._isOverviewWindow`/`._contents`, `Workspace._isOverviewWindow`, `Main.overview._overview.controls._thumbnailsBox`, `Main.overview.searchEntry` (St.Bin pai), `searchController` `notify::search-active`, `BackgroundManager` | alto |
| `services/shell/workspaces.js` | thumbnails, views | `workspaceThumbnail`, `workspacesView`, `workspace` | **muito alto** |
| `services/shell/layout.js` | monitores, chrome, backgrounds | `Main.layoutManager`, `_bgManagers` | alto |
| `services/shell/window-manager.js` | keybindings, janelas | `Main.wm`, `Meta.*` | médio |
| `services/shell/dash.js` | dash/dock | subclasses de `Dash`/`DashIcon` (campos `_box`, `_showAppsIcon`, `_background`, `_iconContainer`, `_dot`), `layoutManager.addChrome` com struts, `Main.overview.dash` (escondido com a altura do dock) | **muito alto** |
| `services/shell/osd.js` | OSD | `OsdWindow` (exportada) + `prototype.show`, campos `_hbox`, `_icon`, `_vbox`, `_level`; **não** usa `_osdWindows` | médio |
| `services/shell/notifications.js` | message tray | `Main.messageTray._bannerBin` | alto |
| `services/shell/quick-settings.js` | quick settings | `ui/quickSettings.js` | baixo |
| `services/mpris/` | players de mídia | nenhuma (D-Bus `org.mpris.MediaPlayer2`) | mínimo |

## 3. Regras de patching

1. **Somente `InjectionManager`** (`resource:///org/gnome/shell/extensions/extension.js`).
   Proibido `Prototype.method = ...` cru e `Object.defineProperty` sobre objetos do Shell —
   é exatamente o padrão que torna gnome-ui-tune e dash-to-dock frágeis a cada release.
2. Todo patch é registrado e revertido em `disable()`.
3. Toda API interna acessada é declarada em `services/shell/<x>.js` com o comentário
   `// GNOME 49: <caminho da API>` para facilitar o diff em upgrades.
4. `core/compatibility.js` expõe a versão do Shell (`misc/config.js`) e *feature flags*;
   módulos consultam capacidade, nunca número de versão espalhado pelo código.

## 4. Wayland

Proibidos: `xrandr`, `wmctrl`, `xdotool`, `xprop`, qualquer chamada X11 direta.
Usar `Meta`/`Clutter`/`St` e D-Bus (`org.gnome.Mutter.DisplayConfig` para monitores).
Force Quit (do Logo Menu) precisa de caminho Wayland — via `Meta.Window.kill()` ou
`Shell.WindowTracker`, não `xkill`.

## 5. Restrições do ambiente de build

- `meson` **não instalado** → build/instalação por `Makefile`.
- `git-lfs` não instalado (afeta apenas o clone de referência do osd-volume-number).
- Repositório em NTFS (`fuseblk`, `user_id=0`): exige `safe.directory` e
  `core.filemode=false`. Symlink/exec/case-sensitivity verificados e funcionais.
- Instalação em desenvolvimento: symlink de
  `~/.local/share/gnome-shell/extensions/<uuid>` → diretório do projeto.
- Wayland não recarrega o Shell sem logout: `Alt+F2 r` só existe no X11. Prever
  `make test-session` usando uma sessão aninhada
  (`dbus-run-session -- gnome-shell --nested --wayland`).
