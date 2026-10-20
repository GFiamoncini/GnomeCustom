// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Lista os Flatpaks com atualização, um por linha: `id<TAB>nome<TAB><TAB>ramo`.
 *
 * Roda **fora do Shell** (`gjs -m`), chamado por `services/system/updates.js`:
 * a busca da libflatpak é síncrona e vai à rede.
 *
 * Por que não o `flatpak remote-ls --updates`: em repositório OCI (o `fedora`)
 * ele compara o commit instalado com o resumo do servidor sem levar em conta o
 * `alt-id`, e lista como pendente o que o `flatpak update` e o GNOME Software
 * dizem estar em dia (relato do usuário, 2026-10-11: cinco "atualizações" que
 * ninguém conseguia instalar). `list_installed_refs_for_update` é a conta que o
 * Software faz.
 *
 * Saída: 0 com a lista; 3 sem a libflatpak; 1 quando nenhuma instalação respondeu.
 */

import System from 'system';

let Flatpak;
try {
    Flatpak = (await import('gi://Flatpak')).default;
} catch (e) {
    printerr(e.message);
    System.exit(3);
}

const installations = [];
try {
    installations.push(...Flatpak.get_system_installations(null));
} catch (e) {
    printerr(e.message);
}
try {
    installations.push(Flatpak.Installation.new_user(null));
} catch (e) {
    printerr(e.message);
}

let answered = 0;
let lastError = '';
for (const installation of installations) {
    try {
        for (const ref of installation.list_installed_refs_for_update(null)) {
            // A versão que a ref instalada conhece é a velha: a coluna fica vazia
            // e o card mostra o ramo.
            print([ref.get_name(), ref.get_appdata_name() ?? '', '', ref.get_branch() ?? '']
                .map(field => String(field).replace(/[\t\n]/g, ' ')).join('\t'));
        }
        answered++;
    } catch (e) {
        lastError = e.message;
        printerr(e.message);
    }
}

if (installations.length > 0 && answered === 0) {
    printerr(lastError);
    System.exit(1);
}
