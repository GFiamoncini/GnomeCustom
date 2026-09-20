# LICENSE-AUDIT.md

Auditoria de licenciamento das fontes de referência.
Base: clones em `reference/`, commits fixados em `PROJECT-AUDIT.md`.
Data da auditoria: 2026-09-09.

> Este documento é a **fonte de verdade** sobre o que pode ou não ser copiado.
> Nenhuma linha de código de terceiros entra no projeto sem constar da tabela "Permitido copiar".

---

## 1. Evidência coletada por projeto

Para cada projeto foram verificados: (a) arquivo `LICENSE`/`LICENCE`/`COPYING`,
(b) cabeçalhos SPDX nos fontes, (c) cabeçalhos de licença em prosa nos fontes,
(d) declaração no `README`.

| Projeto | Arquivo de licença | SPDX nos fontes | Cabeçalho em prosa | README | Licença efetiva |
|---|---|---|---|---|---|
| gnome-shell-extensions (`apps-menu`, `user-theme`) | `COPYING` = GPL-2 + `LICENSES/` (REUSE) | `GPL-2.0-or-later` (33×), `MIT` (1×), `CC0-1.0` (5×), `CC-BY-SA-4.0` (2×) | — | — | **GPL-2.0-or-later** |
| dash-to-dock | `COPYING` = GPL-2 | ausente | ausente | "GNU GPL, **version 2 or later**" | **GPL-2.0-or-later** |
| forge | `LICENSE` = GPL-3 | `GPL-3.0-or-later` (2×) | "either version 3 …, **any later version**" (9×) | — | **GPL-3.0-or-later** |
| openbar | `LICENSE` = **GPL-3** | **`GPL-2.0-or-later`** (11×) | "either version **2** …, any later version" | — | **GPL-2.0-or-later** (ver §2) |
| osd-volume-number | `LICENSES/` (REUSE: GPL-3.0-or-later, MIT, CC-BY-SA-4.0) | `GPL-3.0-or-later` (10×) | — | — | **GPL-3.0-or-later** |
| impatience | `LICENCE` = GPL-3 "or later", © 2012 Tim Cuthbertson | ausente | ausente | — | **GPL-3.0-or-later** |
| bluetooth-battery-indicator | `LICENSE` = GPL-3 | ausente | ausente | não menciona | **GPL-3.0** (sem cláusula *or later*) |
| gnome-ui-tune | `LICENSE` = GPL-3 | ausente | ausente | não menciona | **GPL-3.0** (sem cláusula *or later*) |
| logomenu | `LICENSE` = **GPL-2** | ausente | ausente | não menciona | **GPL-2.0** (sem cláusula *or later*) |
| spotify-controls | `LICENSE` = GPL-3 | ausente | "either version 3 …, **any later version**" | não menciona | **GPL-3.0-or-later** |
| spotify-controller (NarkAgni, adicionada em 2026-09-10) | `LICENSE` = GPL-3 | ausente | "either version 3 …, **any later version**" (11×; `prefs.js` sem cabeçalho, não usado) | "GPL-3.0" | **GPL-3.0-or-later** |

## 2. Contradições e ambiguidades encontradas

### 2.1 Open Bar: `LICENSE` (GPL-3) × fontes (GPL-2.0-or-later)
Todos os 6 arquivos de código/estilo de `openbar@neuromorph/` declaram
`SPDX-License-Identifier: GPL-2.0-or-later` e o cabeçalho em prosa diz
"either version 2 of the License, or (at your option) any later version",
mas o repositório distribui o texto da **GPL-3**.

Interpretação adotada: **os cabeçalhos por arquivo prevalecem** para o código
(é a concessão explícita do autor sobre aquele arquivo). Como GPL-2.0-**or-later**
permite redistribuir sob GPL-3, a contradição **não bloqueia** o reuso; ela apenas
precisa ser registrada na atribuição.

### 2.2 Logo Menu: GPL-2 sem "or later" — **bloqueante**
`logomenu/LICENSE` é o texto da GPL-2, não há cabeçalho SPDX, não há cabeçalho em
prosa em nenhum `.js`, e o `README` não menciona licença. Não existe, portanto,
nenhuma concessão de "*or any later version*".

Consequência: na leitura conservadora o código é **GPL-2.0-only**, que é
**incompatível com GPL-3.0**. Código do Logo Menu **não pode** ser copiado para
um projeto GPL-3.

### 2.3 Bluetooth Battery Indicator e GNOME UI Tune: GPL-3 sem "or later"
Mesma ausência de cabeçalhos. Leitura conservadora: **GPL-3.0-only**.
Copiar código destes projetos é compatível com um projeto GPL-3, porém **contamina
a promessa "or later"**: a obra combinada passaria a ser GPL-3.0-only.

## 3. Licença recomendada para o GnomeCustom

**`GPL-3.0-or-later`**

Justificativa:
1. `forge` (GPL-3.0-or-later) e `osd-volume-number` (GPL-3.0-or-later) são as
   referências mais pesadas e mais prováveis de gerar código derivado; elas já
   impõem GPL-3 no piso.
2. Todas as demais fontes reutilizáveis são GPL-2.0-**or-later**, portanto
   *upgradáveis* para GPL-3.
3. Manter a cláusula *or later* preserva a compatibilidade com uma futura GPL-4 e
   com o ecossistema GNOME.

Para manter GPL-3.0-**or-later** honesta, o projeto **não copia** código de fontes
GPL-3.0-only nem GPL-2.0-only. Isso é consistente com a regra de ouro do briefing
("consolidar funcionalidades, não código") e apenas a torna obrigatória em três casos.

## 4. Regra operacional

### Permitido copiar / derivar código (com atribuição)
| Fonte | Licença | Ação exigida ao copiar |
|---|---|---|
| gnome-shell-extensions | GPL-2.0-or-later | manter © original + `SPDX-License-Identifier: GPL-3.0-or-later` no arquivo derivado e nota de origem |
| dash-to-dock | GPL-2.0-or-later | idem |
| openbar | GPL-2.0-or-later | idem + registrar a contradição do §2.1 em `NOTICE` |
| forge | GPL-3.0-or-later | idem |
| osd-volume-number | GPL-3.0-or-later | idem (repo segue REUSE; preservar `.license`) |
| impatience | GPL-3.0-or-later | idem (© 2012 Tim Cuthbertson) |
| spotify-controls | GPL-3.0-or-later | idem |
| spotify-controller | GPL-3.0-or-later | idem; atribuição registrada em `NOTICE` |

### Proibido copiar — apenas reimplementação independente
| Fonte | Motivo | Módulo afetado | Classificação forçada |
|---|---|---|---|
| logomenu | GPL-2.0-only → incompatível com GPL-3 | `modules/menu` | **REWRITE** |
| bluetooth-battery-indicator | GPL-3.0-only → destruiria a cláusula *or later* | `modules/bluetooth` | **REWRITE** |
| gnome-ui-tune | GPL-3.0-only → idem | `modules/overview` | **REWRITE** |

"Reimplementação independente" aqui significa: é legítimo **ler** o projeto para
entender qual API do Shell resolve o problema (a API é fato, não expressão), e
ilegítimo transcrever ou traduzir a expressão do código. Onde a estrutura for
inevitavelmente parecida por causa da API, documentar em `NOTICE` a inspiração.

> Divergência em relação ao briefing: a §31 classificava **Bluetooth** e
> **Logo Menu** como "B — Adaptar". A auditoria de licença os move para
> "A — Reimplementar". Nenhuma perda funcional: são 582 e 1240 LOC.

## 5. Arquivos MIT dentro de projetos GPL

Dois arquivos das referências têm licença **própria**, mais permissiva que a do
repositório que os hospeda. Foram descobertos ao estudar o código na Fase 2, e
mudam o que é possível reutilizar:

| Arquivo | Licença real | Origem | Consequência |
|---|---|---|---|
| `openbar/openbar@neuromorph/quantize.js` | **MIT** (+ bloco BSD do Protovis) | © 2008 Nick Rabinowitz; port de Olivier Lesnicki; ajustes de neuromorph | O algoritmo de quantização de cores **pode** ser copiado, inclusive para projetos não-GPL |
| `logomenu/selection.js` | **MIT** | © 2013 otto.allmendinger, © 2023 Aryan20; copiado de `meghprkh/force-quit` | O seletor de janela do "Force Quit" **pode** ser copiado, apesar de o resto do Logo Menu ser GPL-2.0-only |

O que o projeto fez com isso:

- **quantize.js**: nem copiado nem ignorado. O `theme/engine/quantize.js` é uma
  implementação própria de corte mediano, escrita a partir da descrição do
  algoritmo. O motivo não foi licença — foi manutenção: o arquivo original carrega
  um *shim* do Protovis e o padrão `if (!pv) var pv = {…}`, que não sobrevive a
  módulos ESM em modo estrito. O resultado foi conferido contra a paleta que o
  Open Bar gravou para o mesmo papel de parede, e as cores dominantes coincidem.
- **selection.js**: não copiado. O `services/shell/session.js` implementa a escolha
  de janela com `Main.pushModal` e `Meta.Window.kill()`, sem herdar o histórico do
  arquivo original.

Lição para as próximas fases: **verificar o cabeçalho de cada arquivo**, não só o
`LICENSE` do repositório. A licença do projeto é o piso, não a regra de cada arquivo.

## 6. Artefatos não-código

- Ícones/logos de distribuições no Logo Menu: ~~não reutilizar~~ **revisto em 2026-09-16, a
  pedido do usuário:** os 64 SVGs de `Resources/` (commit `cf988c0`, versão 24.8) são
  distribuídos **sem modificação** em `assets/logos/`, com o texto da GPL-2.0 ao lado
  (`LICENSE-GPL-2.0`) e um `README.md` de origem. Fundamento: são imagens carregadas como
  dados em tempo de execução, não código ligado ao GnomeCustom — obra separada distribuída
  junto (*aggregate*, GPL-2 §2 / GPL-3 §5), que mantém a licença de origem. Nenhum código do
  Logo Menu foi copiado; `lib/logos.js` só lista nomes de arquivo e a ordem das galerias
  (dados de configuração, para importar a escolha do usuário). Logotipos são marcas dos
  respectivos projetos.
- `CC-BY-SA-4.0` em gnome-shell-extensions e osd-volume-number cobre documentação
  e capturas de tela; irrelevante para o código, não copiar docs.

## 7. Pendências

- [x] Confirmar autoria/licença dos assets do `Resources/` do Logo Menu — primeiro resolvido
      por não usar imagem alguma; em 2026-09-16 os SVGs passaram a ser distribuídos como obra
      separada GPL-2.0 (ver §6).
- [x] Criar `NOTICE` com atribuição por arquivo derivado — criado em 2026-09-10 (apps-menu e
      spotify-controller); acrescentar uma entrada a cada nova derivação.
- [ ] Adicionar `LICENSE` (GPL-3.0-or-later) e cabeçalhos SPDX na Fase 1.
- [ ] Considerar conformidade REUSE (como gnome-shell-extensions e osd-volume-number).
