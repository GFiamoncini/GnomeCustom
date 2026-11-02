# Notas técnicas

Comportamentos do GJS, do St, do Mutter e do ambiente que custaram uma rodada de
depuração cada e **não aparecem em teste de unidade**. Registrados aqui para não
serem redescobertos; o ensaio que expôs a maioria delas está em
[TESTE-ISOLADO.md](TESTE-ISOLADO.md).

## 1. Ambiente: repositório em partição NTFS

`/mnt/3C0CEC910CEC478A` é `fuseblk` (ntfs-3g) montado com `user_id=0`, então todo
arquivo aparece como `root:root 0777`:

- o git recusa operar ("detected dubious ownership") — é preciso
  `git config --global --add safe.directory <caminho>`, **um por repositório**
  (inclusive cada clone dentro de `reference/`);
- `git config core.filemode false`, senão todo arquivo aparece como modificado;
- `sed -i` avisa "preservando permissões: Operação não permitida" — inofensivo, a
  edição é aplicada;
- symlinks, bit de execução e diferença de maiúsculas funcionam.

## 2. GJS e GSettings

**`await` de topo + `GLib.MainLoop` aninhado trava.** Um script `gjs -m` com `await`
de topo já roda dentro de um job de promessa; se algo ali dentro espera uma promessa
com `loop.run()`, o GJS não drena os jobs novos e o loop fica parado para sempre, sem
erro. Fontes GLib puras (`timeout_add` que chama `loop.quit()`) funcionam; promessas
não. Por isso `tests/harness.js` aceita testes `async`.

**`Gio.Settings.delay()` é permanente.** `apply()` grava o lote pendente, mas o objeto
continua em modo de atraso (`delay_apply === true`) e toda escrita posterior fica
pendente para sempre — numa janela de preferências, as edições feitas depois de
"aplicar um lote" somem. Para gravar em lote sem contaminar o objeto de quem chama,
usar um temporário: `new Gio.Settings({settings_schema, path, backend})`, `delay()` /
`set_value` / `apply()` nele, e descartar. Referência: `theme/presets/apply.js`.

Nenhuma das duas dá mensagem de erro: a primeira parece "teste lento", e a segunda só
aparece quando o valor é lido por **outro** objeto `Gio.Settings`.

## 3. St.Theme: folha de estilo adicional

Para somar CSS ao tema do Shell sem substituir o tema do usuário:
`St.ThemeContext.get_for_stage(global.stage).get_theme()` e então
`load_stylesheet(file)` / `unload_stylesheet(file)`. Duas armadilhas:

1. **`unload_stylesheet` faz o `St.ThemeContext` emitir `changed`** — quem observa
   `changed` para recarregar a própria folha reentra no meio da própria troca;
2. **`Main.loadTheme` já transporta as folhas adicionais** do tema antigo para o novo.
   Recarregar por conta própria depois de trocar de tema insere a mesma folha duas
   vezes, a lista interna do St fica inconsistente e o `Main.loadTheme` **seguinte**
   falha com `Argument file may not be null` e várias `g_object_ref: assertion
   'G_IS_OBJECT (object)' failed`.

Solução: uma trava booleana durante as operações próprias (o observador de `changed`
sai enquanto ela está ligada) e só recarregar se o arquivo realmente não estiver em
`theme.get_custom_stylesheets()` (comparar com `sheet.equal(file)`). Um caminho de
arquivo estável funciona: `unload`, reescrever o mesmo caminho, `load`. Referência:
`services/shell/theme.js`.

## 4. Mutter e tiling

1. **Auto-maximize + `allows_resize()`.** O Mutter maximiza sozinho janelas que abrem
   quase do tamanho da tela, e `meta_window_allows_resize()` devolve **falso enquanto
   maximizada**. Filtrar "tamanho fixo" por ele faz toda janela grande flutuar. Usar
   `window.resizeable` e desmaximizar no layout (`set_unmaximize_flags(BOTH)` +
   `unmaximize()` sem argumento).
2. **Foco antes de "pronto".** `notify::focus-window` aponta para a janela nova antes
   de ela ser mostrada; descartar eventos de janelas não prontas faz a nova nunca
   entrar no histórico de foco.
3. **Configure atrasado no Wayland.** Depois de `move_resize_frame`, `get_frame_rect()`
   só muda quando o cliente confirma; um segundo layout antes disso vê a janela "fora
   do lugar". Guardar o último retângulo pedido e esquecê-lo quando o estado muda por
   fora.
4. **Desativar outra extensão.** O aviso `extension-state-changed` chega antes de ela
   soltar os atalhos; registrar os mesmos na hora falha (`addKeybinding` devolve NONE).
   Esperar ~750 ms e repetir os recusados.
5. **Colisão de atalhos.** Coincidindo com um do Shell (ex. `<Super>v` =
   `toggle-message-tray`), o do Shell vence.
6. **Não gravar override por id de janela.** Foi o defeito do Forge: `Super+C` gravava
   `{wmClass, wmId, mode}` no `windows.json`, o resíduo sobrevivia à janela e o toggle
   daquele app só "piscava". Aqui, flutuar por janela vive **só em memória**.

## 5. Bordas, cantos e temas de janela

- A borda de foco do mosaico é desenhada **por fora** do quadro, ocupando o gap. O St
  desenha o arco interno com `raio − espessura`, então o raio configurado é o **raio da
  janela** e a borda cresce o que ficou de fora (`lib/tiling/geometry.js`).
- Janela flutuante não está na árvore: `gapFor()` devolvia 0 e a borda ia para dentro
  do quadro, deixando à mostra o anel de 1 px que a janela desenha. Usar
  `borderSpaceFor()`.
- Raios medidos: apps libadwaita 15 px, Chrome (modo GTK) segue o tema GTK. O
  Dracula-AMOLED arredonda com 15 px nos quatro cantos justamente por isso.

## 6. Outras pegadinhas do Shell

- `Clutter.BinLayout` centraliza filho de largura fixa mesmo com `x_align: START`.
- `glib-compile-schemas` lê em ordem alfabética: um enum definido em outro arquivo pode
  aparecer como "ainda não definido".
- `dconf write` numa chave `u` precisa de `"uint32 N"`.
- A visão geral usa o monitor inteiro (`MonitorConstraint({primary: true})`, sem
  workArea).
- A entrada de busca do Shell usa `offscreen_redirect`: pintá-la com altura zero dá
  CRITICAL no Cogl. Esconder = opacidade 0 **antes** da altura 0; mostrar = altura antes
  da opacidade.
- `BackgroundManager` põe o fundo por cima do contêiner; em miniaturas é preciso descê-lo.
- **GNOME 50:** `PanelMenu.Button` abre o menu por `Clutter.ClickGesture` em vez de
  `vfunc_event`, e chamar `super.vfunc_event` lança "Class StWidget doesn't implement
  event" (ver `ui/media/indicator.js`).
- O JS do Shell pode ser extraído da seção ELF `.gresource.shell_js_resources` de
  `libshell-18.so` com python + `Gio.Resource` (o binário `gresource` não está instalado).
  Com o `objcopy -O binary --only-section=…` sai o `.gresource` que o `Gio.Resource.load` lê.
- `opacity` no CSS não apaga o rótulo de um `St.Button` (nem com `:insensitive`, nem com
  classe): para um botão desligado, mudar a `color`.
- `ShellMountOperation(fonte)` chama `fonte.get_drive()`: recebe uma **montagem** ou um
  volume, nunca o próprio drive.
- Aparelho externo de teste não existe no ensaio: o monitor de volumes é o do sistema
  real. O card de externos foi conferido com um harness que alimenta o indicador com
  aparelhos falsos; ejetar de verdade só com pen-drive espetado.

## 7. Preferências e ciclo de vida

- As preferências rodam em **processo próprio**: mudanças nelas não pedem logout, só
  reabrir a janela. Já o código da extensão só carrega depois de encerrar a sessão.
- O GNOME desativa as extensões ao bloquear a tela, então o tema dos aplicativos
  (`services/system/app-theme.js`) **não** é desfeito no `disable()`.
- Testes de `AppThemeService` precisam receber um `tweaks` falso: o padrão mexe nos
  arquivos reais do usuário (VS Code, Obsidian, GitHub Desktop).
