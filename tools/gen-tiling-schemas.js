// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Gera os esquemas do tiling a partir das fontes em JS:
 *   lib/tiling/actions.js → …tiling.keybindings.gschema.xml
 *   lib/tiling/rules.js   → padrão de window-rules em …tiling.gschema.xml
 *
 * Uso: `make tiling-schemas`. Os testes conferem que esquema e fontes concordam.
 */

import GLib from 'gi://GLib';

const ROOT = GLib.get_current_dir();
const P = `file://${ROOT}/gnomeCustom@gfiamoncini.com`;
const {TILING_ACTIONS} = await import(`${P}/lib/tiling/actions.js`);
const {DEFAULT_RULES, serializeRules} = await import(`${P}/lib/tiling/rules.js`);
const DIR = `${ROOT}/gnomeCustom@gfiamoncini.com/schemas`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const header = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
  SPDX-License-Identifier: GPL-3.0-or-later
-->
<schemalist gettext-domain="gnomecustom">
`;

// ---- atalhos
let kb = header + `  <!-- Gerado a partir de lib/tiling/actions.js; um teste confere os dois. -->
  <schema id="org.gnome.shell.extensions.gnomecustom.tiling.keybindings"
          path="/org/gnome/shell/extensions/gnomecustom/tiling/keybindings/">
`;
for (const spec of TILING_ACTIONS) {
    const def = spec.accels.length ? `[${spec.accels.map(a => `'${esc(a)}'`).join(', ')}]` : '@as []';
    kb += `    <key name="${spec.key}" type="as">
      <default>${def}</default>
      <summary>${esc(spec.title)}</summary>
    </key>
`;
}
kb += `  </schema>
</schemalist>
`;
GLib.file_set_contents(`${DIR}/org.gnome.shell.extensions.gnomecustom.tiling.keybindings.gschema.xml`, kb);

// ---- configurações
const rulesJson = serializeRules([...DEFAULT_RULES]);
const t = header + `  <schema id="org.gnome.shell.extensions.gnomecustom.tiling"
          path="/org/gnome/shell/extensions/gnomecustom/tiling/">

    <key name="tiling-mode" type="b">
      <default>true</default>
      <summary>Tile windows</summary>
      <description>When off, the module stays loaded but every window floats. Toggled
      by the quick settings switch and the keyboard shortcut.</description>
    </key>
    <key name="auto-split" type="b">
      <default>false</default>
      <summary>Split automatically</summary>
      <description>A new window splits the focused one along its longer side, instead
      of joining the focused window's container.</description>
    </key>
    <key name="gap-size" type="u">
      <default>2</default>
      <range min="0" max="32"/>
      <summary>Gap size in pixels</summary>
      <description>Multiplied by the gap step. Windows are 2 × gap × step apart, and
      the same distance from the screen edges.</description>
    </key>
    <key name="gap-increment" type="u">
      <default>1</default>
      <range min="0" max="8"/>
      <summary>Gap step</summary>
      <description>Changed by the “increase gaps” and “decrease gaps” shortcuts.</description>
    </key>
    <key name="gap-hidden-on-single" type="b">
      <default>true</default>
      <summary>No gaps around a single window</summary>
    </key>
    <key name="float-always-on-top" type="b">
      <default>true</default>
      <summary>Keep floating windows above tiled ones</summary>
      <description>Applies to windows floated with the shortcut; the setting is undone
      when the window is tiled again or the module is turned off.</description>
    </key>
    <key name="focus-border" type="b">
      <default>true</default>
      <summary>Draw a border around the focused window</summary>
      <description>Its colour, thickness and corners come from the theme settings.</description>
    </key>
    <key name="resize-amount" type="u">
      <default>15</default>
      <range min="1" max="200"/>
      <summary>Pixels moved by each resize shortcut</summary>
    </key>
    <key name="drag-swap" type="b">
      <default>true</default>
      <summary>Swap windows by dragging</summary>
      <description>Dropping a tiled window over another swaps their places; dropping
      it elsewhere puts it back.</description>
    </key>
    <key name="quick-settings-toggle" type="b">
      <default>true</default>
      <summary>Show a tiling switch in quick settings</summary>
    </key>
    <key name="skip-workspaces" type="ai">
      <default>[]</default>
      <summary>Workspaces where tiling is off</summary>
      <description>Workspace indices, starting at 0.</description>
    </key>
    <key name="window-rules" type="s">
      <default>'${esc(rulesJson.replace(/'/g, "\\'"))}'</default>
      <summary>Windows that always float</summary>
      <description>JSON list of rules with “wmClass” and optionally “wmTitle”, in the
      format of Forge's windows.json. Rules by window id are ignored on purpose.</description>
    </key>
  </schema>
</schemalist>
`;
GLib.file_set_contents(`${DIR}/org.gnome.shell.extensions.gnomecustom.tiling.gschema.xml`, t);
print(`atalhos: ${TILING_ACTIONS.length}; regras: ${DEFAULT_RULES.length}; json ${rulesJson.length} bytes`);
