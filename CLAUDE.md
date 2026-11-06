# GnomeCustom — guia para sessões de trabalho

Extensão única do GNOME Shell que substitui as 11 extensões que o usuário usava
(dash-to-dock, forge, openbar, logomenu, bluetooth-battery, osd-volume-number,
gnome-ui-tune, impatience, apps-menu, user-theme, spotify-controls). **Está em
produção na máquina dele**, instalada por symlink em
`~/.local/share/gnome-shell/extensions/`; desde 2026-09-22 é a única extensão ativa.

UUID `gnomeCustom@gfiamoncini.com`, licença GPL-3.0-or-later, build por `Makefile`
(meson não está instalado). Ambiente atual: Fedora 44, GNOME Shell 50.5, Mutter 50.5,
GJS 1.88, GTK 4.22, libadwaita 1.9, Wayland.

## Regras de trabalho

- **Nunca commitar na `main` nem dar push.** Commitar só quando o usuário pedir — às
  vezes ele pede só a mensagem e commita sozinho. O merge é dele. O README do git é o
  do GitHub ("Gnome Custom UI"): não sobrescrever.
- **`make check` antes e depois de mexer** (sintaxe, esquemas, testes do núcleo e
  `tests/prefs-smoke.js`).
- **Validar em sessão isolada, nunca na sessão em uso** — ver
  [docs/TESTE-ISOLADO.md](docs/TESTE-ISOLADO.md). Todo `dconf write` de teste vai
  **dentro** do `dbus-run-session`, e com dump antes.
- Código e comentários em **pt-BR**; `lib/` é puro e testável, os serviços isolam as
  APIs do Shell.
- Traduções: `make pot update-po`; o pt-BR fica completo, sem entradas `fuzzy`.
- Repositório em partição NTFS: ver §1 das [notas técnicas](docs/NOTAS-TECNICAS.md).

## Documentos

| Arquivo | Para quê |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | fases, critérios de aceite, marcos |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | as decisões registradas (AD-1…AD-32) |
| [docs/NOTAS-TECNICAS.md](docs/NOTAS-TECNICAS.md) | **pegadinhas de GJS, St, Mutter e ambiente** |
| [docs/TESTE-ISOLADO.md](docs/TESTE-ISOLADO.md) | **como ensaiar sem tocar na sessão** |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | versões suportadas; §7 = auditoria do GNOME 50, §8 = do 51 |
| [docs/LICENSE-AUDIT.md](docs/LICENSE-AUDIT.md) | §4: extensões cujo código **não pode** ser copiado |
| [docs/BASELINE-CONFIG.md](docs/BASELINE-CONFIG.md) | a configuração do usuário, que é o alvo funcional |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md), [docs/MIGRATION.md](docs/MIGRATION.md) | uso e troca das extensões |
| [docs/Melhorias/ANALISE.md](docs/Melhorias/ANALISE.md) | pedidos e defeitos relatados por ele, com o que foi feito |

## Decisões de desenho que valem mais que o briefing

- **volume:** número no lugar do ícone do OSD (patch de `OsdWindow.prototype.show`).
- **media:** barra com `[mini capa] nome`; card no estilo WinDock;
  `allowed-players` padrão `['spotify']`.
- **bluetooth:** só BlueZ; barra com ícone + % de cada conectado; vermelho em 20%.
- **dock:** só no monitor principal (o LG), fixo com struts, ícone até 24.
- **tiling:** flutuar por janela vive **só em memória** (o Forge gravava por `wmId` e
  isso quebrava o toggle); janela que flutua por tipo ou regra também fica no topo.
- **tema:** cores próprias da barra (estilo Dash to Dock), preto AMOLED por cópia do
  tema (`lib/amoled.js`), e o tema pode alcançar os aplicativos
  (`services/system/app-theme.js` + `app-tweaks.js`).
- **barra:** respiro dos botões próprio (`panel-button-padding`, 5 de fábrica) e, opcional,
  em ilhas; o WinDock (app dele, `github.com/GFBmsoft/WinDock`) é a referência de desenho.
- **clima:** módulo próprio com Open-Meteo (sem chave); cidade do usuário é
  **Rio do Sul – SC** (-27.21417, -49.64306); a busca é por nome, CEP não serve.

## O que nunca foi exercitado ao vivo

Rádio e conectar/desconectar do Bluetooth, o PiP do Firefox na visão geral, e o ícone de
atualizações sumindo depois de atualizar pelo Software (e o aviso de reinício). Da rodada
de 2026-10-07: o cartão compacto do Bluetooth e a barra em ilhas com janela maximizada.
Pedir ao usuário para testar em vez de afirmar que funcionam.
