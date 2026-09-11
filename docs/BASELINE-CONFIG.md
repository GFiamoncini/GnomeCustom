# BASELINE-CONFIG.md

Estado atual da máquina do usuário — o **baseline funcional** exigido pela §10 do
briefing. A primeira versão do GnomeCustom deve reproduzir *este* comportamento
antes de adicionar qualquer coisa nova.

Capturado em 2026-09-09. Dumps brutos e versionados em `baseline/`.

---

## 0. Ambiente

| Item | Valor |
|---|---|
| Distribuição | Fedora release 43 (Forty Three) |
| GNOME Shell | **49.9** |
| Sessão | Wayland |
| Arquitetura | x86_64 |
| Monitores | `eDP-1` (notebook, à esquerda) + `HDMI-1` (LG ultrawide 2560×1080, **primário**, à direita) |
| Ferramentas | `git`, `gjs`, `make`, `node`, `npm`, `msgfmt`, `glib-compile-schemas`, `gnome-extensions` |
| Ausente | **`meson`** → build do projeto usa `Make` (§ do briefing já prevê preferir Make) |

### Repositório em NTFS — atenção
`/mnt/3C0CEC910CEC478A` é `fuseblk` (ntfs-3g) montado com `user_id=0`, logo todos os
arquivos aparecem como `root:root 0777`. Consequências já contornadas:

- `git config --global --add safe.directory <caminho>` foi necessário (para o
  projeto e para cada clone em `reference/`);
- `core.filemode = false` no repositório (bits de permissão são sintéticos);
- symlinks, bit de execução e *case sensitivity* **funcionam** (testados).

## 1. Configuração global do GNOME relevante

| Chave | Valor | Impacto no projeto |
|---|---|---|
| `org.gnome.desktop.interface enable-animations` | **`false`** | **Animações desligadas globalmente** → o módulo Animation é hoje inócuo (ver §3.6) |
| `interface color-scheme` | `prefer-dark` | Theme Engine precisa de paletas dark |
| `interface gtk-theme` | `Orchis-Grey-Dark-Compact` | idem ao shell theme |
| `interface icon-theme` | `Tela-nord-dark` | ícones do Logo Menu devem vir do tema |
| `interface font-name` | `Adwaita Sans 11` | Open Bar usa `default-font='Sans 12'` (divergente) |
| `mutter dynamic-workspaces` | `false` | — |
| `wm.preferences num-workspaces` | **`1`** | **workspace único e estático**: tiling e thumbnails devem funcionar nesse cenário |
| `mutter workspaces-only-on-primary` | `true` | workspaces só no HDMI-1 |
| `mutter edge-tiling` | `false` | edge-tiling nativo desligado (Forge assume o papel) |
| `mutter center-new-windows` | `false` | — |
| `wm.preferences button-layout` | `appmenu:minimize,maximize,close` | — |

### Atalhos globais customizados (não-default)
| Atalho | Ação |
|---|---|
| `Super+W` | `close` |
| `Super+Z` | `minimize` |
| `Ctrl+Super+←/→` | `move-to-monitor-left/right` (**este é o caminho nativo de mover janela entre monitores**) |
| `Shift+Super+S` | `screenshot` |
| `Ctrl+S` | `show-screenshot-ui` |
| desativados | `maximize`, `unmaximize`, `switch-group(-backward)`, `move-to-monitor-up/down`, `move-to-workspace-1/last` |

> Observação: `Ctrl+S` como atalho global de captura de tela intercepta o "salvar"
> de aplicações. Não é assunto do GnomeCustom, mas fica registrado.

## 2. Extensões habilitadas (11)

| UUID | Nome | Versão instalada | Coberta pelo projeto? |
|---|---|---|---|
| `apps-menu@…gcampax…` | Apps Menu (Classic) | 70 | sim → `modules/panel` |
| `user-theme@…gcampax…` | User Themes | 69 | sim → `modules/theme` |
| `dash-to-dock@micxgx.gmail.com` | Dash to Dock | 105 | sim → `modules/dock` |
| `forge@jmmaranan.com` | Forge | 89 | sim → `modules/tiling` |
| `openbar@neuromorph` | Open Bar | 49 | sim → `modules/theme` |
| `bluetooth-battery@michalw.github.com` | Bluetooth battery indicator | 46 | sim → `modules/bluetooth` |
| `osd-volume-number@deminder` | OSD Volume Number | 14 | sim → `modules/volume` |
| `gnome-ui-tune@itstime.tech` | Gnome 4x UI Improvements | 25 | sim → `modules/overview` |
| `impatience@gfxmonk.net` | Impatience | 30 | sim → `modules/animation` |
| `logomenu@aryan_k` | Logo Menu | 43 (24.8) | sim → `modules/menu` |
| `spotify-controls@Sonath21` | Spotify Controls + Track Info | 15 | sim → `modules/media` (incluído por decisão do usuário) |

Instaladas e desabilitadas: `background-logo`, `launch-new-instance`, `places-menu`, `window-list`.

> Nota terminológica: o briefing fala em "AppMenu". A extensão realmente habilitada é
> **`apps-menu`** (Apps Menu do Classic Mode: menu de aplicações por categoria no painel),
> não o antigo indicador de aplicativo do painel. O baseline é o `apps-menu`.

Resíduo: existe `/org/gnome/shell/extensions/rounded-window-corners-reborn/` em dconf
sem extensão instalada. Ignorar (candidato a limpeza).

## 3. Configuração por extensão

Todas as chaves não listadas estão no default da respectiva extensão.

### 3.1 Dash to Dock → `modules/dock`
```
dock-fixed = true                       # dock sempre visível, sem auto-hide
dock-position = 'BOTTOM'
height-fraction = 0.90
dash-max-icon-size = 24
preferred-monitor-by-connector = 'HDMI-1'   # dock no ultrawide
preferred-monitor = -2
running-indicator-style = 'DOTS'
transparency-mode = 'FIXED'
background-opacity = 0.0                # dock totalmente transparente
custom-theme-shrink = true
show-show-apps-button = false
show-trash = false
show-mounts = false
show-icons-emblems = false
```
Leitura funcional: dock **fixo, no rodapé do monitor HDMI-1, transparente, ícones
pequenos (24px), compacto, com indicador de pontos, sem botão de apps, sem lixeira,
sem volumes montados e sem emblemas**. Sem auto-hide nem intellihide → a Fase 3 pode
tratar auto-hide/intellihide como funcionalidade *não* exigida pelo baseline.

Favoritos (`org.gnome.shell favorite-apps`): 23 itens — ver `baseline/dconf-shell.ini`.

### 3.2 Forge → `modules/tiling`
```
tiling-mode-enabled = true
auto-split-enabled = false              # sem split automático
window-gap-size = 2  (increment 1)
window-gap-hidden-on-single = true      # "smart gaps"
float-always-on-top-enabled = true
focus-border-toggle = true
focus-on-hover-enabled = false
move-pointer-focus-enabled = false
preview-hint-enabled = true
quick-settings-enabled = true
stacked-tiling-mode-enabled = false
tabbed-tiling-mode-enabled = false
```
Atalhos (40 mapeados — íntegra em `baseline/dconf-ext-forge.ini`):

| Grupo | Atalhos |
|---|---|
| Foco | `Super+←↑↓→` |
| Mover | `Shift+Super+←↑↓→` |
| Trocar (swap) | `Ctrl+Super+H/J/K/L`, último ativo `Super+Return` |
| Split | horizontal `Super+K`, vertical `Super+V`, alternar `Super+G` |
| Float | `Super+C` (janela), `Shift+Super+C` (sempre) |
| Layout | stacked `Shift+Super+A`, tabbed `Shift+Super+T`, decoração de aba `Ctrl+Alt+Y` |
| Gaps | `Ctrl+Super+ +/-` |
| Resize | `Ctrl+Super+Y/U/I/O` (aumentar), `Shift+Ctrl+Super+Y/U/I/O` (diminuir) |
| Snap | centro `Ctrl+Alt+C`, 1/3 `Ctrl+Alt+D/G`, 2/3 `Ctrl+Alt+E/T` |
| Outros | borda de foco `Super+X`, prefs `Shift+Super+P`, tile do workspace `Shift+Super+W` |
| Mouse | `mod-mask-mouse-tile = 'None'` |

Estado extra fora do GSettings — **precisa de equivalente no novo projeto**:
- `~/.config/forge/config/windows.json`: **32 regras de override** por `wmClass`/`wmTitle`
  (JetBrains splash, ddterm, Guake, Conky, Zoom, Calculator, diálogos do Firefox, etc.);
- `~/.config/forge/stylesheet/forge/stylesheet.css`: CSS de bordas/abas customizado
  (tiled `#EC5E5E`, split `#FFF66C`, stacked `#F7A22B`, tabbed `#11C7E0`, floated `#B4A7D6`,
  raio 14px, borda 3px).

> **Bug ativo no baseline — não reproduzir.** Entre as 32 regras há **4 overrides
> "fantasma" por `wmId`** (`org.gnome.Ptyxis` 304602141, `org.gnome.TextEditor` 304602148,
> `org.gnome.Nautilus` 304602150, `google-chrome` 304602159), gravados por `Shift+Super+C`.
> `wmId` é volátil entre sessões, então essas regras deixam os apps presos em float.
> O `modules/tiling` **não deve** persistir regras por id de janela — apenas por
> `wmClass`/`wmTitle`, e "sempre flutuar" deve ser por classe.

### 3.3 Open Bar → `modules/theme`
```
bartype = 'Floating'      height = 29     margin = 1.5    bottom-margin = 2.1
bradius = 15              bwidth = 2      balpha = 0.5    bgalpha = 0.90
neon = false              dshadow = false dborder = false menustyle = false
apply-menu-shell = false  fitts-widgets = true
bg-change = true          bguri = 'file:///home/gf/.config/background'
hcolor / bgcolor2 = (0.110, 0.443, 0.847)      # accent azul
palette1..12 = paleta extraída do wallpaper (tons terrosos/laranja)
monitor-width = 2560   monitor-height = 1080
default-font = 'Sans 12'
autofg/autohg (bar e menu) = false
```
Leitura funcional: **barra flutuante**, 29px de altura, cantos de 15px, borda de 2px,
fundo a 90% de opacidade, **paleta derivada automaticamente do wallpaper**, accent azul
fixo, sem neon/sombra, sem tematização de menus e sem aplicar tema ao Shell/GTK.
As 12 cores de paleta existem em 3 variantes (neutra/light/dark) — o Theme Engine
precisa do mesmo conceito de *paleta extraída do fundo de tela*.

### 3.4 User Themes → `modules/theme`
```
name = 'Orchis-Grey-Dark-Compact'
```
Tema de Shell instalado pelo usuário. O Theme Engine precisa **coexistir** com um
shell theme externo, não substituí-lo.

### 3.5 GNOME UI Tune → `modules/overview`
```
increase-thumbnails-size = '100%'
```
**Correção (2026-09-10):** no enum da extensão, `'100%'` vale 5 e a escala aplicada é
`5 / 100 = 0.05` — exatamente o `MAX_THUMBNAIL_SCALE` padrão do GNOME Shell 49; a própria
extensão não altera nada nesse caso. O usuário **não** usa miniaturas ampliadas (o
padrão da extensão, `'200%'`, é que dobraria).

Demais recursos no default da extensão (esconder busca até digitar, wallpaper nos
thumbnails, thumbnails com workspace único, PiP do Firefox — todos ligados por
padrão na v25). Com `num-workspaces = 1`, o recurso "mostrar thumbnails mesmo com
um único workspace" é **essencial** para o baseline.

### 3.6 Impatience → `modules/animation`
```
/org/gnome/shell/extensions/net/gfxmonk/impatience/speed-factor = 0.25
```
Animações 4× mais rápidas — **porém** `enable-animations = false` globalmente, o que
torna o fator irrelevante hoje. Decisão de projeto: o módulo Animation deve (a)
detectar `enable-animations` e (b) informar na UI que o fator não tem efeito enquanto
as animações estiverem desligadas.

### 3.7 Bluetooth Battery Indicator → `modules/bluetooth`
```
hide-indicator = true      # sem ícone no painel; percentual só no menu
interval = 4               # minutos entre atualizações
devices = 4 dispositivos:
  JBL Tune 720BT                     84:D3:52:AB:7E:D7
  AULA-F99Pro 5.0                    F6:A0:03:AE:F8:38   (icon input-keyboard-symbolic, isActive)
  Sony DualSense Wireless Controller  d0:bc:c1:7c:76:f1
  DELL 7FHHV94                       248                 (mac inválido — resíduo)
```
Leitura funcional: apenas **1 dispositivo ativo** (o teclado AULA). O módulo precisa
de lista de dispositivos com ícone e flag de ativo, além de tolerar entradas inválidas.

### 3.8 OSD Volume Number → `modules/volume`
```
adapt-panel-menu = false
```
Substitui o ícone do OSD de volume pelo número, sem adaptar o menu do painel.

### 3.9 Logo Menu → `modules/menu`
```
use-custom-icon = false      symbolic-icon = false     menu-button-icon-image = 0
menu-button-icon-size = 19
show-activities-button = false
menu-button-extensions-app = 'com.mattjakeman.ExtensionManager.desktop'
```
Leitura funcional: logo da distro (Fedora, ícone colorido, 19px), sem botão
Activities, e "Extensões" abre o **Extension Manager**.

### 3.10 Spotify Controls → `modules/media`
```
position = 'mid-right'
controls-position = 'right'
```
Demais 7 chaves no default (info da faixa, botões de playback, ícone do Spotify,
scroll de volume, clique do meio, minimizar no 2º clique, largura máxima — todos ligados).
Leitura funcional: bloco de mídia **no centro-direita do painel, com os controles à
direita da info da faixa**.

## 4. Baseline como critério de aceite

O MVP está funcionalmente equivalente quando, com **todas as 10 extensões originais
desabilitadas**, o desktop apresenta: dock fixo transparente no rodapé do HDMI-1 com
ícones 24px e indicador de pontos; barra flutuante 29px com cantos arredondados e
paleta do wallpaper; tiling com gaps de 2px escondidos em janela única e os 40 atalhos
acima; overview com thumbnails (tamanho padrão) e wallpaper mesmo com workspace único; número no OSD
de volume; bateria do teclado Bluetooth no menu; logo do Fedora no canto; info da faixa e
controles de mídia no centro-direita do painel; e o shell
theme `Orchis-Grey-Dark-Compact` preservado.
