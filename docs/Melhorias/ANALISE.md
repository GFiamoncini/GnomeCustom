# Análise das melhorias — 2026-09-16

## Situação

| Item | Estado |
|---|---|
| Mídia: controles na barra, atalhos, separadores | ✅ commit `b7ef0cf` (branch `media-controles`) |
| Barra: margem superior | ✅ corrigido (branch `melhorias-bugs`, sem commit) |
| Barra: contorno duplo + realce mais suave | ✅ corrigido (idem) |
| Dock: clique não minimiza | ✅ corrigido (idem) |
| Mosaico: Super+setas restaura minimizada | ✅ corrigido (idem) |
| Card de mídia no desenho do WinDock, trilho clicável para pular | ✅ feito (branch `melhorias-bugs`, sem commit) |
| Card de Bluetooth no desenho do WinDock (rádio, pareados, ✕ esconder, configurações) | ✅ feito (idem) — **ligar/desligar rádio e conectar não testados ao vivo** |
| Barra: corte à direita, cores próprias, tamanho dos ícones | ✅ (idem) |
| Preto AMOLED do tema do Shell | ✅ (idem) |
| Notificações compactas | ✅ (idem) |
| Configurações com menu lateral | ✅ (idem) |
| Cards de Bluetooth e mídia nas cores do tema global | ✅ (idem) |
| Janela de preferências sempre por cima (flutuantes como no Forge) | ✅ (idem) |
| **Menu de aplicações em acordeão** | ✅ 2026-09-20, uma coluna, categorias recolhidas |
| **Bordas/cantos por superfície; barra colada arredonda embaixo** | ✅ 2026-09-20 |
| **Atalhos do mosaico revisados pelo WinDock** | ✅ 2026-09-20, editáveis nas prefs |
| Fedora 44 / GNOME 50 | auditado por inspeção: COMPATIBILITY.md §7 |
| Fedora 45 / GNOME 51 | auditado por inspeção e corrigido no branch `gnome-51`: COMPATIBILITY.md §8 |

Os quatro bugs foram validados num Shell isolado com a configuração real (tema Orchis, atalhos
do usuário) e gnome-text-editor de verdade. O do mosaico foi conferido também ao contrário:
sem a correção, `Super+→` restaura a minimizada.

Resposta a `Melhorias.md`. Referência: WinDock (`GFBmsoft/WinDock`, commit `29cd195`).
Cada item diz **o que foi constatado** (código, Shell isolado com a configuração real
exportada do dconf, ou log da sessão em produção) e **o que se propõe**.

Legenda: 🐞 bug confirmado · ✨ melhoria · ❓ precisa de decisão sua.

---

## Como o WinDock resolve (lido no código, commit `29cd195`)

- **Barra:** botões com realce só de fundo, raio 6, `#22FFFFFF` no hover e `#33FFFFFF`
  pressionado — um véu branco translúcido, nunca a cor de destaque. Adotado.
- **Mídia na barra:** `[capa 16px] ❮ Artista — Faixa ❯` (máx. 220 px) e, separados por um
  respiro, `⏮ ⏯ ⏭` com glifos de 13–14 px; tudo some quando nada toca.
- **Card de mídia:** 280 px, fundo `#242424` translúcido, borda 1 px branca 18%, raio 10,
  sombra. Cabeçalho "♫ Tocando agora"; capa 56 px raio 6 à esquerda; título (semibold),
  artista, álbum (cinza) à direita; trilho de 4 px **clicável para pular**; decorrido à
  esquerda, duração à direita. **Sem controles no card** — de propósito, eles já estão na barra.
- **Card de Bluetooth:** mesmo quadro. Cabeçalho com ícone, "Bluetooth" e interruptor do
  rádio (verde). Linhas: ponto verde (conectado) ou vazado (pareado), nome, bateria %, e
  "conectado" verde / "pareado" cinza; ✕ no hover esconde o aparelho sem despareá-lo.
- **Dock:** uma janela → alterna ativar/minimizar; várias → passa para a próxima (não
  minimiza); miniaturas ao parar o mouse a partir de duas janelas.
- **Mosaico, foco:** só janelas "alcançáveis" (não minimizadas); flutuante por cima tenta
  primeiro as do mesmo monitor; pontuação `distância + 2 × desvio lateral`.
- **Atalhos:** cada linha mostra se está **ativo** ou **em uso por outro programa**;
  escolher a combinação de outra ação **troca as duas**; botão "Restaurar padrão".

## 0. Da sessão em produção

- 🐞 **Mídia não ativou no login de hoje (21:55):** `GSettings key show-controls not found`.
  O login carregou o código do branch em andamento antes de os esquemas serem recompilados.
  **Já resolvido** (esquemas compilados); volta no próximo logout.
- Nenhum outro erro da extensão no journal.

## 1. Mídia — FEITO neste branch (`media-controles`)

- Barra: `capa | nome | ⏮ ⏯ ⏭`, com separadores. Botões respeitam `CanGoNext`/`CanPause`/…
  e ficam apagados quando o player não aceita. Opção "Controles de reprodução" nas prefs.
- 🐞 achado no ensaio: clicar num controle **abria o card** (no GNOME 49 o `St.Button` só
  reconhece o clique ao soltar e o botão do painel abre o menu no pressionar). Corrigido.
- Atalhos no espírito do WinDock (`Alt+Shift` + ← anterior, → próxima, ↑ tocar/pausar),
  trocando Alt por Super. A tradução literal `Super+Shift+setas` **não serve**: é "mover
  janela" do mosaico. Toda família Super+setas está ocupada (Ctrl+Super←→ = monitor,
  Alt+Super = workspaces/visão geral). Padrão escolhido: **Ctrl+Alt+Super + ←/↑/→**.
- Editor de atalhos nas prefs: clique grava, botões de limpar e restaurar, aviso quando a
  combinação já é usada pelo GNOME ou pelo mosaico. Recusa letra sem modificador.
- Validado num Shell headless com player MPRIS falso: clique real nos botões e teclas reais.

**Ainda de mídia (próximo passo):** card no estilo WinDock — cabeçalho "♫ Tocando agora",
capa pequena à esquerda com título/artista/álbum à direita, barra de tempo **clicável para
pular**. O WinDock deixa os controles **fora** do card (já estão na barra); proponho o mesmo.

## 2. Barra superior

| Item | Constatação | Proposta |
|---|---|---|
| 🐞 Margem superior mesmo com margem 0 | Reproduzido: a barra começa em y=2 e há 2 px de papel de parede nas laterais. O tema **Orchis** define `#panel { margin: 2px; border-radius: 9999px }`; no modo "colado à borda" só zeramos `#panelBox`, não `#panel`. (Seu `panel-margin-top` também está em `2.7e-17`, resíduo do slider — inofensivo, mas vou arredondar.) | Zerar `margin` do `#panel` sempre e controlar a margem só pelo `#panelBox`. |
| 🐞 Contorno duplo no hover/aberto (calendário) | Reproduzido. Pintamos `background-color` no botão; o Orchis pinta por `box-shadow: inset` — e, no relógio, no filho `.clock` com outro raio. Resultado: duas formas sobrepostas. | Anular `box-shadow` do botão e do `.clock` quando o engine assume as cores; realce mais suave (alfa menor). Revisar os demais botões (sistema, apps, mídia). |
| 🐞/❓ Cantos arredondados não aplicam | Por desenho: com estilo **"colado à borda"** (o seu) o raio é forçado a 0; o slider só vale no "flutuante" — mas continua visível e parece quebrado. | Separar a página Tema em seções **Painel / Dock / Mosaico**, cada uma com seus cantos e bordas. ❓ No modo colado: esconder o raio, ou arredondar só os cantos de baixo? |
| ✨ Ícone da distribuição P&B igual ao Logo Menu | A licença do Logo Menu **proíbe copiar** código e arte (LICENSE-AUDIT §4). | Monocromático por efeito (dessaturar + brilho) sobre o logo do sistema, com opção branco/preto. Visual equivalente, sem copiar nada. |
| ✨ Paleta do papel de parede em submenu recolhido | Hoje é uma lista aberta na página Tema. | `Adw.ExpanderRow` recolhido. |

## 3. Tela de configurações

- ✨ 12 páginas em abas cortam os títulos. Proposta: **menu lateral** (`Adw.NavigationSplitView`,
  como o app Configurações do GNOME), um item por módulo; no WinDock cada opção é um cartão com
  título e explicação — o Adwaita já faz isso com `Adw.PreferencesGroup`.
- Cuidado conhecido: sair do `Adw.PreferencesWindow` padrão perde a busca embutida; refazer.

## 4. Menu de aplicações

- ❓ "Seguir o padrão do GNOME Apps Menu" + "grupos sempre recolhidos": o Apps Menu mostra
  categorias à esquerda e apps à direita (é o que temos hoje, portado dele). Entendi que você
  quer **uma coluna só, com as categorias como grupos recolhíveis** (acordeão). Confirmar.

## 5. Bluetooth (base: card do WinDock)

- WinDock: cabeçalho com ícone, título e **interruptor do rádio**; lista de **pareados**
  (conectados primeiro), com ponto verde/vazado, nome, **bateria %** e estado
  **"conectado" (verde) / "pareado" (cinza)**; ✕ para esconder um aparelho; rodapé
  "Configurações de Bluetooth".
- Hoje: só conectados, sem estado escrito, cores do tema de Shell.
- Proposta: seguir o WinDock (incluindo o rádio e o atalho para as Configurações), usar os
  tokens de cor da barra (`buildTokens`), texto "conectado" explícito.
- ⚠️ Conectar/desconectar pelo card **nunca foi exercitado ao vivo** — preciso que você teste.

## 6. Notificações

- ✨ Compactar o card: reduzir paddings, espaçamento entre mensagens e o tamanho do ícone da
  lista de mensagens do calendário. Só CSS, atrás de uma opção.

## 7. Dock

- 🐞 Clique no ícone não minimiza. Causa: com o app em foco o clique faz "alternar janelas"
  (padrão do Dash to Dock); com uma janela só, ela é reativada.
- Feito (igual ao WinDock): app em foco com **uma janela → minimiza**; com várias →
  alterna entre elas. ❓ Quer que, com várias, o clique também minimize ao completar a volta?

## 8. Mosaico

- 🐞 `Super+setas` vai para janelas minimizadas. Causa: a janela minimizada continua na árvore
  (para voltar ao mesmo lugar) e a busca da vizinha não confere se ela ocupa espaço;
  `activate()` então a restaura.
- Proposta: a vizinha pula folhas que não ocupam espaço (minimizadas e em tela cheia),
  seguindo adiante na mesma direção.

### Atalhos do mosaico revisados pelo WinDock (Alt → Super) ❓

Você tem **1 workspace fixo**, então os atalhos de workspace do GNOME não servem para nada,
mas ainda ocupam combinações.

| Ação (WinDock) | WinDock | Hoje | Proposta |
|---|---|---|---|
| Mudar o foco | Ctrl+Alt+setas | Super+setas | **manter** |
| Trocar de lugar | Ctrl+Shift+setas | Super+Shift+setas (mover) | **manter** |
| Redimensionar ("cresce às custas da vizinha") | Ctrl+Alt+Shift+setas | 8 atalhos Ctrl+Super+y/u/i/o (+Shift) | **Ctrl+Shift+Super+setas** (4 atalhos, livres); letras antigas ficam como alternativa |
| Flutuar | Alt+C | Super+C | manter |
| Esquecer tamanho (flutuante volta a 60%) | Ctrl+Alt+C | — | **Ctrl+Super+C** (novo, livre) |
| Esconder / Fechar | Alt+Z / Alt+W | GNOME: Super+Z / Super+W | já existem no GNOME |
| Prender acima | Alt+T | — | **Super+T** (novo, livre) |
| Configurações | Ctrl+Alt+S | — | **Ctrl+Super+S** (novo, livre) |
| Música | Alt+Shift+setas | — | **Ctrl+Alt+Super+setas** (feito) |

Também do WinDock: na página de atalhos, marcar cada linha como **ativo / em uso por outro**
e um botão **Restaurar padrão** — o editor feito para a mídia já serve para isso.

---

## Ordem sugerida

1. Bugs pequenos e isolados: margem, contorno duplo, dock minimizar, mosaico e minimizadas.
2. Card de mídia no estilo WinDock (fecha o tema mídia).
3. Atalhos do mosaico: editor em todas as linhas e novos padrões (depois da sua decisão).
4. Bluetooth no estilo WinDock.
5. Tema: seções Painel/Dock/Mosaico, paleta recolhida, ícone P&B.
6. Configurações com menu lateral.
7. Menu de aplicações (depois de confirmar o layout) e notificações compactas.

---

## EV02 — borda do mosaico com o tema Dracula-AMOLED (2026-09-21)

`EV02.png`: com o Chrome no modo "GTK", o canto da janela sai por fora da borda do
mosaico. O canto medido na captura tem 2–3px de raio: o GTK do Dracula arredonda as
janelas com 4px, e só em cima, enquanto os apps libadwaita usam 15px nos quatro.

- **Feito:** o tema passou a usar 15px nos quatro cantos no GTK 3 e no GTK 4
  (`themes/dracula-amoled/gtk-extra.css`). Com a borda em 12px e largura 3, o raio da
  borda fica 15px, igual ao das janelas.
- **Em aberto:** no Shell isolado o Chrome em modo GTK usa ~8px com os dois temas e
  não vaza; falta conferir no Chrome real, depois de reabri-lo.

Na mesma rodada, os ajustes do VS Code e do Obsidian passaram para a extensão: a
receita fica em `apps/` do tema, aplicada por `services/system/app-tweaks.js` junto
com "Usar também nos aplicativos".

**Borda 1px para dentro nas janelas flutuantes (todos os apps):** a janela flutuante
não está na árvore do mosaico, e `gapFor()` dava 0 — a borda ia para dentro do
quadro e o anel de 1 px da janela ficava à mostra. Agora `borderSpaceFor()` põe a
borda sempre por fora nas flutuantes; nas lado a lado continua valendo o gap.

---

## WinDock de 22 a 28/09 — remover pen-drive e o que mais cabe (2026-09-28)

Pedido: o botão de remover mídia (pen-drive, HD externo) que o WinDock ganhou em 25/09, e
ver o que mais das novidades dele dá para trazer.

- **Feito: módulo Dispositivos externos** (`modules/removable/`, fora dos perfis como o clima
  e a cota; **ligado de fábrica** desde o relato abaixo). O ícone só existe enquanto há aparelho externo montado,
  e o card lista um aparelho por linha, com **Abrir** e **Remover**. A lista sai do
  `Gio.VolumeMonitor` e é atualizada pelos sinais dele, sem relógio. Entra drive removível,
  ejetável ou que se desliga: é assim que o UDisks marca o HD externo por USB. O disco
  interno "Dados" fica de fora. A remoção vai com o `ShellMountOperation`, a mesma via do
  Arquivos, e nunca é forçada.
- **Conferido:** o módulo sobe no Shell isolado, e o card foi visto com aparelhos falsos
  nos estados lista, removendo, em uso e pode desconectar.
- **Exercitado pelo usuário (2026-09-28), com pen-drive:** o ícone aparece ao conectar e
  some ao remover, pelo card e pelo Arquivos. **Falta:** um HD externo (via `stop`).
- **Relato do mesmo dia:** "só aparece o ícone se eu marco a opção". A chave era o
  liga/desliga do módulo, repetido na página dele com cara de opção de exibição; desligada,
  nada aparecia nem com o pen-drive montado. O pedido é "conectou, aparece; removeu, pelo
  card ou pelo Arquivos, some" — que é o `hide-when-empty` com o módulo ativo. **Feito:** o
  módulo vem ligado de fábrica (único assim: sem aparelho não mostra nada) e a chave saiu
  da página dele; o liga/desliga fica só na Geral.

Das outras novidades do WinDock, em ordem de valor para cá:

| Novidade | Aqui | Avaliação |
|---|---|---|
| Atualizações pendentes na barra (Windows Update + winget) | dnf pelo PackageKit + Flatpak | **Feito em 2026-09-29** — ver a seção abaixo. |
| Janelas novas abrindo flutuantes + `Alt+Shift+C` devolve todas ao mosaico | mosaico próprio | **Cabe, é pequeno:** opção "abrir flutuando" e uma ação "todas as flutuantes de volta". Levar as duas pegadinhas do WinDock: guardar quem já foi visto (e não "a árvore não conhece") e deixar em paz as janelas que já estavam abertas quando o mosaico liga. |
| Lembretes com hora no calendário | o calendário do Shell mostra eventos e tarefas do Evolution Data Server (`ECal-2.0` instalado) | Possível, mas grande. O GNOME já faz isso com Agenda/Endeavour; só vale se ele quiser anotar pela barra. |
| Fechar janela pela miniatura | a visão geral do GNOME já tem o ✕ em cada janela; o dock não tem miniaturas | Não se aplica. |

---

## Atualizações pendentes na barra (2026-09-29)

Pedido: "pode fazer, abre o Software, 6 horas de intervalo e deixe uma aba no menu de
configurações para ajustar o tempo".

- **Feito: módulo Atualizações** (`modules/updates/`, `services/system/updates.js`,
  `lib/updates.js`, `ui/updates/`), ligado de fábrica e fora dos perfis, como os externos.
  O ícone só existe com pendência, com o número ao lado; o card tem **Sistema** (dnf) e
  **Flatpak**, um programa por linha com a versão nova, as de segurança em âmbar com a
  legenda no cabeçalho, **Verificar agora** e **Atualizar** (abre o GNOME Software em
  `--mode=updates`; nada é instalado pela barra).
- **Como busca:** o dnf pela PackageKitGlib assíncrona (`refresh_cache(false)`, que só
  baixa se passou do `metadata_expire` de 6 h, e `get_updates`); o Flatpak pelo comando
  `flatpak remote-ls --updates` num processo à parte, porque a biblioteca dele é síncrona e
  vai à rede. A lição do WinDock ficou assim: a busca periódica e o "Verificar agora" vão
  à rede; o sinal `UpdatesChanged` do PackageKit e o `.changed` do Flatpak só releem o
  guardado (`--cached`), o que basta para tirar do card o que o Software instalou.
- **Quando:** 1 min depois de ativar, depois a cada `interval-hours` (6 h de fábrica,
  página **Atualizações** das preferências, de 1 a 48 h). O prazo é conferido pela hora
  de verdade a cada 30 min, porque o relógio do GLib para na suspensão.
- **Reinício pendente:** com `/system-update` presente (o Software já baixou a
  atualização offline), o card avisa que falta reiniciar.
- **Conferido:** o serviço contra o sistema real (dnf 5, 2 de segurança; Flatpak 5), e o
  módulo no Shell isolado: ícone com 10, card, "Consultando…" durante a busca, e
  **Atualizar** abrindo o Software na aba Atualizações. Sem pedido de senha: o
  `system-sources-refresh` do polkit é liberado para a sessão ativa.
- **Não exercitado:** o ícone sumir depois de atualizar de verdade pelo Software, e o aviso
  de reinício.

---

## Reformulação pelo WinDock (2026-10-07)

Pedido: baixar o WinDock (versão 1.0.0.45, commit `f1b2cf9`), ver os ícones minimalistas
("gostaria que os ícones não fossem tão espaçados como estão hoje") e o que dá para
reaproveitar. Escolhidos por ele: ilhas, CPU e memória com o cartão completo, calendário
(sem as tarefas), nome da faixa rolando, clique do meio para mudo, cartões compactos.
Recusados: tarefas por dia, ferramentas, locais, brilho; mixer, Wi-Fi, notificações,
energia e busca o GNOME já entrega.

- **Ícones menos espaçados.** A causa era do tema: `-natural-hpadding: 12px` em cada
  `.panel-button`, isto é, 24 px entre dois ícones, e a extensão não mexia nisso. Chave
  nova `theme/panel-button-padding` (-1 deixa o tema; **5 de fábrica**, o respiro dos
  "Ícones compactos" do WinDock), na página Tema como "Espaço em volta de cada ícone".
  Abaixo de 8 o respiro dos ícones do menu rápido e o espaço interno dos nossos botões
  (Bluetooth, mídia) acompanham. O tamanho do desenho continua em `panel-icon-size`; no
  WinDock os dois andam juntos (15 → 12 px). Medido no Shell isolado: com 3 e ícone de
  13, o lado direito caiu de ~215 para ~150 px.
- **Barra em ilhas** (`theme/panel-islands`, desligada de fábrica; `panel-island-gap`).
  A faixa fica transparente e o fundo e a borda descem para `#panelLeft`, `#panelCenter`
  e `#panelRight`. Só com a barra flutuante e uma cor resolvida. Uma ilha por trecho; as
  quebras dentro do canto direito, que o WinDock tem, ficaram de fora.
- **Processador e memória** (módulo `sysmon`, ligado de fábrica, fora dos perfis):
  `lib/sysmon.js`, `services/system/sysstats.js` (lê `/proc/stat`, `/proc/meminfo` e
  `/proc/net/dev`), `ui/sysmon/`. Dois ícones com a porcentagem, âmbar em 75% e vermelho
  em 90%; o cartão tem processador, memória e rede, cada um com o gráfico das últimas 60
  leituras (2 s de fábrica, página **Monitor do sistema**). **A placa de vídeo ficou de
  fora:** não há contador único no Linux, e o nouveau desta máquina não publica uso.
- **Feriados no calendário** (módulo `calendar`, ligado de fábrica): `lib/holidays.js`
  calcula os nacionais a partir da Páscoa, com as mesmas escolhas do WinDock; o dia sai em
  vermelho e os feriados do mês exibido aparecem abaixo da grade.
- **Nome da faixa rolando** (`media/scroll-title`, ligada): só quando não cabe e só
  enquanto toca, com as contas do WinDock (2 s parado, 28 px/s, volta). Sem animações no
  sistema não rola.
- **Clique do meio no alto-falante** liga e desliga o mudo sem abrir o menu rápido. O
  ícone é montado depois da extensão no login, então a busca por ele é repetida por 20 s.
- **Cartões compactos** em Bluetooth (só os conectados), clima (agora e próximas horas) e
  atualizações (quantas, por origem), com a seta do rodapé (`ui/common/expander.js`) e a
  chave `expanded` de cada um. A cota de IA já era assim.
- **Conferido no Shell isolado:** respiro e ilhas na barra, o nome rolando dentro da
  largura máxima, o clique do meio (mudo ligou e voltou, sem abrir o menu), o dia 12 de
  outubro em vermelho com o nome, o cartão do sistema com os três gráficos, e os cartões
  compactos do clima (abrindo pela seta) e das atualizações.
- **Não exercitado:** o cartão compacto do Bluetooth (não se clica nele num ensaio), as
  ilhas com janela maximizada e com o trecho esquerdo vazio, e tudo isso na sessão real.

### Para depois (pedido no meio da rodada)

- Atalho de teclado para aumentar (e diminuir) o volume **da música**, e não o do sistema.
- O mostrador de volume sem a sombra de fundo e logo abaixo da barra superior, como o do
  WinDock.

## Depois do relogin (2026-10-11)

Dois relatos dele com a rodada do WinDock já em uso:

- **Não havia como ordenar os botões da barra.** Todo botão entrava na posição 0 da
  seção, então a ordem era a de ativação ao contrário. Agora há a lista
  `panel/button-order` (`lib/panel-order.js`), aplicada pelo serviço da barra a quem
  entra com `slot`, e em **Painel → Ordem dos botões** cada botão tem setas para trocar
  de lugar. A seção continua na página de cada módulo. Na esquerda os nossos botões
  passaram a ficar **depois** dos menus (antes entravam na frente do logo).
- **O botão de atualizações listava Flatpaks que ninguém conseguia atualizar.** Eram
  cinco refs do repositório `fedora` (OCI): o `flatpak remote-ls --updates` as dá como
  pendentes, e o `flatpak update` e o GNOME Software dizem "nada a atualizar". A lista
  agora vem de `helpers/flatpak-updates.js` (libflatpak, num `gjs` à parte), que faz a
  mesma conta do Software. Custo: a coluna de versão do Flatpak mostra o ramo, porque a
  biblioteca só conhece a versão instalada.

Ensaiado no Shell isolado com a configuração dele: ordem de fábrica, invertida, um botão
mudado de seção, desligar e religar a extensão; a busca deu "nenhuma". As setas das
preferências só passaram pelo `tests/prefs-smoke.js`.

- **Cartões compactos** (pedido no mesmo dia): interruptor em Tema (`theme/cards-compact`).
  A folha compacta é derivada da `stylesheet.css` por `lib/compact-cards.js` (px × 0,85;
  letra × 0,9 pela raiz do cartão); o que é tamanho posto em JS passa por
  `ui/common/card-scale.js`. A barra fica de fora.

**Para depois, acrescentado em 2026-10-11:** o OSD do volume também deve ficar compacto
(além de perder a sombra em volta e ir para logo abaixo da barra, como no WinDock).

Feito ainda no mesmo dia, a pedido:

- **Cores do WinDock:** gráficos e ícones do cartão do sistema (processador `#f4a261`,
  memória `#b08ae8`, recebido `#7fd18b`, enviado `#7fb2f0`); o robô da cota de IA na barra
  com a cor do uso (azul, âmbar, vermelho); ícone e número das atualizações em `#4cc2ff`.
- **Sigla do layout de teclado em maiúsculas** ("BR"), com interruptor em Painel
  (`panel/keyboard-uppercase`, ligado de fábrica).

Ensaiado no Shell isolado, menos o ícone das atualizações (sem pendência não aparece).

**Fila "para depois" zerada em 2026-10-11:**

- **Indicador de volume/brilho (OSD):** sem a sombra do tema, logo abaixo da barra
  (`volume/below-bar`) e menor (`volume/compact`); os dois interruptores ficam em Tema →
  Menus, notificações e OSD. O lugar é posto por `services/shell/osd.js` a cada `show()`.
- **Volume só da música:** `media/shortcut-volume-up` e `-down` (Ctrl+Alt+Super+Page Up /
  Page Down, 5% por toque). Mexe no fluxo de áudio do reprodutor pelo mixer do Shell — a
  propriedade `Volume` do MPRIS o Spotify ignora. O casamento reprodutor ↔ fluxo é pelo
  nome do aplicativo (`streamBelongsTo`, em `lib/mpris.js`).

Ensaiado no Shell isolado com um reprodutor e um fluxo falsos (o Spotify dele, tocando,
não foi tocado). No GNOME 50 o gerenciador de OSD trocou `show(-1, …)` por `showAll(…)`.
Não visto ao vivo: o atalho com o Spotify de verdade, e o OSD no segundo monitor.

## Depois do segundo relogin (2026-10-11)

Relatado por ele ao testar a rodada acima, com os ícones da barra em 12 px:

- **Texto da barra fora do tamanho dos ícones** (percentual da bateria do teclado, sigla
  do layout, data e hora): `panel-icon-size` só valia para os ícones. Agora o texto de
  todo botão da barra segue a mesma chave, na proporção do GNOME (11 pt para 16 px →
  `panelFontSize()` em `theme/engine/stylesheet.js`), e a mini capa da faixa também
  (ícone + 2 px). O `0.9em` próprio dos valores do monitor do sistema saiu: tudo igual.
- **OSD centralizado → à direita:** `volume/align` (`start`/`center`/`end`, `end` de
  fábrica), em Tema → Menus, notificações e OSD.

Ensaiado no Shell isolado com 12, 16 e 20 px. O ensaio que muda chaves do tema
sobrescreve o `generated.css` real (o `XDG_RUNTIME_DIR` é o mesmo): guardar a cópia
antes e **devolvê-la** ao fim.

## Depois do terceiro relogin (2026-10-11)

Os tamanhos ficaram bons. Pedidos novos:

- **Cor nos ícones de processador e memória da barra:** as mesmas das séries do cartão
  (laranja e lilás, `.gnomecustom-sysmon-panel-icon`); no alerta, ícone e número mudam
  juntos para âmbar ou vermelho.
- **Bluetooth: mostrar ou não a porcentagem na barra:** `bluetooth/show-battery` (ligado
  de fábrica), em Bluetooth → Bateria. Desligado fica só o ícone; a bateria baixa continua
  deixando-o vermelho e o cartão continua com a porcentagem.
- **Menus compactos** (o do calendário "fica bem grande"): `theme/menus-compact`, em Tema →
  Menus, notificações e OSD. Vale para o menu da data, os ajustes rápidos e os itens de
  menu pop-up (`compactMenuBlocks()` em `theme/engine/stylesheet.js`); a letra encolhe
  para 0,9em na raiz dos dois primeiros e as medidas em px caem uns 30%. Os itens de menu
  pop-up só perdem respiro, porque os nossos cartões moram em itens assim e têm o
  interruptor deles (`cards-compact`). Com o Dracula-AMOLED o menu da data ficou uns 20%
  menor em cada lado.

Ensaiado no Shell isolado. Duas pegadinhas do ensaio: o `gschemas.compiled` precisa de
`make schemas` depois de chave nova (sem isso o módulo de tema nem sobe), e o dconf do
`XDG_CONFIG_HOME` isolado **sobrevive entre execuções** — `dconf load` não apaga o que o
ensaio anterior gravou, então começar apagando a pasta `$S/cfg/dconf` com `rm`
(nunca `dconf reset` fora do `dbus-run-session`: ver o incidente de 2026-10-20 abaixo). Para
abrir os menus: `Super+M` (data; o `Super+V` é do mosaico), `Super+S` (ajustes rápidos) e,
com um aberto, seta para a esquerda percorre os demais botões da barra.

### Logotipo e "Aplicações" colados (2026-10-20)

Na mesma ilha, o logotipo (monocromático, com o respiro de 2 px dos ícones de status) e
o texto "Aplicações" ficavam separados só pelos 2 × `panel-button-padding` (3 px cada).
Os dois botões ganharam classe própria (`gnomecustom-logo-button`,
`gnomecustom-apps-button`) e, com respiro abaixo de 8 px, o ícone e o rótulo recebem
3 px de cada lado na folha gerada. Ensaiado em sessão isolada com a configuração real:
o vão passou de ~8 px para ~16 px.

Depois ele achou largo demais: o respiro passou a ficar só nos lados que se encaram,
1 px em cada um (direita do ícone, esquerda do rótulo). O botão do logo caiu de 28 para
23 px de largura.

### Botões ovais no menu rápido (2026-10-20)

Com "Menus compactos", os botões redondos da linha de cima do menu rápido (captura,
configurações, bloqueio, desligar) esticavam até a altura da pílula da bateria e ficavam
29×36 px. `compactMenuBlocks()` ganhou `.quick-settings-system-item .icon-button` com
2,8em de largura e altura, `padding: 0` e raio 999px: agora são 36×36. Sem menus
compactos já eram 39×39. A pílula da bateria e os botões com seta continuam pílulas.
Ensaiado em sessão isolada, sem erro de JS.

### EV03: menus que vazam da borda do mosaico (2026-10-20)

Os popovers do GTK 4 (o menu de três pontos do Editor de texto, por exemplo) são
`xdg_popup`, superfícies à parte que o Mutter só prende ao **monitor**. Com o botão perto
da beirada da janela, o menu passa por cima da borda de foco. Isso não se resolve de
uma extensão: a regra fica no C do Mutter, e mover o menu depois de aberto
dessincroniza o app. Ficou a opção escolhida por ele: `ui/tiling/focus-border.js`
esconde a borda enquanto houver um menu da janela focada aberto (janela de tipo
`DROPDOWN_MENU`, `POPUP_MENU`, `MENU` ou `COMBO` cujo dono, seguindo
`get_transient_for`, é a janela focada ou outro desses menus) e a devolve quando o
último é fechado (`unmanaged`). Ensaiado em sessão isolada com um app GTK 4 que abre e
fecha um `PopoverMenu`: a borda some com o menu (tipo 9, dono = a janela) e volta ao
fechar; sem erro de JS.

### Sigla do teclado sumiu com um layout só (2026-10-20)

Com só o `us+intl`, o Shell esconde o indicador (`_currentSourceChanged` em
`ui/status/keyboard.js`: menos de duas fontes e sem propriedades do IBus → `hide()`).
Chave nova `panel/keyboard-always-visible` (ligada de fábrica, Painel → Layout de
teclado → Sempre mostrar): `PanelService.keepKeyboardIndicator()` observa
`sources-changed` e `current-source-changed` depois do Shell e mostra de novo o
indicador e o rótulo do layout atual. Ensaiado em sessão isolada com um layout só:
ligada, "EN" na barra; desligada, some como no GNOME puro; sem erro de JS.

### Incidente: dconf da sessão apagado (2026-10-20)

Durante o ensaio, um `dconf reset -f /` rodou fora do `dbus-run-session` e zerou o dconf
real do usuário. Restaurado das cópias parciais (configuração da extensão de minutos
antes, `/org/gnome/shell`, interface, atalhos de janela do `baseline/`); o teclado ficou
só `us+intl` a pedido dele, e entrou o atalho personalizado `Super+Enter` → `ptyxis
--new-window` (o `window-swap-last-active` do mosaico foi esvaziado para liberar a
tecla). Perdidos sem cópia: papel de parede, energia, mouse/touchpad e ajustes de apps.
As cópias ficam em `~/.local/share/gnomecustom-backup/`. Regra: todo `dconf` de ensaio
dentro do `dbus-run-session`, e `dconf dump /` completo antes.

## Respiro nas pontas da barra (2026-11-02)

Pedido: aumentar o espaço entre a borda e os ícones das extremidades; e "barra em ilhas"
— que já existia (`theme/panel-islands`, ligada na máquina dele desde a rodada do WinDock).

- Chave nova `theme/panel-edge-padding` (u, 0–32, **6** de fábrica), em Tema → Barra
  superior → "Respiro nas pontas". Só na barra flutuante: colada, o botão do canto
  precisa encostar na borda (Fitts).
- O `#panel` ignora o próprio padding (o Panel aloca os trechos a partir do x 0), então o
  respiro vai em `#panelLeft` (esquerda) e `#panelRight` (direita); em ilhas, nos dois
  lados de cada uma das três.
- Conferido no Shell isolado com a configuração dele: ilhas com 0 e 6, faixa com 6;
  0 JS ERROR.

## Ilhas partidas e o que mais veio do WinDock (2026-11-02)

Pedido: escolher em que botão começa uma ilha nova; depois, "aplicar os mesmos conceitos
do WinDock" (lido até o 965a8cd, 2026-10-30).

- `panel/island-breaks` (as, vazia): ids dos botões que abrem uma ilha nova no trecho
  deles. Os nossos pelo id do módulo, os do GNOME pelo papel (`keyboard`,
  `quickSettings`, `dateMenu`); `apps-menu` separa o logo de "Aplicações". Interruptores
  em Painel → Ilhas.
- `lib/panel-islands.js` (puro) dá a forma de cada botão: sozinho, começo, meio, fim, e se
  há outra ilha antes/depois. Escondido não conta, e uma ilha toda escondida some (como no
  WinDock).
- O fundo e a borda saíram das caixas e foram para os botões
  (`gnomecustom-island-solo|start|middle|end`, `-split-before|after`); quem marca é
  `ShellPanelService.trackIslands()`, que remarca quando um filho entra, sai, aparece ou
  some. O módulo de tema liga isso quando as ilhas estão ativas.
- Do WinDock: a ponta da ilha é sempre redonda (metade da altura, não o
  `panel-radius`), e o vão entre ilhas (`panel-island-gap`) ganhou linha nas preferências.
- Do WinDock que **não** veio: o "nova ilha" dentro da lista de ordem (a nossa só ordena
  os nossos botões, os do GNOME não se movem) e o realce de hover recuado com o clique na
  coluna inteira (no St a margem tira a área de clique).
- Conferido no Shell isolado com a configuração dele: ilhas em logo | Aplicações | IA |
  sistema | EN | menu do sistema, e de volta à faixa; 0 JS ERROR.
