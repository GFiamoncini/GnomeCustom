// SPDX-FileCopyrightText: 2026 Gabriel Fiamoncini
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Módulo de tiling: substitui o Forge.
 *
 * É só a ponte. As decisões estão em `lib/tiling/controller.js` (testado fora do
 * Shell); aqui se liga o controlador ao Mutter (`services/shell/windows.js`),
 * ao GSettings, aos atalhos, à borda de foco e às configurações rápidas.
 *
 * Proteção contra dois gerenciadores ao mesmo tempo: se o Forge estiver ativo,
 * o módulo fica em espera — não registra atalhos nem move janelas — e volta
 * sozinho quando o Forge for desativado. Dois tilers disputando as mesmas
 * janelas deixam a área de trabalho inutilizável.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../../core/module.js';
import {TilingController} from '../../lib/tiling/controller.js';
import {TILING_ACTIONS} from '../../lib/tiling/actions.js';
import {SYSTEM_KEYBINDING_SCHEMAS, findCollisions} from '../../lib/shortcuts.js';
import {parseRules, serializeRules} from '../../lib/tiling/rules.js';
import {buildTokens} from '../../theme/engine/tokens.js';
import {FocusBorder} from '../../ui/tiling/focus-border.js';
import {TilingIndicator} from '../../ui/tiling/quick-toggle.js';

const FORGE_UUID = 'forge@jmmaranan.com';

/**
 * Espera antes de sair do modo de espera. O aviso de mudança de estado do Forge
 * chega enquanto ele ainda está desmontando: visto no Shell, ativar na hora fez
 * um atalho ser recusado porque o Forge ainda o segurava.
 */
const LEAVE_STANDBY_DELAY_MS = 750;

/** Espera antes de tentar de novo os atalhos que o Shell recusou. */
const KEYBINDING_RETRY_MS = 1500;


/** Chave do GSettings → campo da configuração do controlador. */
const CONFIG_KEYS = {
    'tiling-mode': 'tilingMode',
    'auto-split': 'autoSplit',
    'gap-size': 'gapSize',
    'gap-increment': 'gapIncrement',
    'gap-hidden-on-single': 'smartGaps',
    'float-always-on-top': 'floatOnTop',
    'focus-border': 'focusBorder',
    'resize-amount': 'resizeAmount',
    'drag-swap': 'dragSwap',
    'skip-workspaces': 'skipWorkspaces',
    'window-rules': 'rules',
};

export class TilingModule extends Module {
    static get id() {
        return 'tiling';
    }

    static get title() {
        return 'Tiling';
    }

    static get requires() {
        return ['windows', 'keybindings', 'quickSettings', 'style', 'shellExtensions'];
    }

    enable() {
        this._windows = this.service('windows');
        this._keybindings = this.service('keybindings');
        this._quickSettings = this.service('quickSettings');
        this._style = this.service('style');
        this._extensions = this.service('shellExtensions');

        this._settings = this.settings.child('tiling');
        this._bindingSettings = this.settings.child('tiling.keybindings');
        this._renderToken = undefined;
        this._active = false;

        this._controller = new TilingController({
            windows: this._windows,
            logger: this.log,
            requestRender: () => this._scheduleRender(),
            onRequestSetting: (key, value) => this._writeSetting(key, value),
        });
        this._controller.setConfig(this._readConfig());

        for (const [key, name] of Object.entries(CONFIG_KEYS)) {
            this.signals.connectSetting(this._settings, key, () => {
                this._controller.setConfig({[name]: this._readValue(key)});
                if (key === 'tiling-mode' || key === 'focus-border')
                    this._syncBorder();
            });
        }
        this.signals.connectSetting(this._settings, 'quick-settings-toggle', () => this._syncQuickToggle());

        this._unsubscribeStyle = this._style.onChanged(() => this._applyBorderStyle());
        this._unsubscribeExtensions = this._extensions.onStateChanged(uuid => {
            if (uuid === FORGE_UUID)
                this._evaluateStandby({immediate: false});
        });

        this._evaluateStandby();
    }

    disable() {
        this._unsubscribeExtensions?.();
        this._unsubscribeExtensions = null;
        this._unsubscribeStyle?.();
        this._unsubscribeStyle = null;

        this._cancelPendingActivation();
        this._deactivate();
        this._controller = null;

        this._windows = null;
        this._keybindings = null;
        this._quickSettings = null;
        this._style = null;
        this._extensions = null;
        this._settings = null;
        this._bindingSettings = null;
    }

    // ------------------------------------------------------ espera do Forge

    _evaluateStandby({immediate = true} = {}) {
        const forge = this._extensions.isRunning(FORGE_UUID);

        if (forge) {
            this._cancelPendingActivation();
            if (this._active || !this._standbyLogged) {
                this.log.warn('Forge ativo: tiling do GnomeCustom em espera até o Forge ser desativado');
                this._standbyLogged = true;
            }
            this._deactivate();
            return;
        }

        if (this._active)
            return;

        // Na habilitação da extensão, com o Forge já ausente, ativa na hora.
        // Saindo da espera, dá tempo de o Forge terminar de soltar os atalhos.
        if (immediate && !this._standbyLogged) {
            this._activate();
            return;
        }
        if (this._activationToken !== undefined)
            return;
        this._activationToken = this.signals.addTimeout(LEAVE_STANDBY_DELAY_MS, () => {
            this._activationToken = undefined;
            if (!this._extensions.isRunning(FORGE_UUID) && !this._active) {
                this.log.info('Forge desativado: tiling do GnomeCustom assumindo');
                this._standbyLogged = false;
                this._activate();
            }
            return false;   // GLib.SOURCE_REMOVE
        }, {label: 'tiling-leave-standby'});
    }

    _cancelPendingActivation() {
        if (this._activationToken !== undefined) {
            this.signals.removeSource(this._activationToken);
            this._activationToken = undefined;
        }
    }

    _activate() {
        this._active = true;

        this._unsubscribeWindows = this._windows.onEvent(event => this._onWindowEvent(event));
        this._controller.start();
        this._registerKeybindings();
        this._warnCollisions();

        this._border = new FocusBorder({logger: this.log});
        this._applyBorderStyle();
        this._syncQuickToggle();
        this._scheduleRender();
    }

    _deactivate() {
        if (!this._active)
            return;
        this._active = false;

        this._unsubscribeWindows?.();
        this._unsubscribeWindows = null;

        for (const spec of TILING_ACTIONS)
            this._keybindings.remove(spec.key);

        if (this._indicator) {
            this._quickSettings.remove(this._indicator);
            this._indicator = null;
        }

        this._border?.destroy();
        this._border = null;

        if (this._renderToken !== undefined) {
            this.signals.removeSource(this._renderToken);
            this._renderToken = undefined;
        }
        this._controller?.stop();
    }

    // -------------------------------------------------------------- eventos

    _onWindowEvent(event) {
        const c = this._controller;
        switch (event.type) {
        case 'added': {
            c.windowAdded(event.id);
            const desc = this._windows.describe(event.id);
            this.log.debug(`janela ${event.id} (${desc?.wmClass}, “${desc?.title}”): ` +
                c.explain(event.id));
            break;
        }
        case 'removed':
            c.windowRemoved(event.id);
            break;
        case 'changed':
            c.windowChanged(event.id, event.what);
            break;
        case 'focus':
            c.focusChanged(event.id);
            break;
        case 'grab-begin':
            c.grabBegin(event.id, event.op);
            break;
        case 'grab-end':
            c.grabEnd(event.id, event.op);
            break;
        case 'workspace-switched':
            c.workspaceSwitched();
            break;
        case 'monitors-changed':
            c.monitorsChanged();
            break;
        case 'workareas-changed':
            c.workAreasChanged();
            break;
        }
        this._syncBorder();
    }

    _scheduleRender() {
        if (!this._active || this._renderToken !== undefined)
            return;

        // Um único layout por rajada de eventos (abrir uma janela gera vários).
        this._renderToken = this.signals.addIdle(() => {
            this._renderToken = undefined;
            try {
                const moved = this._controller.render();
                if (moved > 0)
                    this.log.debug(`layout (${moved} movida(s)): ${this._controller.describeLayout()}`);
            } catch (e) {
                this.log.error('falha ao aplicar o layout', e);
            }
            this._syncBorder();
            return false;   // GLib.SOURCE_REMOVE
        }, {label: 'tiling-render'});
    }

    // ------------------------------------------------------- atalhos e UI

    _registerKeybindings(specs = TILING_ACTIONS, {retry = true} = {}) {
        const refused = [];
        for (const spec of specs) {
            // Pilha e abas não existem nesta fase: não roubar esses atalhos do
            // sistema para não fazer nada.
            if (spec.action.type === 'unsupported')
                continue;
            const ok = this._keybindings.add(spec.key, this._bindingSettings, () => {
                try {
                    if (spec.action.type === 'open-prefs')
                        this.ctx.extension.openPreferences();
                    else
                        this._controller.run(spec.action);
                } catch (e) {
                    this.log.error(`atalho '${spec.key}' falhou`, e);
                }
            });
            if (!ok && !this._keybindings.registered.includes(spec.key))
                refused.push(spec);
        }

        // Um atalho ainda preso por quem acabou de sair costuma ficar livre logo.
        if (refused.length > 0 && retry) {
            this.signals.addTimeout(KEYBINDING_RETRY_MS, () => {
                if (this._active)
                    this._registerKeybindings(refused, {retry: false});
                return false;   // GLib.SOURCE_REMOVE
            }, {label: 'tiling-keybinding-retry'});
        }
    }

    _warnCollisions() {
        const ours = TILING_ACTIONS
            .filter(spec => spec.action.type !== 'unsupported')
            .map(spec => ({key: spec.key, accels: this._bindingSettings.get_strv(spec.key)}));

        const theirs = [];
        const source = Gio.SettingsSchemaSource.get_default();
        for (const schemaId of SYSTEM_KEYBINDING_SCHEMAS) {
            const schema = source.lookup(schemaId, true);
            if (!schema)
                continue;
            const settings = new Gio.Settings({settings_schema: schema});
            for (const key of schema.list_keys()) {
                if (schema.get_key(key).get_value_type().dup_string() !== 'as')
                    continue;
                theirs.push({schema: schemaId, key, accels: settings.get_strv(key)});
            }
        }

        for (const collision of findCollisions(ours, theirs)) {
            this.log.warn(`atalho ${collision.accel} de '${collision.ours}' também é ` +
                `'${collision.theirs}' em ${collision.schema}`);
        }
    }

    _syncQuickToggle() {
        const wanted = this._active && this._settings.get_boolean('quick-settings-toggle');
        if (wanted && !this._indicator) {
            const _ = this.ctx.gettext;
            this._indicator = new TilingIndicator(this._settings, _('Tiling'));
            if (!this._quickSettings.add(this._indicator))
                this._indicator = null;
        } else if (!wanted && this._indicator) {
            this._quickSettings.remove(this._indicator);
            this._indicator = null;
        }
    }

    _applyBorderStyle() {
        if (!this._border)
            return;
        // Com o módulo de tema desligado não há tokens publicados; os padrões do
        // engine são o baseline do Forge (#9A9996, 3 px, raio 14).
        const tiling = this._style.tokens?.tiling ?? buildTokens({}).tiling;
        this._border.setStyle(tiling);
        this._syncBorder();
    }

    _syncBorder() {
        if (!this._border)
            return;

        const config = this._controller.config;
        const id = this._windows.focusedId();
        const desc = id !== null ? this._windows.describe(id) : null;

        const managed = desc && (this._controller.isTiled(id) || this._controller.isFloating(id));
        const visible = config.tilingMode && config.focusBorder && managed &&
            !desc.minimized && !desc.fullscreen && !desc.maximized &&
            !this._windows.overviewVisible;

        if (visible)
            this._border.show(this._windows.window(id), this._controller.borderSpaceFor(id));
        else
            this._border.hide();
    }

    // -------------------------------------------------------- configuração

    _readConfig() {
        const config = {};
        for (const [key, name] of Object.entries(CONFIG_KEYS))
            config[name] = this._readValue(key);
        return config;
    }

    _readValue(key) {
        if (key === 'window-rules') {
            const {rules, droppedById, invalid} = parseRules(this._settings.get_string(key));
            if (droppedById > 0)
                this.log.info(`${droppedById} regra(s) por id de janela ignorada(s)`);
            if (invalid > 0)
                this.log.warn(`${invalid} regra(s) de janela inválida(s) ignorada(s)`);
            return rules;
        }
        return this._settings.get_value(key).recursiveUnpack();
    }

    /** Grava o valor que o controlador pediu; ele volta por `setConfig`. */
    _writeSetting(key, value) {
        switch (key) {
        case 'window-rules':
            this._settings.set_string(key, serializeRules(value));
            break;
        case 'skip-workspaces':
            this._settings.set_value(key, new GLib.Variant('ai', value));
            break;
        case 'gap-increment':
            this._settings.set_uint(key, value);
            break;
        default:
            this._settings.set_boolean(key, Boolean(value));
        }
    }
}
