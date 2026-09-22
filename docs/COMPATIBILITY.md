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

## 6. GNOME 50: avaliação (Fase 9, 2026-09-13)

**Decisão: não declarar suporte ao GNOME 50.** A regra do projeto (§1) é só declarar
versão efetivamente testada, e não há GNOME 50 disponível nesta máquina (Fedora 43 traz o
49.9). `metadata.json` continua com `"shell-version": ["49"]`.

O que o levantamento mostra sobre o risco de uma atualização. O código declara 41 pontos de
API interna com o comentário `// GNOME 49:` — todos em `services/`, como previsto em §2:

| Risco | Onde | Por quê |
|---|---|---|
| **Alto** | `services/shell/dash.js` | campos privados do Dash (`_box`, `_showAppsIcon`, `_background`, `_separator`, `_maxWidth`) e do `AppIcon` (`_iconContainer`, `_dot`, `_updateRunningStyle`) |
| **Alto** | `services/shell/overview.js` + `modules/overview` | `Main.overview._overview.controls._thumbnailsBox`; 4 patches de protótipo (`_updateShouldShow`, `_init`, `_isOverviewWindow` ×2) |
| **Alto** | `services/shell/osd.js` + `modules/volume` | campos privados do `OsdWindow` (`_hbox`, `_icon`, `_vbox`, `_level`) e patch de `show` |
| Médio | `services/shell/windows.js` | assinatura de `unmaximize()` já mudou no 49; tem ramo de reserva |
| Médio | `services/shell/theme.js` | `Main.loadTheme` e o comportamento de `changed` do St (ver armadilhas registradas) |
| Baixo | painel, atalhos, apps, sessão, quick settings, extensões | APIs usadas por quase toda extensão de painel; mudanças costumam ser anunciadas |

Referências externas: o Dash to Dock (v106) e o Forge upstream já declaram o 50, e ambos tocam
nas mesmas regiões de alto risco — é o primeiro lugar a comparar quando o 50 chegar.

### Roteiro para declarar o 50
1. `make check` num sistema com GNOME 50 (os testes do núcleo e das preferências não dependem
   da versão; se falharem, é regressão de GJS/Adw).
2. Sessão isolada (`make nested` ou o roteiro headless registrado) com **todos os módulos**
   ligados e `strict-cleanup-check`: ciclos de ativação sem CRITICAL e com "nada pendente".
3. Conferir um a um os pontos de risco alto da tabela, com uma janela real e as capturas.
4. Só então acrescentar `"50"` a `shell-version` e registrar o resultado aqui.

## 7. Fedora 44 / GNOME 50: auditoria por inspeção (2026-09-20)

Pedido do usuário: dá para atualizar o Fedora 43 → 44? O Fedora 44 traz **GNOME Shell 50.5,
Mutter 50.5, GJS 1.88, GTK 4.22 e libadwaita 1.9** (consultado com `dnf --releasever=44
repoquery`). Sem GNOME 50 nesta máquina, a conferência foi feita **lendo o código do 50**: os
pacotes `gnome-shell` e `mutter-devel` do Fedora 44 foram baixados e o JavaScript do Shell
extraído da seção ELF `.gresource.shell_js_resources` de `libshell-18.so` (152 arquivos), mais
o `Meta-18.gir` do Mutter.

Resultado, ponto a ponto dos 41 usos de API interna declarados no código:

| Área | Situação no GNOME 50 |
|---|---|
| Dock (`Dash._box`, `_showAppsIcon`, `_background`, `_separator`, `_maxWidth`) | **inalterados** |
| Dock (`DashIcon`) | segue herdando de `AppDisplay.AppIcon`; `_iconContainer`, `_dot`, `_updateRunningStyle()` e `animateLaunch()` continuam lá |
| OSD (`OsdWindow._hbox/_icon/_vbox/_level`, `prototype.show`) | **inalterados**; `BarLevel` mantém `value`/`maximum-value` |
| Visão geral (`controls._thumbnailsBox`, `ThumbnailsBox._updateShouldShow`, `_shouldShow`, sinal `should-show`, `WorkspaceThumbnail._init`, `_isOverviewWindow`, `_contents`, `monitorIndex`, `Workspace._isOverviewWindow`) | **inalterados** |
| Painel (`addToStatusArea`, `statusArea`, `menuManager`, `sessionMode.panel.*`, `addExternalIndicator`) | **inalterados** (o `addExternalIndicator` mora em `ui/panel.js`) |
| `Main.*` (`activateWindow`, `setThemeStylesheet`, `loadTheme`, `pushModal`/`popModal`, `extensionManager`), `wm.addKeybinding`/`removeKeybinding` | **inalterados** |
| Mutter (`unmaximize()` sem argumento, `set_unmaximize_flags`, `move_resize_frame`, `get_frame_rect`, `make_above`/`unmake_above`/`is_above`, propriedades `resizeable`, `minimized`, `fullscreen`, `skip-taskbar`, `wm-class`, `title`) | **inalterados** no `Meta-18.gir` |
| Preferências (`ExtensionPreferences.fillPreferencesWindow` recebendo `Adw.PreferencesWindow`) | **inalterado**; o menu lateral de `prefs/layout.js` continua válido |
| Classes de CSS usadas (`#panel`, `.panel-button`, `.popup-menu-content`, `.osd-window`, `.quick-settings`, `.message*`) | todas presentes no tema padrão do 50 |

### O que **muda** no GNOME 50

**`PanelMenu.Button` deixou de abrir o menu em `vfunc_event`**: agora usa um
`Clutter.ClickGesture` com `recognize_on_press`. Isso quebraria o desvio que impede o clique
nos controles de mídia de abrir o card (`ui/media/indicator.js`). **Já tratado em 2026-09-20**:
o indicador mantém o `vfunc_event` (49) e, quando existe `_clickGesture` (50), desliga o gesto
enquanto o ponteiro está sobre os controles. Não dá para exercitar o caminho do 50 aqui; é o
primeiro ponto a conferir depois da atualização.

### Conclusão

Nada encontrado que impeça a atualização.

**`"50"` declarado em 2026-09-20, antes de executar** — exceção à regra do §1, a pedido
explícito do usuário, para a extensão subir já no primeiro login do Fedora 44. A auditoria
acima é por leitura de código, não por execução: os passos 1 a 3 do roteiro do §6 continuam
pendentes e devem ser rodados na primeira sessão do GNOME 50. Se algo falhar lá, o caminho de
volta é desligar a extensão (`gnome-extensions disable gnomeCustom@gfiamoncini.com`) ou tirar o
`"50"` do `metadata.json`.

### Execução no GNOME 50.5 (Fedora 44, 2026-09-20)

Rodado de verdade, depois da atualização. `metadata.json` declara `["49","50"]` e
`TESTED_MAJORS` passou a `[49, 50]`.

- `make check` no sistema novo (GJS 1.88, GTK 4.22, Adw 1.9): 201 testes do núcleo e as
  páginas de preferências, sem falha.
- Sessão real: extensão `ACTIVE`, **zero JS ERROR**; os únicos avisos são a colisão conhecida
  do `<Super>v` e (antes desta mudança) o "versão não testada".
- Sessão isolada headless com os **11 módulos** ligados e `strict-cleanup-check`: ciclo
  desativar/reativar terminou com "verificação de limpeza: nada pendente"; nenhuma asserção
  durante o uso (as duas vistas acontecem no *desligamento* do Shell de teste, com um
  `StLabel.dash-label` fora do palco).
- Exercitado com entrada real: OSD de volume com número (42), mosaico (layout, foco por seta e
  `Ctrl+Shift+Super+→` crescendo 15 px), dock (1º clique minimiza, 2º restaura), mídia
  (tocar/pausar e próxima pelo botão, card abrindo só pelo nome da faixa).

**Dois defeitos do GNOME 50 achados e corrigidos aqui** (ambos em `ui/media/indicator.js`):

1. `super.vfunc_event()` lança `Class StWidget doesn't implement event` — a classe de base
   deixou de implementar o vfunc. O desvio agora sai antes quando existe `_clickGesture`.
2. A caixa dos controles não era reativa, então `enter-event` nunca disparava e o gesto do menu
   continuava ligado, engolindo o clique nos botões. Agora ela é `reactive` e `track_hover`.

Ainda não exercitado no 50: visão geral (os 4 recursos), Bluetooth (rádio e conectar) e o
PiP do Firefox.

