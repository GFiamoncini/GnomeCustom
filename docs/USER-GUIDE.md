# Guia do usuário — GnomeCustom

Uma extensão para o GNOME Shell 49 que substitui, com uma configuração só, estas 11
extensões: Apps Menu, Logo Menu, Bluetooth Battery Indicator, OSD Volume Number, Spotify
Controls, Dash to Dock, GNOME UI Tune, Impatience, Forge, Open Bar e User Themes.

Cada função é um **módulo** que liga e desliga sozinho. Desativar a extensão devolve o GNOME
ao estado anterior.

---

## 1. Instalar

A partir do código-fonte:

```sh
make install        # instala por link simbólico (quem desenvolve)
# ou
make pack           # gera build/gnomeCustom@gfiamoncini.com.shell-extension.zip
gnome-extensions install build/gnomeCustom@gfiamoncini.com.shell-extension.zip
```

No Wayland o GNOME só enxerga uma extensão nova depois de **encerrar a sessão e entrar de novo**.
Depois disso, ative "GnomeCustom" no aplicativo Extensões e abra as preferências dela.

## 2. Trocar as extensões originais

A extensão chega com todos os módulos desligados: nada muda até você pedir.

1. **Migração → Importar todas.** Copia a configuração das extensões originais instaladas. Elas
   são só lidas. O relatório mostra o que mudou e o que não tem equivalente; **Desfazer** volta
   ao estado anterior.
2. **Geral → Perfil.** Escolha **Desktop** para ligar tudo e reproduzir as 11 extensões, ou outro
   perfil (tabela abaixo). Se alguma extensão original ainda estiver ativa, a janela avisa antes.
3. **Desative as extensões originais** no aplicativo Extensões. Enquanto as duas versões
   estiverem ativas, elas disputam a mesma função — a página **Avançado** mostra os conflitos.
   O mosaico é a exceção segura: com o Forge ativo ele fica em espera e não mexe em nada.
4. **Encerre a sessão e entre de novo.**

Para voltar atrás: desative o GnomeCustom e reative as extensões originais. A configuração delas
nunca é tocada.

### Perfis

| Perfil | O que liga |
|---|---|
| Nada ligado | nenhum módulo — as extensões originais seguem no comando |
| **Desktop** | todos os módulos, tema do papel de parede, animações 4× mais rápidas — o baseline |
| Desenvolvedor | tudo menos dock e mídia; mosaico com divisão automática; tema escuro |
| Notebook | tudo menos o dock; barra fina (tema Mínimo); mosaico ligado |
| Mínimo | só barra, menu do logotipo e número do volume |
| Jogos | tudo menos mosaico, dock e animação; tema escuro |

Mexer em qualquer opção coberta por um perfil faz o seletor mostrar **Personalizado**.

## 3. Módulos

| Módulo | Substitui | Onde configurar |
|---|---|---|
| Tema | Open Bar, User Themes | Tema: barra flutuante, cores do papel de parede, presets, tema do Shell |
| Painel | Apps Menu | Painel: menu de aplicações (`Alt+F1`), botão Atividades |
| Menu do logotipo | Logo Menu | Menu do logotipo |
| Bluetooth | Bluetooth Battery Indicator | Bluetooth: limite de bateria baixa |
| Volume | OSD Volume Number | — (o número substitui o ícone do aviso de volume) |
| Mídia | Spotify Controls | Mídia: players permitidos, posição, largura, controles na barra, atalhos (padrão Ctrl+Alt+Super + ← anterior, ↑ tocar/pausar, → próxima) |
| Mosaico | Forge | Mosaico: além dos atalhos do Forge, Ctrl+Shift+Super+setas cresce a janela, Super+T prende acima e Ctrl+Super+S abre estas preferências |
| Dock | Dash to Dock | Dock: tamanho dos ícones, comprimento, opacidade |
| Visão geral | GNOME UI Tune | Visão geral |
| Animação | Impatience | Animação: fator de velocidade |
| Mosaico | Forge | Mosaico: gaps, regras, atalhos |
| Cota de IA | — (novo; ideia do ai-usagebar, desenho do WinDock) | Cota de IA: contas mostradas, cota ao lado do ícone, card detalhado, intervalo, posição |
| Dispositivos externos | — (novo; do WinDock) | Dispositivos externos: só enquanto houver algo conectado, posição |

**Cota de IA:** quanto do plano do Claude já foi usado — a janela de 5 horas, a de 7 dias e
as que houver por modelo, o mesmo número do `/usage` do Claude Code. Toda pasta `~/.claude*`
com um login do Claude Code é uma conta (mais a que `CLAUDE_CONFIG_DIR` apontar); o card
mostra uma embaixo da outra. A seta no rodapé alterna entre o compacto (uma linha por janela)
e o detalhado (conta, e-mail e "zera em"). O GnomeCustom **só lê** a credencial do Claude
Code — nunca a grava nem a registra no log. Quando ela vence, o card diz "Sessão expirada"
até o próximo uso do Claude Code, que renova sozinho. A fonte não é uma API pública e pode
mudar sem aviso. A cota é consultada no máximo a cada dois minutos por conta; depois de um
`429`, o card espera o tempo pedido (ou dez minutos) mostrando os últimos números em âmbar.

**Dispositivos externos:** o ícone do pen-drive aparece na barra quando um pen-drive, cartão
de memória ou HD externo é montado, e some com o último. O card lista um **aparelho** por
linha — um HD com duas partições aparece uma vez, com as duas ao lado — e cada linha tem
**Abrir** (a pasta no Arquivos) e **Remover**. Remover é o mesmo "Remover com segurança" do
Arquivos: se algum programa ainda usa o aparelho, o GNOME diz qual e pergunta; o GnomeCustom
nunca força. Quando dá certo, o card diz que já pode desconectar. Discos internos não
aparecem.

**Animações desligadas no sistema:** no GNOME 49, com "Animações" desligado em
Acessibilidade, quase nada anima — o fator de velocidade só vale para as poucas animações
obrigatórias. A página Animação avisa quando é o caso.

## 4. Mosaico (tiling)

As janelas se organizam lado a lado. Novas janelas abrem ao lado da última usada; `Super+V` ou
`Super+K` antes de abrir escolhe a direção da divisão.

- **Flutuar uma janela:** `Super+C`. Vale só para aquela janela, enquanto ela existir.
- **Aplicações que sempre flutuam:** Mosaico → *Janelas que sempre flutuam* (por classe e,
  opcionalmente, título). Já vem com as 28 regras do Forge (calculadora, splash das IDEs…).
- **Arrastar** uma janela sobre outra troca as duas. Arrastar a borda ajusta a divisão.
- **Maximizar** uma janela em mosaico é desfeito; para maximizar, flutue-a antes. Tela cheia
  (vídeos, jogos) é respeitada.
- **Com o Forge ativo**, o módulo espera e não faz nada; assume sozinho quando o Forge for
  desativado.

### Atalhos

| Atalho | Ação |
|---|---|
| `Super+←` | Focar a janela à esquerda |
| `Super+→` | Focar a janela à direita |
| `Super+↑` | Focar a janela acima |
| `Super+↓` | Focar a janela abaixo |
| `Shift+Super+←` | Mover a janela para a esquerda |
| `Shift+Super+→` | Mover a janela para a direita |
| `Shift+Super+↑` | Mover a janela para cima |
| `Shift+Super+↓` | Mover a janela para baixo |
| `Ctrl+Super+H` | Trocar com a janela à esquerda |
| `Ctrl+Super+J` | Trocar com a janela abaixo |
| `Ctrl+Super+K` | Trocar com a janela acima |
| `Ctrl+Super+L` | Trocar com a janela à direita |
| `Super+Enter` | Trocar com a janela usada antes |
| `Super+K` | Dividir lado a lado |
| `Super+V` | Dividir uma sobre a outra |
| `Super+G` | Alternar a direção da divisão |
| `Super+C` | Flutuar ou encaixar esta janela |
| *(sem atalho)* | Sempre flutuar as janelas desta aplicação |
| `Ctrl+Super+I` | Aumentar pela borda de cima |
| `Shift+Ctrl+Super+U` | Diminuir pela borda de cima |
| `Ctrl+Super+U` | Aumentar pela borda de baixo |
| `Shift+Ctrl+Super+I` | Diminuir pela borda de baixo |
| `Ctrl+Super+Y` | Aumentar pela borda esquerda |
| `Shift+Ctrl+Super+O` | Diminuir pela borda esquerda |
| `Ctrl+Super+O` | Aumentar pela borda direita |
| `Shift+Ctrl+Super+Y` | Diminuir pela borda direita |
| `Ctrl+Alt+C` | Centralizar a janela |
| `Ctrl+Alt+D` | Encaixar no terço esquerdo |
| `Ctrl+Alt+G` | Encaixar no terço direito |
| `Ctrl+Alt+E` | Encaixar nos dois terços esquerdos |
| `Ctrl+Alt+T` | Encaixar nos dois terços direitos |
| `Ctrl+Super+Mais` | Aumentar o espaçamento |
| `Ctrl+Super+Menos` | Diminuir o espaçamento |
| `Super+X` | Mostrar ou esconder a borda de foco |
| `Shift+Super+P` | Ligar ou desligar o mosaico |
| `Shift+Super+W` | Ligar ou desligar o mosaico nesta área de trabalho |
| `Shift+Super+A` | Layout em pilha (indisponível) |
| `Shift+Super+T` | Layout em abas (indisponível) |
| `Ctrl+Alt+Y` | Decoração das abas (indisponível) |

**Atenção ao `Super+V`:** no GNOME ele também abre a bandeja de mensagens, e o atalho do GNOME
vence. Para usá-lo no mosaico, libere-o:

```sh
gsettings set org.gnome.shell.keybindings toggle-message-tray "['<Super>m']"
```

A página Avançado e o log (`make logs`) avisam sobre esse tipo de colisão.

## 5. Problemas

| Sintoma | O que fazer |
|---|---|
| Algo não aparece depois de ligar um módulo | Encerre a sessão se a extensão foi atualizada; veja o log com `make logs` ou `journalctl -f /usr/bin/gnome-shell \| grep GnomeCustom` |
| Quero mais detalhe no log | Geral → Registro → Depuração |
| Duas barras, dois docks, janelas "brigando" | Uma extensão original continua ativa; a página Avançado lista qual |
| Uma janela não entra no mosaico | Diálogos, janelas de tamanho fixo e as de regra flutuam; o log em Depuração diz o motivo de cada janela |
| Um atalho do mosaico não funciona | Veja no log se ele colide com um atalho do GNOME |
| Quero voltar à configuração de antes da importação | Migração → Desfazer |
| Quero voltar às extensões originais | Desative o GnomeCustom, reative as originais, encerre a sessão |

## 6. Desinstalar

```sh
gnome-extensions disable gnomeCustom@gfiamoncini.com
make uninstall                              # ou: gnome-extensions uninstall gnomeCustom@gfiamoncini.com
dconf reset -f /org/gnome/shell/extensions/gnomecustom/   # opcional: apaga a configuração
```

## 7. Compatibilidade

Testado no **GNOME Shell 49** (Fedora 43), Wayland. O GNOME 50 não é declarado enquanto não for
testado — ver `COMPATIBILITY.md` §6.
