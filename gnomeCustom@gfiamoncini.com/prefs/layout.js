// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Janela de preferências com menu lateral, como o app Configurações do GNOME.
 *
 * A janela padrão (`Adw.PreferencesWindow` com `add(page)`) põe as páginas em
 * abas; com doze páginas os títulos eram cortados (pedido do usuário,
 * 2026-09-16). Aqui cada página vira uma linha na lateral, com o título inteiro,
 * e a página escolhida ocupa o resto da janela. Numa janela estreita a lateral
 * vira uma tela de navegação.
 *
 * A busca embutida da janela padrão some junto com as abas; no lugar dela, o
 * campo no topo da lateral filtra as páginas pelo título e pelo texto das linhas
 * de cada uma.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

/** Largura abaixo da qual a lateral e a página passam a se alternar. */
const COLLAPSE_BELOW = 'max-width: 560sp';

/**
 * Textos pesquisáveis de uma página: títulos e subtítulos de grupos e linhas.
 *
 * @param {object} page Adw.PreferencesPage
 * @returns {string} tudo em minúsculas
 */
export function searchableText(page) {
    const parts = [page.title];
    const visit = widget => {
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            if (child instanceof Adw.PreferencesRow || child instanceof Adw.PreferencesGroup) {
                parts.push(child.title ?? '');
                if ('subtitle' in child)
                    parts.push(child.subtitle ?? '');
            }
            visit(child);
        }
    };
    visit(page);
    return parts.join('\n').toLowerCase();
}

/**
 * Monta a janela.
 *
 * @param {object} window Adw.PreferencesWindow recebida do Shell
 * @param {object[]} pages Adw.PreferencesPage, na ordem da lateral
 * @param {Function} _ tradução
 * @returns {{split: object, list: object, stack: object, search: object,
 *     select: Function}} peças, para os testes
 */
export function buildSidebarWindow(window, pages, _) {
    const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    const list = new Gtk.ListBox({
        css_classes: ['navigation-sidebar'],
        selection_mode: Gtk.SelectionMode.SINGLE,
    });

    const pageOf = new Map();   // linha -> página
    const rows = pages.map((page, index) => {
        stack.add_named(page, `page-${index}`);

        const box = new Gtk.Box({spacing: 12, margin_top: 6, margin_bottom: 6, margin_start: 6});
        box.append(new Gtk.Image({icon_name: page.icon_name ?? 'emblem-system-symbolic'}));
        box.append(new Gtk.Label({label: page.title, xalign: 0, hexpand: true}));
        const row = new Gtk.ListBoxRow({child: box});
        pageOf.set(row, page);
        list.append(row);
        return row;
    });

    const contentPage = new Adw.NavigationPage({title: pages[0]?.title ?? '', tag: 'content'});
    const contentView = new Adw.ToolbarView({content: stack});
    contentView.add_top_bar(new Adw.HeaderBar());
    contentPage.child = contentView;

    const search = new Gtk.SearchEntry({
        placeholder_text: _('Search settings'),
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 6,
    });

    const sidebarBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    sidebarBox.append(search);
    sidebarBox.append(new Gtk.ScrolledWindow({
        child: list,
        vexpand: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
    }));
    const sidebarView = new Adw.ToolbarView({content: sidebarBox});
    sidebarView.add_top_bar(new Adw.HeaderBar());
    const sidebarPage = new Adw.NavigationPage({title: 'GnomeCustom', tag: 'sidebar', child: sidebarView});

    const split = new Adw.NavigationSplitView({
        sidebar: sidebarPage,
        content: contentPage,
        min_sidebar_width: 220,
        max_sidebar_width: 280,
    });

    const select = row => {
        if (!row)
            return;
        stack.visible_child = pageOf.get(row);
        contentPage.title = pageOf.get(row).title;
        if (list.get_selected_row() !== row)
            list.select_row(row);
    };
    list.connect('row-activated', (_list, row) => {
        select(row);
        split.show_content = true;
    });
    list.connect('row-selected', (_list, row) => select(row));

    // O texto das páginas pode mudar (listas carregadas depois); relido a cada busca.
    list.set_filter_func(row => {
        const query = search.text.trim().toLowerCase();
        return query === '' || searchableText(pageOf.get(row)).includes(query);
    });
    search.connect('search-changed', () => {
        list.invalidate_filter();
        const selected = list.get_selected_row();
        if (!selected?.get_child_visible()) {
            const first = rows.find(row => row.get_child_visible());
            if (first)
                select(first);
        }
    });
    search.connect('activate', () => {
        const first = rows.find(row => row.get_child_visible());
        if (first) {
            select(first);
            split.show_content = true;
        }
    });

    const breakpoint = new Adw.Breakpoint({condition: Adw.BreakpointCondition.parse(COLLAPSE_BELOW)});
    breakpoint.add_setter(split, 'collapsed', true);
    window.add_breakpoint(breakpoint);

    window.search_enabled = false;
    // O diálogo do Shell confere `visible_page` depois de montar a janela e, sem
    // ela, troca o título por "Erro da extensão" e loga "did not provide any UI".
    // As páginas de verdade moram na pilha acima; esta, vazia, só existe para
    // ele e fica escondida atrás do `set_content`.
    window.add(new Adw.PreferencesPage({title: 'GnomeCustom'}));
    window.set_content(split);
    select(rows[0]);

    return {split, list, stack, search, select};
}
