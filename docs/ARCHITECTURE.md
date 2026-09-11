# ARCHITECTURE.md

Arquitetura do GnomeCustom, derivada da auditoria (`PROJECT-AUDIT.md`) e do baseline
(`BASELINE-CONFIG.md`).

---

## 1. Identidade

| | |
|---|---|
| Nome | GnomeCustom |
| UUID | `gnomeCustom@gfiamoncini.com` |
| Esquema base | `org.gnome.shell.extensions.gnomecustom` (id em minúsculas, por convenção) |
| Caminho dconf | `/org/gnome/shell/extensions/gnomecustom/` |
| Prefixo de log | `[GnomeCustom]` |
| Licença | `GPL-3.0-or-later` (ver `LICENSE-AUDIT.md` §3) |
| Build | `Makefile` |

## 2. Camadas

```
prefs/  (processo separado, GTK4/Adwaita)
   │  GSettings
   ▼
core/  ──► settings, lifecycle, module manager, logger, compat, signals, migration
   │
   ▼
modules/  ──► uma unidade funcional por módulo, ativável isoladamente
   │
   ▼
services/  ──► ÚNICO ponto de contato com APIs do GNOME/Shell/D-Bus
   │
   ▼
GNOME Shell 49 / Mutter / UPower / BlueZ / GSound
```

Regra de dependência: **as flechas só apontam para baixo.**
`services/` nunca importa `modules/`. `modules/` nunca importa
`resource:///org/gnome/shell/ui/*`. `ui/` é consumido por `modules/`, não o contrário.

## 3. Estrutura de diretórios

```
gnomeCustom@gfiamoncini.com/
├── metadata.json
├── extension.js              # apenas: instancia Core e delega
├── prefs.js                  # apenas: monta prefs/
├── stylesheet.css            # estático mínimo; o dinâmico vem do Theme Engine
├── core/                     # sem imports do Shell: testável com gjs puro
│   ├── context.js            # Context + ModuleContext (escopo por módulo)
│   ├── lifecycle.js          # ordem de enable/disable, rollback em erro
│   ├── module.js             # classe base dos módulos
│   ├── module-manager.js     # registro, dependências, ativação por chave
│   ├── services.js           # registro de serviços com criação tardia
│   ├── settings.js           # acesso tipado a GSettings + observadores
│   ├── logger.js             # níveis debug/info/warn/error/silent
│   ├── signals.js            # SignalTracker: sinais e fontes do loop
│   ├── patcher.js            # wrapper sobre InjectionManager, com reversão
│   ├── compatibility.js      # versão do Shell + feature flags
│   └── migration/            # importadores das extensões originais (fase 9)
├── lib/                      # dados puros, compartilhados com o processo de prefs
│   ├── known-extensions.js   # as 11 extensões substituídas e o módulo de cada
│   └── modules-info.js       # catálogo de módulos para a UI
├── modules/
│   ├── panel/                # apps-menu, botão Activities, ordenação
│   ├── menu/                 # Logo Menu
│   ├── bluetooth/            # bateria de dispositivos
│   ├── volume/               # OSD numérico
│   ├── media/                # controles MPRIS no painel (Spotify e outros)
│   ├── dock/
│   ├── tiling/
│   │   ├── module.js
│   │   ├── tree.js           # árvore de containers (i3-like)
│   │   ├── layout.js         # cálculo de geometria + gaps
│   │   ├── keybindings.js
│   │   └── rules.js          # overrides por wmClass/wmTitle
│   ├── overview/
│   ├── animation/
│   ├── theme/
│   └── diagnostics/          # Conflict Detector (implementado)
├── services/
│   ├── shell/                # panel, overview, workspaces, layout,
│   │                         # window-manager, dash, osd, notifications, quick-settings
│   ├── bluetooth/            # BlueZ + UPower via D-Bus
│   ├── audio/                # volume via Gvc
│   ├── mpris/                # org.mpris.MediaPlayer2 via Gio.DBus
│   ├── windows/              # Meta.Window normalizado
│   ├── applications/         # Shell.AppSystem, favoritos
│   └── system/               # distro, sessão, monitores, wallpaper
├── ui/
│   ├── panel/  dock/  menu/  overview/  osd/  media/
├── theme/
│   ├── engine/
│   │   ├── color.js          # hex/rgba, luminância e contraste (WCAG)
│   │   ├── quantize.js       # corte mediano: papel de parede → paleta
│   │   ├── tokens.js         # configuração + paleta → modelo de estilo
│   │   └── stylesheet.js     # tokens → CSS do Shell
│   └── presets/              # (fase 7)
├── prefs/
│   └── pages/                # general, panel, dock, tiling, overview,
│                             # animation, media, theme, advanced
├── schemas/
├── po/
└── tests/
```

## 4. Contrato de módulo

```javascript
export class Module {
    /** @param {Context} context  settings, logger, services, patcher, signals */
    constructor(context) { this._ctx = context; }

    /** chave GSettings que liga/desliga este módulo */
    static get settingsKey() { return 'x-enabled'; }

    /** nomes dos serviços exigidos; o manager falha cedo se faltar */
    static get requires() { return []; }

    enable() {}      // idempotente
    disable() {}     // reverte TUDO que enable() fez
    destroy() {}     // libera recursos permanentes
}
```

Invariantes:
1. `disable()` restaura o estado anterior do GNOME. Nenhum patch, signal, actor ou
   timeout sobrevive.
2. Nenhum módulo consulta a existência de outro módulo — só a própria chave de settings
   (§6 do briefing).
3. Uma exceção em `enable()` de um módulo **não** derruba os demais: `lifecycle.js`
   captura, registra, faz rollback daquele módulo e segue.
4. Nada de I/O síncrono. Leitura de wallpaper, D-Bus e arquivos sempre assíncronos.

## 5. Ciclo de vida

```
enable()
  ├─ Compatibility.detect()          # versão do Shell, feature flags
  ├─ Logger.init(level)
  ├─ Settings.open()
  ├─ Migration.runIfNeeded()         # só na primeira execução
  ├─ Services.create()               # lazy: só o que os módulos habilitados pedem
  ├─ ModuleManager.enableAll()       # ordem fixa, ver abaixo
  └─ Settings.watch()                # mudança de chave -> enable/disable a quente

disable()   (ordem inversa exata)
  ├─ Settings.unwatch()
  ├─ ModuleManager.disableAll()
  ├─ Patcher.revertAll()
  ├─ Signals.disconnectAll()
  ├─ Services.destroy()
  └─ Logger.flush()
```

Ordem de ativação (a de desativação é o inverso):
`theme → panel → menu → bluetooth → volume → media → dock → overview → animation → tiling → diagnostics`

O Theme Engine vem primeiro para que os módulos de UI já nasçam estilizados; o tiling
vem por último porque reage a janelas já existentes.

## 6. Theme Engine

```
system/wallpaper ──► palette (quantize) ──┐
settings (cores, alfa, raio, margens) ────┼──► style model ──► CSS gerado ──► St.Theme
user shell theme (Orchis-…) ──────────────┘
```

- Um **modelo de estilo** único (tokens: cor, alfa, raio, espessura, altura, margem).
- Cada consumidor (`panel`, `dock`, `menu`, `osd`, `tiling border`) pede tokens ao
  engine — nunca escreve CSS próprio.
- O CSS gerado é carregado como folha adicional, **somando-se** ao shell theme do
  usuário; jamais o substitui (o baseline usa `Orchis-Grey-Dark-Compact`).
- Regeneração é *debounced* e assíncrona (troca de wallpaper não pode travar o loop).

## 7. Configuração

Um esquema por área, todos sob o mesmo caminho:

```
org.gnome.shell.extensions.gnomecustom            # general + chaves *-enabled
org.gnome.shell.extensions.gnomecustom.panel
                                    .menu
                                    .media
                                    .dock
                                    .tiling
                                    .tiling.keybindings
                                    .overview
                                    .bluetooth
                                    .volume
                                    .animation
                                    .theme
                                    .advanced
```

Chaves-interruptor (§8 do briefing): `panel-enabled`, `menu-enabled`, `dock-enabled`,
`tiling-enabled`, `overview-enabled`, `bluetooth-enabled`, `volume-enabled`,
`animation-enabled`, `media-enabled`, `theme-enabled`.

As ~491 chaves das fontes **não** são reproduzidas. O critério de inclusão de uma chave
na v1 é: *existe no baseline do usuário* ou *é necessária para o módulo funcionar*.
Estimativa: 90–120 chaves na v1.

## 8. Decisões arquiteturais registradas

| # | Decisão | Motivo |
|---|---|---|
| AD-1 | Licença GPL-3.0-or-later | `LICENSE-AUDIT.md` §3 |
| AD-2 | Nenhum código de logomenu/bluetooth-battery/gnome-ui-tune | licenças sem cláusula *or later* |
| AD-3 | `InjectionManager` como único mecanismo de patch | reversibilidade e sobrevivência a upgrades |
| AD-4 | `services/shell/` como única fronteira com API interna | §15 do briefing; validado pela contagem de acoplamento |
| AD-5 | Regras de tiling só por `wmClass`/`wmTitle`, nunca `wmId` | bug ativo do Forge no baseline |
| AD-6 | Auto-hide/intellihide fora do MVP | ausentes do baseline (`dock-fixed=true`) |
| AD-7 | Build por `Makefile` | `meson` ausente no ambiente |
| AD-8 | Theme Engine soma-se ao shell theme, não o substitui | baseline usa User Themes ativo |
| AD-9 | Falha de um módulo não derruba os outros | a extensão roda dentro do Shell (§14) |
| AD-10 | `modules/media` é MPRIS genérico, não específico do Spotify | mesmo custo, serve a qualquer player; Spotify vira o padrão |
| AD-11 | `core/` não importa nada de `resource:///org/gnome/shell/` | dependências entram por injeção, o que torna o ciclo de vida completo testável fora do Shell (`make test`) |
| AD-12 | As páginas de preferências recebem a função de tradução por parâmetro | não amarra as páginas ao processo de preferências e permite montá-las em teste (`make test-prefs`) |
| AD-13 | Idioma-fonte das strings é o inglês; pt-BR vem do `.po` | convenção do ecossistema GNOME e do extensions.gnome.org |
| AD-14 | O Theme Engine só assume as **cores** quando há fundo resolvido | sem paleta e sem cor explícita, o CSS traz apenas geometria e o tema do usuário continua no comando |
| AD-15 | O texto do painel é escolhido por contraste mínimo de 4.5:1 (WCAG AA) | a cor de fundo vem do papel de parede e pode ser qualquer uma; legibilidade não pode depender de sorte |
| AD-16 | Uma única folha gerada, em caminho estável no diretório de execução | reescrever o mesmo arquivo com `unload`+`load` é o caminho que o Open Bar validou, e não acumula arquivos |
| AD-17 | O logotipo da distribuição vem do campo `LOGO` do `os-release` | nenhuma imagem é embarcada, o que também dispensa auditar licença de ícones |
| AD-18 | Regras de tiling e ações de energia passam por serviços do GNOME (`SystemActions`), não por `systemctl` | respeita inibidores, polkit e disponibilidade real |
