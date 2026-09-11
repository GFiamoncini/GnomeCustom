# SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
# SPDX-License-Identifier: GPL-3.0-or-later
#
# `meson` não está instalado no ambiente-alvo (Fedora 43); o build é feito aqui
# (decisão AD-7 em docs/ARCHITECTURE.md).

UUID          := gnomeCustom@gfiamoncini.com
SRC           := $(UUID)
SCHEMA_ID     := org.gnome.shell.extensions.gnomecustom
GETTEXT       := gnomecustom
EXT_DIR       := $(HOME)/.local/share/gnome-shell/extensions
TARGET        := $(EXT_DIR)/$(UUID)
BUILD         := build
CURDIR        := $(shell pwd)

JS_FILES      := $(shell find $(SRC) tests -name '*.js' 2>/dev/null)
# Subdiretórios do fonte que o `gnome-extensions pack` precisa receber
# explicitamente; descobertos em vez de listados à mão, para que uma pasta nova
# não fique fora do pacote.
EXTRA_DIRS    := $(patsubst $(SRC)/%,%,$(shell find $(SRC) -mindepth 1 -maxdepth 1 -type d \
                   -not -name schemas -not -name locale 2>/dev/null))
EXTRA_SOURCES := $(addprefix --extra-source=,$(EXTRA_DIRS))
PO_FILES      := $(wildcard po/*.po)
MO_FILES      := $(patsubst po/%.po,$(SRC)/locale/%/LC_MESSAGES/$(GETTEXT).mo,$(PO_FILES))

.DEFAULT_GOAL := help

# ----------------------------------------------------------------- ajuda

.PHONY: help
help:
	@echo 'GnomeCustom — alvos disponíveis:'
	@echo ''
	@echo '  make build        compila esquemas e traduções'
	@echo '  make test         executa a suíte do núcleo (gjs)'
	@echo '  make test-prefs   monta as páginas de preferências de verdade'
	@echo '  make lint         verifica sintaxe de todo o JavaScript'
	@echo '  make check        lint + test + test-prefs + validação do esquema'
	@echo ''
	@echo '  make install      instala por symlink (desenvolvimento)'
	@echo '  make install-copy instala copiando os arquivos'
	@echo '  make uninstall    remove a instalação'
	@echo '  make pack         gera o .zip para distribuição'
	@echo ''
	@echo '  make enable       habilita a extensão na sessão atual'
	@echo '  make disable      desabilita a extensão'
	@echo '  make prefs        abre as preferências'
	@echo '  make info         mostra o estado da extensão'
	@echo '  make logs         acompanha o journal filtrado por [GnomeCustom]'
	@echo '  make nested       abre um GNOME Shell aninhado para testar'
	@echo ''
	@echo '  make pot          regenera po/$(GETTEXT).pot'
	@echo '  make update-po    atualiza os .po a partir do .pot'
	@echo '  make clean        remove artefatos gerados'

# ----------------------------------------------------------------- build

.PHONY: build
build: schemas locale

.PHONY: schemas
schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas/
	@echo 'esquemas compilados'

.PHONY: locale
locale: $(MO_FILES)

$(SRC)/locale/%/LC_MESSAGES/$(GETTEXT).mo: po/%.po
	@mkdir -p $(dir $@)
	msgfmt --check -o $@ $<
	@echo 'tradução compilada: $*'

# ------------------------------------------------------------ verificação

.PHONY: check
check: lint schemas-check test test-prefs

.PHONY: schemas-check
schemas-check:
	@glib-compile-schemas --strict --dry-run $(SRC)/schemas/ && echo 'esquema válido'

# `node --check` só aceita ESM em arquivos .mjs, daí a cópia temporária.
.PHONY: lint
lint:
	@fail=0; tmp=$$(mktemp -d); \
	for f in $(JS_FILES); do \
		cp "$$f" "$$tmp/check.mjs"; \
		if ! node --check "$$tmp/check.mjs" 2>&1 | sed "s|$$tmp/check.mjs|$$f|"; then fail=1; fi; \
	done; \
	rm -rf "$$tmp"; \
	if [ $$fail -eq 0 ]; then echo "sintaxe OK em $(words $(JS_FILES)) arquivo(s)"; fi; \
	if [ -x node_modules/.bin/eslint ]; then node_modules/.bin/eslint $(SRC) tests || fail=1; \
	else echo '(eslint não instalado; apenas a verificação de sintaxe foi executada)'; fi; \
	exit $$fail

.PHONY: test
test:
	@gjs -m tests/run.js

# As páginas de preferências usam Gtk/Adw, então este alvo precisa de um display.
# `GSETTINGS_BACKEND=memory` garante que nada é escrito no dconf do usuário, e
# `GI_TYPELIB_PATH` expõe o Shew, exigido pelo recurso de preferências do Shell.
.PHONY: test-prefs
test-prefs: build
	@if [ -z "$$WAYLAND_DISPLAY" ] && [ -z "$$DISPLAY" ]; then \
		echo '(sem display; test-prefs foi ignorado)'; \
	else \
		GSETTINGS_BACKEND=memory \
		GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 \
		LD_LIBRARY_PATH=/usr/lib64/gnome-shell \
		gjs -m tests/prefs-smoke.js 2>&1 | grep -v 'Theme parser error'; \
	fi

# ------------------------------------------------------------ instalação

.PHONY: install
install: build
	@mkdir -p $(EXT_DIR)
	@if [ -e $(TARGET) ] && [ ! -L $(TARGET) ]; then \
		echo 'ERRO: $(TARGET) existe e não é um symlink. Remova antes (make uninstall).'; \
		exit 1; \
	fi
	@ln -sfn $(CURDIR)/$(SRC) $(TARGET)
	@echo 'symlink criado: $(TARGET) -> $(CURDIR)/$(SRC)'
	@echo 'no Wayland é preciso encerrar e reiniciar a sessão para o Shell ver a extensão nova'

.PHONY: install-copy
install-copy: build
	@mkdir -p $(TARGET)
	@rm -rf $(TARGET)
	@cp -r $(SRC) $(TARGET)
	@echo 'instalado em $(TARGET)'

.PHONY: uninstall
uninstall:
	@rm -rf $(TARGET)
	@echo 'removido: $(TARGET)'

.PHONY: pack
pack: build
	@mkdir -p $(BUILD)
	@gnome-extensions pack $(SRC) \
		--podir=../po \
		--gettext-domain=$(GETTEXT) \
		$(EXTRA_SOURCES) \
		--force --out-dir=$(BUILD)
	@echo 'pacote em $(BUILD)/$(UUID).shell-extension.zip ($(words $(EXTRA_DIRS)) subdiretórios)'
	@# Confere que todo .js do fonte entrou no pacote.
	@missing=0; for f in $(patsubst $(SRC)/%,%,$(shell find $(SRC) -name '*.js')); do \
		unzip -l $(BUILD)/$(UUID).shell-extension.zip | grep -q " $$f$$" || \
			{ echo "AUSENTE no pacote: $$f"; missing=1; }; \
	done; \
	if [ $$missing -eq 0 ]; then echo 'todos os arquivos .js estão no pacote'; else exit 1; fi

# --------------------------------------------------------------- sessão

.PHONY: enable
enable:
	gnome-extensions enable $(UUID)

.PHONY: disable
disable:
	gnome-extensions disable $(UUID)

.PHONY: prefs
prefs:
	gnome-extensions prefs $(UUID)

.PHONY: info
info:
	@gnome-extensions info $(UUID)

.PHONY: logs
logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered GnomeCustom

# Sessão aninhada: a única forma prática de testar no Wayland sem sair da sessão.
.PHONY: nested
nested: install
	env MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x800 \
		dbus-run-session -- gnome-shell --nested --wayland

# ----------------------------------------------------------- traduções

.PHONY: pot
pot:
	xgettext --from-code=UTF-8 --keyword=_ --keyword=C_:1c,2 \
		--package-name=GnomeCustom --package-version=0.1.0 \
		--copyright-holder="Gabriel Fiamoncini" \
		--msgid-bugs-address="https://github.com/gfiamoncini/gnomecustom/issues" \
		--files-from=po/POTFILES.in --output=po/$(GETTEXT).pot
	@echo 'po/$(GETTEXT).pot atualizado'

.PHONY: update-po
update-po: pot
	@for po in $(PO_FILES); do \
		msgmerge --update --backup=none "$$po" po/$(GETTEXT).pot; \
	done

# ------------------------------------------------------------- limpeza

.PHONY: clean
clean:
	rm -f $(SRC)/schemas/gschemas.compiled
	rm -rf $(SRC)/locale $(BUILD)
	@echo 'artefatos removidos'
