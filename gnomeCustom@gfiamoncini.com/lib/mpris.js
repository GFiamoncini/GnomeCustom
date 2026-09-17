// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regras sobre players MPRIS, sem dependências.
 *
 * Usado pelo serviço `mpris` (processo do Shell) e pela página de preferências,
 * que lista os players para o usuário escolher quais aparecem na barra.
 *
 * Tempos seguem a unidade do MPRIS: microssegundos.
 */

export const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

/**
 * Identificador estável de um player a partir do nome no barramento.
 *
 * Firefox e Chromium acrescentam `.instance…` ao nome; o identificador ignora
 * esse sufixo, para que a escolha do usuário valha para qualquer janela do app.
 *
 * @param {string} busName ex. 'org.mpris.MediaPlayer2.firefox.instance_1_42'
 * @returns {?string} ex. 'firefox'; null se não for um nome MPRIS
 */
export function playerIdFromBusName(busName) {
    if (typeof busName !== 'string' || !busName.startsWith(MPRIS_PREFIX))
        return null;
    const id = busName.slice(MPRIS_PREFIX.length).split('.instance')[0];
    return id || null;
}

/**
 * Metadados MPRIS (já desempacotados) no formato usado pelo projeto.
 *
 * @param {?object} metadata chaves `xesam:*` e `mpris:*`
 * @returns {{trackId: string, title: string, artists: string[], album: string,
 *     artUrl: string, length: number}}
 */
export function normalizeMetadata(metadata) {
    const m = metadata ?? {};
    const text = value => (typeof value === 'string' ? value.trim() : '');
    const rawArtists = Array.isArray(m['xesam:artist']) ? m['xesam:artist'] : [m['xesam:artist']];
    const length = Number(m['mpris:length'] ?? 0);

    return {
        trackId: text(m['mpris:trackid']),
        title: text(m['xesam:title']),
        artists: rawArtists.map(text).filter(Boolean),
        album: text(m['xesam:album']),
        artUrl: text(m['mpris:artUrl']),
        length: Number.isFinite(length) && length > 0 ? length : 0,
    };
}

/**
 * Player a mostrar: só os permitidos, com faixa, e que não estejam parados.
 * Tocando vence pausado; entre iguais, vale a ordem da lista de permitidos.
 *
 * @param {Array<{id: string, status: string, track: object}>} players
 * @param {string[]} allowed ids em ordem de preferência
 * @returns {?object} o player escolhido, ou null
 */
export function pickPlayer(players, allowed) {
    const rank = id => allowed.indexOf(id);
    const candidates = players.filter(player =>
        rank(player.id) !== -1 && player.status !== 'Stopped' && player.track?.title);

    candidates.sort((a, b) =>
        Number(b.status === 'Playing') - Number(a.status === 'Playing') ||
        rank(a.id) - rank(b.id));

    return candidates[0] ?? null;
}

/**
 * Posição estimada a partir de uma âncora. O MPRIS não avisa quando `Position`
 * muda, então o tempo corre localmente desde a última leitura.
 *
 * @param {{position: number, at: number, playing: boolean, rate?: number}} anchor
 *     `at` no relógio monotônico, em microssegundos
 * @param {number} now relógio monotônico, em microssegundos
 * @param {number} [length] duração da faixa; 0 quando desconhecida
 * @returns {number}
 */
export function estimatePosition({position, at, playing, rate = 1}, now, length = 0) {
    let value = position + (playing ? Math.max(0, now - at) * rate : 0);
    if (length > 0)
        value = Math.min(value, length);
    return Math.max(0, value);
}

/**
 * @param {number} position
 * @param {number} length
 * @returns {number} 0 a 1
 */
export function progressFraction(position, length) {
    if (!(length > 0))
        return 0;
    return Math.min(1, Math.max(0, position / length));
}

/**
 * @param {number} microseconds
 * @returns {string} 'm:ss', ou 'h:mm:ss' a partir de uma hora
 */
export function formatTime(microseconds) {
    const total = Math.max(0, Math.floor(Number(microseconds) / 1e6)) || 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${minutes}:${seconds}`;
}

/**
 * Segunda linha do card: artistas e álbum, como no spotify-controller.
 *
 * @param {{artists: string[], album: string}} track
 * @returns {string}
 */
export function trackSubtitle(track) {
    return [track.artists.join(', '), track.album].filter(Boolean).join(' / ');
}

/**
 * Liga ou desliga um player na lista de permitidos, preservando a ordem.
 *
 * @param {string[]} list
 * @param {string} id
 * @param {boolean} enabled
 * @returns {string[]} lista nova
 */
export function toggleAllowed(list, id, enabled) {
    if (enabled)
        return list.includes(id) ? [...list] : [...list, id];
    return list.filter(entry => entry !== id);
}

const N_ = message => message;

/**
 * Ações de reprodução com atalho. `key` é a chave `as` no esquema de mídia (e o
 * nome do atalho no Shell, que é global — daí o prefixo); `method` é o método
 * de `org.mpris.MediaPlayer2.Player`.
 *
 * Padrões no espírito do WinDock (modificador + ← anterior, → próxima, ↑ tocar
 * ou pausar), trocando Alt por Super. Com Super, a única família de setas livre
 * é Ctrl+Alt+Super: Shift+Super move janelas no mosaico, Ctrl+Super←→ muda de
 * monitor e Alt+Super é dos workspaces e da visão geral no GNOME.
 */
export const MEDIA_ACTIONS = Object.freeze([
    {key: 'shortcut-play-pause', method: 'PlayPause', title: N_('Play or pause')},
    {key: 'shortcut-next', method: 'Next', title: N_('Next track')},
    {key: 'shortcut-previous', method: 'Previous', title: N_('Previous track')},
]);

/**
 * Player que recebe um comando. Primeiro o que está na barra; se nenhum está
 * (ex. o player parou), o primeiro permitido que estiver aberto — assim o atalho
 * de tocar ainda funciona depois de um "parar".
 *
 * @param {object[]} players
 * @param {string[]} allowed
 * @returns {?object}
 */
export function pickControlTarget(players, allowed) {
    const shown = pickPlayer(players, allowed);
    if (shown)
        return shown;

    const rank = id => allowed.indexOf(id);
    const open = players.filter(player => rank(player.id) !== -1)
        .sort((a, b) => rank(a.id) - rank(b.id));
    return open[0] ?? null;
}

/**
 * Se o player aceita o método agora, pelas propriedades `Can*` do MPRIS.
 * Propriedade ausente conta como sim: há players que não as publicam.
 *
 * @param {?{status: string, can?: object}} player
 * @param {string} method 'PlayPause' | 'Next' | 'Previous'
 * @returns {boolean}
 */
export function canInvoke(player, method) {
    if (!player)
        return false;
    const can = player.can ?? {};
    const allows = flag => can[flag] !== false;

    if (!allows('control'))
        return false;
    switch (method) {
    case 'PlayPause':
        return player.status === 'Playing' ? allows('pause') : allows('play');
    case 'Next':
        return allows('next');
    case 'Previous':
        return allows('previous');
    default:
        return false;
    }
}

/**
 * @param {string} status PlaybackStatus
 * @returns {string} ícone do botão de tocar/pausar
 */
export function playPauseIcon(status) {
    return status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
}
