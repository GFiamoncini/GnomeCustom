# ROADMAP.md

Ordem derivada da §32 do briefing, ajustada pelos achados da auditoria.

Ajustes em relação ao briefing:
- **Theme Engine sobe de posição.** É pré-requisito visual do painel e do dock, e é o
  maior risco técnico (16.5k LOC / 286 chaves em Open Bar). Entra em duas etapas: um
  núcleo mínimo na Fase 2 e o restante na Fase 7.
- **Tiling continua por último** no MVP, como manda o briefing, mas com uma fatia de
  pesquisa antecipada (a árvore é o item de maior incerteza).
- **`modules/media` (Spotify/MPRIS) entra na Fase 3.** Fora do briefing original, mas
  está habilitado no baseline; licença permite reuso e o acoplamento ao Shell é mínimo.
- **Diagnostics/Conflict Detector entra na Fase 1**, não no fim: durante todo o
  desenvolvimento as extensões originais continuam ativas.

---

## Fase 0 — Auditoria ✅

- [x] Clonar as 9 referências e fixar commits
- [x] Auditar licenças e definir a do projeto (GPL-3.0-or-later)
- [x] Documentar o baseline do usuário (11 extensões, dconf, arquivos fora do GSettings)
- [x] Mapear LOC, chaves e acoplamento a APIs internas
- [x] Classificar REUSE/ADAPT/REWRITE/DROP
- [x] `PROJECT-AUDIT.md`, `LICENSE-AUDIT.md`, `BASELINE-CONFIG.md`, `FEATURE-MATRIX.md`, `COMPATIBILITY.md`, `ARCHITECTURE.md`, `MIGRATION.md`, `ROADMAP.md`

## Fase 1 — Skeleton ✅
Entrega: extensão que carrega, não faz nada visível, e descarrega sem deixar rastro.

- [x] `metadata.json` (`gnomeCustom@gfiamoncini.com`, `shell-version: ["49"]`), `COPYING`, cabeçalhos SPDX
- [x] `Makefile`: `build`, `check`, `install` (symlink de dev), `install-copy`, `pack`, `enable`, `prefs`, `logs`, `nested`, `pot`, `clean`
- [x] `core/`: `context`, `lifecycle`, `module`, `module-manager`, `services`, `settings`, `logger`, `signals`, `patcher`, `compatibility`
- [x] `schemas/`: esquema base com as 11 chaves `*-enabled` + `log-level`, `migration-version`, `conflict-warnings`, `strict-cleanup-check`
- [x] `prefs/`: janela Adwaita com as páginas *Geral* (interruptores + nível de log) e *Avançado* (conflitos, desenvolvimento, sobre)
- [x] `services/shell/extensions.js`: primeiro serviço, isolando `Main.extensionManager`
- [x] `modules/diagnostics`: Conflict Detector das 11 extensões originais
- [x] `tests/`: 41 testes do núcleo + 8 das preferências
- [x] `po/pt_BR.po`: 57/57 strings traduzidas
- [x] **Aceite verificado:** 4 ciclos enable/disable em GNOME Shell 49.9 headless real, sem
      erro no log e com `verificação de limpeza: nada pendente` em cada desativação;
      20 ciclos no teste automatizado sem crescimento de sinais ou patches pendentes.

## Fase 2 — Panel + Theme Core ✅
- [x] `services/shell/`: `panel`, `theme`, `apps`, `session`, `keybindings`
- [x] `services/system/`: `distro` (os-release), `wallpaper` (paleta assíncrona)
- [x] `theme/engine`: `color` (WCAG), `quantize` (corte mediano), `tokens`, `stylesheet` —
      barra flutuante com altura 29, margens 1.5/4.5/2.1, raio 15, borda 2, alfa 0.9
- [x] Extração de paleta do papel de parede, conferida contra a paleta que o Open Bar
      gravou para a mesma imagem
- [x] Tema de Shell do usuário carregado pelo próprio projeto (papel do User Themes),
      com o CSS gerado somado por cima
- [x] `modules/panel`: menu de aplicações em duas colunas (**ADAPT** do oficial) +
      controle do botão Atividades + atalho `Alt+F1`
- [x] `modules/menu`: Logo Menu reescrito — logotipo do `os-release`, Sobre, Aplicações,
      Atividades, Programas, Monitor, Terminal, Extensões, Configurações,
      Encerrar à força (Wayland, via `Meta.Window.kill()`), Bloquear, Suspender,
      Reiniciar, Desligar
- [x] Três páginas novas de preferências (Tema, Painel, Menu do logotipo)
- [x] 27 testes novos do núcleo (cor, quantização, tokens, CSS, os-release) e 5 das prefs
- [x] pt-BR: 191/191 strings
- [x] **Aceite verificado** em GNOME Shell 49.9 headless: os três módulos ativam,
      a paleta é extraída do papel de parede real, a folha é regerada a cada mudança,
      o tema Orchis é aplicado, o menu liga/desliga a quente e a desativação termina
      com `verificação de limpeza: nada pendente` e **zero** CRITICAL no log.

## Fase 3 — Bluetooth + Volume + Mídia ✅
- [x] **Bluetooth verificado** em GNOME Shell 49.9 headless, lendo o BlueZ real: teclado AULA
      (93%) e fone JBL (80%) na barra e no card; com o limite em 85%, o JBL ficou vermelho na
      barra e no card, a quente; trocar a posição recria o botão; desativação com `verificação
      de limpeza: nada pendente`. 5 testes novos do núcleo e 1 das prefs; pt-BR 224/224.
      **Não exercitado:** conectar/desconectar pelo card — no teste isolado o barramento de
      sistema é o real, e o clique desconectaria dispositivos de verdade
- [x] `services/bluetooth/devices.js`: BlueZ pelo D-Bus de sistema (`Device1` + `Battery1`),
      assíncrono e **sem consulta periódica** — `Battery1.Percentage` avisa quando muda. O
      UPower não foi necessário (ele mesmo lê do BlueZ), e a divergência do intervalo
      (minutos × segundos) deixa de existir: não há intervalo
- [x] `modules/bluetooth` + `ui/bluetooth/indicator.js` — **redefinido pelo usuário em
      2026-09-10**: na barra, o ícone de cada dispositivo conectado com a porcentagem; o
      clique abre um card, no formato do de mídia, só com os conectados (nome, porcentagem e
      barra); clicar num dispositivo conecta ou desconecta, e quem é desconectado pelo card
      fica na lista, esmaecido, até o card fechar; bateria no limite ou abaixo em vermelho
      (`low-battery-threshold`, padrão 20). O botão some quando nada está conectado.
      `hide-indicator` e a tolerância a MAC inválido deixam de se aplicar (o "MAC inválido"
      do baseline era a bateria do notebook, listada pelo UPower)
- [x] `services/shell/osd.js` — o número sai da própria barra de nível do OSD, então
      `services/audio` não foi necessário
- [x] `modules/volume`: número no OSD via `InjectionManager` (patch de `OsdWindow.show` no
      escopo do módulo); `adapt-panel-menu` ficou de fora porque está desligado no baseline
- [x] 4 testes novos do núcleo (formatação, patch e reversão, falha isolada, liga/desliga a quente)
- [x] **Volume verificado** em GNOME Shell 49.9 headless, com `ShowOSD` real pelo D-Bus:
      `42`, `150` (amplificação) e só o ícone num OSD sem barra; liga/desliga a quente;
      desativação com `verificação de limpeza: nada pendente` e nenhum aviso vindo da extensão
- [x] `services/mpris/players.js`: `org.mpris.MediaPlayer2` genérico via `Gio.DBus`, com
      âncora de posição (o MPRIS não avisa quando `Position` muda)
- [x] `services/system/cover-art.js`: capa baixada para cache em disco e cor dominante
- [x] **Media verificado** em GNOME Shell 49.9 headless, com players MPRIS falsos: só o
      player permitido aparece mesmo com outro tocando; troca de faixa atualiza o nome;
      trocar `allowed-players` troca o player; capa local e capa https (baixada e em cache);
      o botão some quando o player fecha; card aberto por clique real e conferido em captura;
      desativação com `verificação de limpeza: nada pendente`. 9 testes novos do núcleo e
      1 das prefs; pt-BR 212/212
- [x] `modules/media` + `ui/media/indicator.js` — **redefinido pelo usuário em 2026-09-10**:
      base trocada de spotify-controls para **spotify-controller** (NarkAgni). Na barra
      superior, à direita, `[mini capa] nome da música`; o clique abre o card com capa
      redonda, título, artistas / álbum, tempo só de leitura e fundo em degradê da capa.
      **Sem** scroll de volume, curtir, playlists ou letra. (Controles de reprodução na barra e
      atalhos foram acrescentados depois do roadmap, a pedido do usuário, em 2026-09-16.)
      Players permitidos configuráveis nas preferências (padrão: Spotify)
- **Aceite:** bateria do teclado AULA visível no menu; número no OSD ao ajustar volume;
  Spotify Controls pode ser desabilitada.

## Fase 4 — Dock ✅
- [x] `services/shell/dash.js` — subclasses do `Dash` e do `DashIcon` do Shell, sem patch;
      `services/applications` não foi necessário (favoritos e apps abertos vêm do próprio Dash)
- [x] `modules/dock` + `ui/dock/dock.js`: fixo no rodapé, reserva espaço (struts) e some em
      tela cheia; ícone de até 24 px (diminui se não couber), comprimento 0.90, compacto, pontos
      por janela (até 4), fundo com opacidade 0.0; sem botão de apps (lixeira, volumes e emblemas
      não existem no dash do Shell)
- [x] Monitor: **só o principal**, por decisão do usuário em 2026-09-10 — e não por conector,
      porque o LG já apareceu como `HDMI-1` e como `HDMI-4`
- [x] Cliques padrão do Dash to Dock: alternar janelas (memória de 3 s), Shift minimiza, clique
      do meio abre janela nova, Ctrl segue o GNOME; menu de contexto e rótulos são os do Shell;
      rolagem não faz nada (é o padrão)
- [x] Visão geral: o dock continua visível; o dash dela fica escondido com a altura do dock, então
      o conteúdo não passa por baixo, e volta ao normal quando o módulo é desligado
- [x] **Verificado** em GNOME Shell 49.9 headless, com dois monitores e dois editores de texto
      abertos: dock só no principal; janela maximizada para acima dele; pontos por janela; decisões
      de clique `cycle` (com foco), `minimize` (Shift) e `app-activate` (na visão geral); ícone 48 e
      fundo 0,6 a quente; desativação devolve o dash da visão geral e termina com `nada pendente`.
      Os `CRITICAL` do log (`G_IS_SETTINGS`, `ibusCandidatePopup`) aparecem igual numa rodada de
      controle **sem** a extensão. 4 testes novos do núcleo e 1 das prefs; pt-BR 236/236
- [ ] Fora do baseline ou adiado: miniaturas de janelas no menu, contador de notificações, "dança"
      de apps urgentes, atalhos Super+número próprios (os do GNOME, por favoritos, continuam),
      auto-hide/intellihide (AD-6)
- **Aceite:** Dash to Dock pode ser desabilitado sem perda funcional. Auto-hide fica para depois.

## Fase 5 — Overview ✅
- [x] `services/shell/overview.js` — um serviço só; `services/shell/workspaces.js` não foi necessário
- [x] `modules/overview`: miniaturas com **workspace único** (crítico: `num-workspaces=1`), papel
      de parede nas miniaturas, busca escondida até digitar e PiP do Firefox na visão geral —
      quatro chaves, cada uma liga e desliga a quente; patches só por `InjectionManager`
- [x] Tamanho das miniaturas: **nada a fazer**. O "thumbnails 2×" estava errado — o `'100%'` do
      baseline é a escala padrão do GNOME (BASELINE-CONFIG.md §3.5, corrigido)
- [x] PiP reconhecido por critério próprio (janela do Firefox com `skip_taskbar`), não pela lista
      de títulos do GNOME UI Tune (GPL-3.0-only). **Não exercitado ao vivo** — precisa de um vídeo
      em picture-in-picture na sessão real
- [x] **Verificado** em GNOME Shell 49.9 headless com um workspace: faixa de miniaturas visível e
      com papel de parede; busca escondida, aparece ao digitar e some com Esc; desligar a quente
      devolve a visão geral padrão e religar reaplica; desativação com `nada pendente`. Um CRITICAL
      do Cogl (entrada da busca pintada com altura zero) foi achado e corrigido; os demais
      (`ListSearchResults`, `G_IS_SETTINGS`) aparecem igual sem a extensão. 4 testes novos do
      núcleo e 1 das prefs; pt-BR 252/252
- **Aceite:** GNOME UI Tune pode ser desabilitado; nenhum `prototype.x=` cru no código.

## Fase 6 — Animation ✅
- [x] `modules/animation` + `services/shell/animation.js`: fator de velocidade (0.25 no baseline)
      via `St.Settings.slow_down_factor`, guardando e devolvendo o original (adaptado do Impatience)
- [x] Aviso na página de preferências (e no log) quando `enable-animations = false`: no Shell 49
      a duração vira zero, e o fator só vale para as animações marcadas como obrigatórias
- [x] **Verificado** em GNOME Shell 49.9 headless: fator aplicado e mudado a quente; aviso ao
      desligar as animações do sistema; fator original restaurado ao desligar o módulo e ao
      desativar; `nada pendente` e nenhum CRITICAL. 4 testes novos do núcleo e 1 das prefs;
      pt-BR 263/263
- **Aceite:** Impatience pode ser desabilitado.

## Fase 7 — Theme Engine completo ✅
- [x] Tokens para menus, OSD, dock e bordas de tiling, **todos derivados da mesma cor base**
      da barra (menus e OSD um passo afastados, para profundidade). Contraste AA garantido em
      cada superfície
- [x] Superfícies ligadas por chave (`style-menus`, `style-osd`, `style-dock`), **desligadas
      por padrão** — o baseline do usuário não tematiza menus, OSD nem dock
- [x] CSS por superfície, com seletores conferidos no `gnome-shell-dark.css` do gresource do
      GNOME 49 (`.popup-menu-content`, `.popup-menu-item`, `.osd-window .level` com
      `-barlevel-*`); com cor, os ícones do dock perdem o disco `#38383b` do tema
- [x] Dock: cor publicada pelo novo `services/theme/style.js` e aplicada pelo próprio dock com
      a opacidade dele — estilo inline vence folha, e o dock segue sem depender do módulo de tema
- [x] Presets como dados puros (`theme/presets/presets.js`): Papel de parede (= defaults do
      esquema = baseline), Adwaita, Escuro, Mínimo, Fedora; "Personalizado" é **derivado** dos
      valores, sem chave de estado que possa dessincronizar
- [x] Seletor de preset nas preferências, mais os grupos de superfícies e de bordas de tiling
- [x] Regeneração assíncrona e *debounced* (já existia) + **correção**: trocar o papel de parede
      durante uma extração era descartado; agora vira uma nova rodada
- [x] Lista única chave→configuração (`SETTINGS_KEYS`): o módulo lê, observa e os presets são
      validados por ela
- [x] 19 testes novos do núcleo (117) e 5 passos novos das prefs; pt-BR 308/308
- [x] **Aceite verificado** em GNOME Shell 49.9 headless: preset Fedora com barra, menu do
      logotipo, OSD de volume e dock coerentes (conferido por captura e amostragem de pixels);
      troca a quente para o preset Escuro; zero CRITICAL; limpeza "nada pendente"
- **Aceite:** um preset altera painel, dock, menus e OSD de forma coerente. ✅

## Fase 8 — Tiling ✅
Camada pura (`lib/tiling/`, testada fora do Shell) + ponte com o Mutter.

- [x] `lib/tiling/tree.js`: árvore no modelo i3 — split, foco com histórico, mover (incluindo
      sair de contêiner e envolver a raiz), swap, redimensionar por pesos, troca de chave
- [x] `lib/tiling/layout.js`: fórmula de gaps do Forge (2·gap), gaps ocultos em janela única,
      fatias que somam exatamente a área
- [x] `lib/tiling/rules.js` + `default-rules.js`: as 28 regras do Forge, semântica de
      correspondência dele; **regras por `wmId` não existem** — flutuar por janela é memória
- [x] `lib/tiling/actions.js`: os 39 atalhos do baseline (o 40º item era o modificador do
      mouse); esquema gerado deles por `make tiling-schemas`
- [x] `lib/tiling/controller.js`: toda a decisão — eventos, flutuar, sempre-flutuar, snap,
      resize por teclado e mouse, arrastar para trocar, monitor vizinho, área sem tiling
- [x] `services/shell/windows.js` (adaptador do Mutter 17), `ui/tiling/focus-border.js`,
      `ui/tiling/quick-toggle.js`, `services/shell/quick-settings.js`, `modules/tiling`
- [x] Espera automática enquanto o Forge estiver ativo, e aviso de atalhos em colisão
- [x] Página de preferências: comportamento, gaps, regras (adicionar/remover), áreas sem
      tiling, atalhos
- [x] 36 testes novos do núcleo (172) e 3 passos das prefs; pt-BR 396/396
- [x] **Aceite verificado** em GNOME Shell 49.9 headless com o Editor de Texto de verdade:
      tiling com os gaps do baseline, `Super+V` + janela nova, `Super+C`, `Ctrl+Super+H`,
      `Ctrl+Alt+D`, mudança de monitor com dois monitores virtuais, espera com o Forge
      ativo e retomada ao desativá-lo; zero CRITICAL com a extensão ativa
- **Aceite:** Forge pode ser desabilitado; testes automatizados da árvore passam. ✅

Descobertas ao rodar no Shell (todas com teste ou correção):
- O Mutter maximiza sozinho janelas que abrem grandes, e `allows_resize()` é falso enquanto a
  janela está maximizada: usar `resizeable` e desmaximizar no layout, como o Forge.
- O foco chega na janela nova antes de ela estar pronta: o evento de foco não pode esperar.
- No Wayland o retângulo só muda quando o cliente confirma: não repetir o mesmo pedido.
- O aviso de desativação do Forge chega antes de ele soltar os atalhos: sair da espera com atraso
  e tentar de novo atalhos recusados.
- `Super+V` do baseline colide com `toggle-message-tray` do GNOME, que vence — **inclusive na
  sessão real do usuário** (decisão dele se quer liberar).

## Fase 9 — Migração e polimento ✅
- [x] `lib/migration/importers.js`: importadores das 11 extensões, puros, sobre o **valor efetivo**
      (o Logo Menu esconde bloquear/energia por padrão; importar só o alterado mudaria o menu)
- [x] `lib/migration/apply.js`: leitura só-leitura dos esquemas de cada extensão e dos arquivos
      do Forge; backup em `migration-backup`; ajuste aos limites; relatório; desfazer exato
- [x] Página **Migração** nas preferências, com relatório e os passos da troca
- [x] Perfis em `lib/profiles.js` (Nada ligado, Desktop, Desenvolvedor, Notebook, Mínimo, Jogos;
      Personalizado derivado), com aviso antes de ligar módulos cujas originais estão ativas
- [x] `MIGRATION.md` reescrito conforme o implementado (o da Fase 0 citava chaves inexistentes)
- [x] `docs/USER-GUIDE.md`: instalar, trocar as extensões, perfis, módulos, atalhos, problemas
- [x] GNOME 50 avaliado e **não declarado** (sem teste real); roteiro em `COMPATIBILITY.md` §6
- [x] 11 testes novos do núcleo (183) e 7 passos das prefs; pt-BR 456/456
- [x] **Critério verificado:** importar o baseline reproduz os padrões do GnomeCustom; ensaio
      só-leitura sobre as extensões instaladas: 90 gravações, 3 mudariam algo (tema Orchis;
      bloquear e energia escondidos como no Logo Menu); regras fantasmas do Forge descartadas

---

## Marcos

| Marco | Conteúdo | Extensões que podem ser desligadas |
|---|---|---|
| **M1** ✅ | Fase 1 | nenhuma (só infraestrutura) |
| **M2** (parcial) | Fase 2 ✅ | Open Bar, Logo Menu, apps-menu, User Themes |
| **M2** ✅ | Fase 3 ✅ | + BT Battery, OSD Volume, Spotify Controls |
| **M3 (MVP)** ✅ | Fase 4–6 ✅ | + Dash to Dock, GNOME UI Tune, Impatience |
| **M4** ✅ | Fases 7 e 8 | + Forge → **todas as 11** |
| **M5** ✅ | Fase 9 | migração, perfis, guia do usuário, i18n |

O MVP da §33 do briefing corresponde a **M3**. O tiling entra em **M4**, conforme previsto.

## Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Theme Engine subestimado (286 chaves em Open Bar) | alta | alto | recorte pelo baseline; entrega em duas fases |
| Árvore de tiling com bugs sutis | alta | alto | testes automatizados desde o início; fase isolada |
| GNOME 50 quebra APIs internas | média | alto | `services/shell/` + `InjectionManager` + feature flags |
| Conflito com extensões originais durante o desenvolvimento | alta | médio | Conflict Detector na Fase 1 |
| Instabilidade do Shell durante testes | média | alto | sessão aninhada (`gnome-shell --nested --wayland`) |
| Upstream do Open Bar defasado da versão instalada | confirmada | médio | comparar sempre com a cópia instalada |
| Projeto grande, um único mantenedor | alta | alto | módulos independentes; cada fase entrega valor sozinha |
