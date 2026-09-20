// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Galeria de logotipos de distribuições para o botão do menu.
 *
 * As imagens ficam em `assets/logos/` e vêm do Logo Menu, com a licença GPL-2.0
 * de origem (ver o README daquela pasta e LICENSE-AUDIT.md §6). Nenhum código do
 * Logo Menu foi copiado: as listas de índices abaixo são dados, necessários para
 * importar a escolha que o usuário fez lá.
 *
 * Sem dependências do GNOME.
 */

const COLORED = new Set(('almalinux-logo arch-logo asahilinux-logo bazzite-logo cachyos-logo ' +
    'centos-logo clear-linux-logo debian-logo endeavouros_logo fedora-logo freebsd-logo ' +
    'gentoo-logo gnome-logo kali-linux-logo manjaro-logo netbsd-logo nixos-logo openbsd-logo ' +
    'opensuse-logo pop-os-logo redhat-logo rockylinux-logo shastraos-logo solus-logo ' +
    'steam-deck-le-logo steam-deck-logo tux-logo ublue-logo ubuntu-logo vanilla-logo void-logo ' +
    'zorin-logo').split(' '));

const SYMBOLIC = new Set(('almalinux-logo arch-logo asahilinux-logo budgie-logo cachyos-logo ' +
    'centos-logo debian-logo endeavouros_logo fedora-logo freebsd-logo garuda-logo gentoo-logo ' +
    'kali-linux-logo manjaro-logo mx-logo nixos-logo nobara-logo opensuse-logo pop-os-logo ' +
    'pureos-logo raspbian-logo redhat-logo rockylinux-logo shastraos-logo solus-logo ' +
    'steam-deck-logo tux-logo ublue-logo ubuntu-logo void-logo voyager-logo zorin-logo').split(' '));

/**
 * @typedef {object} Logo
 * @property {string} id
 * @property {string} title nome da distribuição (nome próprio, sem tradução)
 * @property {?string} colored arquivo da versão colorida
 * @property {?string} symbolic arquivo da versão monocromática
 */

/** @type {Logo[]} em ordem alfabética do título */
export const LOGOS = Object.freeze([
    ['almalinux', 'AlmaLinux', 'almalinux-logo'],
    ['arch', 'Arch Linux', 'arch-logo'],
    ['asahilinux', 'Asahi Linux', 'asahilinux-logo'],
    ['bazzite', 'Bazzite', 'bazzite-logo'],
    ['budgie', 'Budgie', 'budgie-logo'],
    ['cachyos', 'CachyOS', 'cachyos-logo'],
    ['centos', 'CentOS', 'centos-logo'],
    ['clear-linux', 'Clear Linux', 'clear-linux-logo'],
    ['debian', 'Debian', 'debian-logo'],
    ['endeavouros', 'EndeavourOS', 'endeavouros_logo'],
    ['fedora', 'Fedora', 'fedora-logo'],
    ['freebsd', 'FreeBSD', 'freebsd-logo'],
    ['garuda', 'Garuda Linux', 'garuda-logo'],
    ['gentoo', 'Gentoo', 'gentoo-logo'],
    ['gnome', 'GNOME', 'gnome-logo'],
    ['kali-linux', 'Kali Linux', 'kali-linux-logo'],
    ['manjaro', 'Manjaro', 'manjaro-logo'],
    ['mx', 'MX Linux', 'mx-logo'],
    ['netbsd', 'NetBSD', 'netbsd-logo'],
    ['nixos', 'NixOS', 'nixos-logo'],
    ['nobara', 'Nobara', 'nobara-logo'],
    ['openbsd', 'OpenBSD', 'openbsd-logo'],
    ['opensuse', 'openSUSE', 'opensuse-logo'],
    ['pop-os', 'Pop!_OS', 'pop-os-logo'],
    ['pureos', 'PureOS', 'pureos-logo'],
    ['raspbian', 'Raspberry Pi OS', 'raspbian-logo'],
    ['redhat', 'Red Hat', 'redhat-logo'],
    ['rockylinux', 'Rocky Linux', 'rockylinux-logo'],
    ['shastraos', 'ShastraOS', 'shastraos-logo'],
    ['solus', 'Solus', 'solus-logo'],
    ['steam-deck', 'Steam Deck', 'steam-deck-logo'],
    ['steam-deck-le', 'Steam Deck (LE)', 'steam-deck-le-logo'],
    ['tux', 'Tux', 'tux-logo'],
    ['ublue', 'Universal Blue', 'ublue-logo'],
    ['ubuntu', 'Ubuntu', 'ubuntu-logo'],
    ['vanilla', 'Vanilla OS', 'vanilla-logo'],
    ['void', 'Void Linux', 'void-logo'],
    ['voyager', 'Voyager', 'voyager-logo'],
    ['zorin', 'Zorin OS', 'zorin-logo'],
].map(([id, title, stem]) => Object.freeze({
    id,
    title,
    colored: COLORED.has(stem) ? `${stem}.svg` : null,
    symbolic: SYMBOLIC.has(stem) ? `${stem}-symbolic.svg` : null,
})));

/**
 * Ordem das galerias do Logo Menu (`constants.js`, versão 24.8), para importar
 * `menu-button-icon-image`. `null` = entrada sem arquivo aqui (o índice 0 da
 * simbólica é o ícone do tema, `start-here-symbolic`).
 */
export const LOGO_MENU_SYMBOLIC_ORDER = Object.freeze([null, 'fedora', 'debian', 'manjaro',
    'pop-os', 'ubuntu', 'arch', 'opensuse', 'raspbian', 'kali-linux', 'pureos', 'solus', 'budgie',
    'gentoo', 'mx', 'redhat', 'voyager', 'garuda', 'freebsd', 'tux', 'rockylinux', 'endeavouros',
    'almalinux', 'nixos', 'shastraos', 'asahilinux', 'zorin', 'void', 'nobara', 'steam-deck',
    'ublue', 'centos', 'cachyos']);

export const LOGO_MENU_COLORED_ORDER = Object.freeze(['fedora', 'debian', 'manjaro', 'pop-os',
    'ubuntu', 'arch', 'opensuse', 'kali-linux', 'solus', 'gentoo', 'redhat', 'freebsd', 'openbsd',
    'netbsd', 'tux', 'rockylinux', 'endeavouros', 'almalinux', 'nixos', 'shastraos', 'asahilinux',
    'zorin', 'vanilla', 'gnome', 'clear-linux', 'void', 'steam-deck', 'steam-deck-le', 'bazzite',
    'ublue', 'centos', 'cachyos']);

/** `ID` do os-release → logotipo, quando o nome não coincide. */
const OS_RELEASE_ALIASES = {
    'rhel': 'redhat', 'pop': 'pop-os', 'kali': 'kali-linux', 'opensuse-tumbleweed': 'opensuse',
    'opensuse-leap': 'opensuse', 'endeavouros': 'endeavouros', 'rocky': 'rockylinux',
    'almalinux': 'almalinux', 'garuda': 'garuda', 'raspbian': 'raspbian', 'vanilla': 'vanilla',
    'bazzite': 'bazzite', 'nobara': 'nobara', 'zorin': 'zorin', 'void': 'void', 'mx': 'mx',
};

/**
 * @param {string} id
 * @returns {?Logo}
 */
export function findLogo(id) {
    return LOGOS.find(logo => logo.id === id) ?? null;
}

/**
 * Logotipo da galeria que corresponde à distribuição em execução.
 *
 * @param {string} osReleaseId campo `ID` do os-release, ex. 'fedora'
 * @returns {string} id do logotipo; 'tux' quando não há correspondência
 */
export function logoForDistro(osReleaseId) {
    const id = String(osReleaseId ?? '').trim().toLowerCase();
    const mapped = OS_RELEASE_ALIASES[id] ?? id;
    return findLogo(mapped) ? mapped : 'tux';
}

/**
 * Arquivo a mostrar. Quando a variante pedida não existe para aquele logotipo,
 * usa a outra — melhor um logotipo colorido do que nenhum.
 *
 * @param {string} id '' escolhe pela distribuição
 * @param {boolean} monochrome
 * @param {string} [osReleaseId]
 * @returns {{logo: Logo, file: string, monochrome: boolean}}
 */
export function resolveLogo(id, monochrome, osReleaseId = '') {
    const logo = findLogo(id) ?? findLogo(logoForDistro(osReleaseId));
    const wanted = monochrome ? logo.symbolic : logo.colored;
    const file = wanted ?? logo.symbolic ?? logo.colored;
    return {logo, file, monochrome: file === logo.symbolic};
}

/**
 * Escolha feita no Logo Menu → galeria daqui.
 *
 * @param {number} index `menu-button-icon-image`
 * @param {boolean} symbolic `symbolic-icon`
 * @returns {?string} id do logotipo; null quando não há correspondência
 */
export function logoFromLogoMenu(index, symbolic) {
    const order = symbolic ? LOGO_MENU_SYMBOLIC_ORDER : LOGO_MENU_COLORED_ORDER;
    const id = Number.isInteger(index) ? order[index] : null;
    return id && findLogo(id) ? id : null;
}

/**
 * Diretório dos arquivos, a partir da posição deste módulo.
 *
 * @param {string} moduleUrl `import.meta.url` de quem chama não é necessário:
 *     usa o deste arquivo
 * @returns {string} caminho absoluto de `assets/logos/`
 */
export function logosDirectory(moduleUrl = import.meta.url) {
    const path = decodeURIComponent(moduleUrl.replace(/^file:\/\//, ''));
    return path.replace(/\/lib\/logos\.js$/, '/assets/logos/');
}
