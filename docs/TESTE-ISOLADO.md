# Ensaio numa sessão isolada

No Wayland o Shell só carrega código novo depois de encerrar a sessão, e `Alt+F2 r`
não existe. Para exercitar a extensão de verdade **sem tocar na sessão em uso**, sobe-se
um `gnome-shell --headless` dentro de um `dbus-run-session`.

```sh
export XDG_CONFIG_HOME=/tmp/.../cfg XDG_CACHE_HOME=/tmp/.../cache
dbus-run-session -- sh -c '
  dconf write /org/gnome/shell/enabled-extensions "[\"gnomeCustom@gfiamoncini.com\"]"
  gnome-shell --headless --virtual-monitor 1600x900 --wayland-display ensaio &
  while ! gnome-extensions info gnomeCustom@gfiamoncini.com >/dev/null 2>&1; do sleep 1; done
  ...
'
```

## A pegadinha que já apagou configuração do usuário

`dconf` **não** escreve no arquivo apontado pelo `XDG_CONFIG_HOME` de quem chama: ele
escreve pelo serviço D-Bus. Exportar a variável e rodar `dconf write` **fora** do
`dbus-run-session` grava na configuração **real**. O isolamento só vale para o que roda
*dentro* da nova sessão D-Bus, onde o `dconf-service` nasce herdando a variável.

Foi assim que o `enabled-extensions` do usuário foi sobrescrito uma vez, apagando a lista
das extensões dele; só houve recuperação porque havia um dump prévio.

**Regra:** gravar `dconf dump /org/gnome/shell/ > baseline.ini` **antes** de exportar
`XDG_CONFIG_HOME` (o dump lê o banco apontado por ela) e pôr todo `dconf write` dentro do
script que roda sob `dbus-run-session`.

## O que **não** fica isolado

`XDG_RUNTIME_DIR` continua sendo o da sessão em uso, e é lá que o módulo de tema grava a
folha gerada (`/run/user/1000/gnomecustom/generated.css`). O Shell isolado **sobrescreve**
esse arquivo com a configuração do ensaio. A sessão real já carregou a dela e não nota na
hora, mas releria a do ensaio na próxima recarga de tema. Antes de encerrar, devolver as
chaves de tema do ensaio aos valores da sessão real, ou regravar o arquivo a partir da
configuração real (2026-10-07: ficou com ícone de 13 px e foi regravado à mão).

O **portal de documentos** também: o Shell isolado ativa o `org.freedesktop.portal.Documents`
no barramento novo, ele monta o FUSE em `/run/user/1000/doc` e desmonta ao fechar — levando
junto o da sessão real. Depois disso **nenhum Flatpak abre** (`bwrap: Can't find source path
/run/user/1000/doc/by-app/…`; em 2026-11-02 foi o GitHub Desktop pela dock). Ao fim de todo
ensaio, conferir e remontar:

```sh
mount | grep -q /run/user/1000/doc || systemctl --user restart xdg-document-portal.service
```

O som também é o real: clicar no mudo num ensaio muda o som de quem está usando a máquina.

No roteiro de cliques, apertar e soltar com ~80 ms entre os dois, e conferir a posição do
alvo numa captura antes: o ícone da sessão remota entra na barra e desloca os vizinhos.

## Captura de tela e OSD

`org.gnome.Shell.Eval` exige `unsafe_mode` e não há opção de linha de comando para ligá-lo.
Já `ShowOSD` e `Screenshot` usam `DBusSenderChecker`, que compara o remetente com o **dono
atual** de um nome autorizado — e na sessão isolada não há gsd. Então um gjs de dentro da
sessão pode assumir o nome e chamar os dois:

```js
Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.SettingsDaemon.MediaKeys',
    Gio.BusNameOwnerFlags.REPLACE, null, () => resolve(), () => resolve());
// depois: Screenshot (bbs) = (cursor, flash, caminho); ShowOSD a{sv} com icon/label/level
```

Sem isso, a chamada volta `AccessDenied: Screenshot is not allowed`. O vigia de nomes do
Shell precisa de ~1,5 s para ver a troca.

## Entrada (cliques e teclas)

`org.gnome.Mutter.RemoteDesktop` funciona no Shell headless sem verificação de remetente:
`CreateSession` → `Session.Start` → `NotifyPointerMotionAbsolute` /
`NotifyPointerButton(0x110, …)` / `NotifyKeyboardKeysym(keysym, …)`.

- O movimento **relativo** cai exato no alvo (sem aceleração): encostar no canto com
  `(-5000, ±5000)` e depois mover.
- O canto (0, 0) é o canto ativo e abre a visão geral; partir do canto **inferior**
  esquerdo evita isso. O ponteiro também **começa** em (0, 0).
- A sessão remota aparece como ícone laranja de compartilhamento na barra — não é da
  extensão.
- A tecla Super (`0xffeb`) não abre a visão geral; Esc (`0xff1b`) fecha.

## Reproduzir o ambiente do usuário

- Carregar os atalhos dele (`dconf dump` de `desktop/wm/keybindings`,
  `mutter/keybindings`, `shell/keybindings` → `dconf load` dentro da sessão). Com os
  padrões do GNOME, `Super+→` encaixa à direita e vence o mosaico: o ensaio sai
  contaminado e parece bug da extensão.
- Para problema visual da barra, exportar também
  `/org/gnome/shell/extensions/gnomecustom/` e `/org/gnome/desktop/interface/` — o tema
  muda a geometria.
- Temas de teste: `XDG_DATA_DIRS=<pasta com themes/>:/usr/local/share:/usr/share`.
- `XDG_CACHE_HOME` precisa apontar para o scratch se a extensão gravar cache.
- Um workspace só: `dynamic-workspaces false` e `num-workspaces 1`, dentro da sessão.
- Vários monitores: repetir `--virtual-monitor`; o primeiro é o principal.

## Apps de verdade dentro do ensaio

```sh
env WAYLAND_DISPLAY=ensaio GDK_BACKEND=wayland gnome-text-editor --standalone --new-window
env WAYLAND_DISPLAY=ensaio google-chrome --user-data-dir=... --ozone-platform=wayland about:blank
```

- **`gnome-text-editor` sem `--standalone` restaura a sessão real** (o estado fica em
  `~/.local/share`, fora do isolamento) e já abriu documento do usuário. Nunca digitar em
  janela de app real.
- **Nunca usar `pkill -f <nome do app>`**: o padrão casa com a linha de comando do próprio
  Bash tool (já matou o ensaio) e com o app da sessão real. Os apps abertos morrem sozinhos
  quando o Shell isolado fecha.
- O primeiro início de um app leva ~15 s.

## Ruído que não é da extensão

- `G_IS_SETTINGS` quando a primeira janela aparece e ~100 CRITICAL de
  `ibusCandidatePopup`/objetos descartados ao encerrar o Shell.
- 5 CRITICAL de `ListSearchResults` ao digitar na visão geral.
- Para classificar, rodar o mesmo roteiro **sem** a extensão.
- Prova de correção: remover a correção, repetir o roteiro e ver o defeito voltar.

## Cuidados

- O barramento de **sistema** é o real: nunca clicar em linhas do card de Bluetooth num
  ensaio (conecta/desconecta de verdade).
- No zsh, `rm -f padrão-*.png && …` sem arquivos casando aborta a cadeia inteira (nomatch).
