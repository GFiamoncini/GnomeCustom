// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Habilita `await` nas operações assíncronas do Gio/GdkPixbuf usadas no projeto.
 *
 * Existe um único módulo para isso porque `Gio._promisify` reclama ao ser
 * chamado duas vezes para o mesmo método; importar daqui garante que cada
 * método é preparado uma só vez, na primeira importação.
 *
 * Toda I/O do projeto é assíncrona: a extensão roda dentro do processo do Shell
 * e uma leitura síncrona de disco congela a interface inteira (§14 do briefing).
 */

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async',
    'new_from_stream_finish');

/** Importar este símbolo deixa explícito que o módulo depende das promessas. */
export const GIO_PROMISES_READY = true;
