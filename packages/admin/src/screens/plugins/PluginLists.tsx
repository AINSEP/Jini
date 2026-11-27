import type { ComponentType } from "react";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import type { PluginRules } from "./rules.js";
import type { PluginsController } from "./hooks/use-plugins.hooks.js";
import type { PluginsProps, PluginsTabId } from "./Plugins.js";
/** The Installed tab's own row list — the Enable/Disable toggle unchanged from the pre-split table,
 *  now living in the row's action slot instead of a `DataTable` cell. */
export function InstalledPluginRows({
  hooks, deps, kit,
  plugins,
  controller,
  expandedIds,
  onToggleExpanded,
  rowHandleById,
  focusPluginId,
}: {
  plugins: AdminPluginDto[];
  controller: PluginsController;
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (required: { id: string }, optional?: Record<string, never>) => void;
  rowHandleById: Map<string, string>;
  focusPluginId?: string | null | undefined;
} & Pick<PluginsProps, "hooks" | "deps" | "kit">) {

  const { useAdminLocale } = hooks;
  const { pluginToggleAriaLabel, pluginToggleControl } = deps;
  const { t, locale, rowSavingId, onToggleEnabled } = controller;
  return (
    <ul className="plugin-rows">
      {plugins.map((plugin) => {
        const control = pluginToggleControl({ plugin, rowSavingId, locale });
        const handle = rowHandleById.get(plugin.id);
        if (handle === undefined) throw new Error(`plugin ${plugin.id} has no row handle`);
        return installedPluginRow({ plugin, controller, expandedIds, onToggleExpanded, focusPluginId, handle, control, t, locale, onToggleEnabled, useAdminLocale, pluginToggleAriaLabel, kit });
      })}
    </ul>
  );
}

/** The Downloaded tab's own row list. Every row carries Remove (confirm-gated, see this file's own
 *  header), usable only when {@link pluginRemoveBlocker} finds no reason `PLUGIN_UNINSTALL` would
 *  refuse; otherwise it is disabled and described by the matching section note. A disabled row
 *  also gets a direct, unconfirmed Enable. Before the 2026-09-10 fix there was no control anywhere
 *  on this screen to re-enable a plugin once disabled — including a quarantined one — short of
 *  removing and reinstalling it.
 *
 *  Enable is offered regardless of `source`: unlike Remove (irreversibly destructive for a real
 *  on-disk artifact, so a built-in row's Remove stays honestly disabled), turning a plugin back on
 *  has no comparable cost, so a built-in row gets the same direct control a site-sourced one does. */
export function DownloadedPluginRows({
  hooks, deps, kit,
  plugins,
  controller,
  expandedIds,
  onToggleExpanded,
  rowHandleById,
  onRequestRemove,
}: {
  plugins: AdminPluginDto[];
  controller: PluginsController;
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (required: { id: string }, optional?: Record<string, never>) => void;
  rowHandleById: Map<string, string>;
  onRequestRemove: (plugin: AdminPluginDto) => void;
} & Pick<PluginsProps, "hooks" | "deps" | "kit">) {

  const { useAdminLocale } = hooks;
  const { PluginRow } = kit;
  const { pluginRemoveBlocker } = deps;
  const { t, locale, rowSavingId, onToggleEnabled } = controller;
  return (
    <ul className="plugin-rows">
      {plugins.map((plugin) => {
        const handle = rowHandleById.get(plugin.id);
        if (handle === undefined) throw new Error(`plugin ${plugin.id} has no row handle`);
        const removeBlocker = pluginRemoveBlocker(plugin);
        const busy = rowSavingId === plugin.id;
        const action = DownloadedPluginAction({ plugin, t, locale, onToggleEnabled, onRequestRemove, removeBlocker, busy, deps, kit });
        return (
          <PluginRow
            key={plugin.id}
            useAdminLocaleHook={useAdminLocale}
            plugin={plugin}
            t={t}
            expanded={expandedIds.has(plugin.id)}
            onToggleExpanded={() => onToggleExpanded({ id: plugin.id })}
            agentHandleBase={handle}
            onInspect={() => controller.onInspectPlugin(plugin.id)}
            {...(plugin.providerSettings ? { onSettings: () => controller.onOpenSettings(plugin.id) } : {})}
            action={action}
          />
        );
      })}
    </ul>
  );
}

/** Every tab panel's inputs — one shape, so {@link PLUGINS_TAB_PANELS} can pick a panel by tab id. */
interface PluginsTabPanelProps extends Pick<PluginsProps, "hooks" | "deps" | "kit"> {
  plugins: AdminPluginDto[];
  controller: PluginsController;
  rowHandleById: Map<string, string>;
  focusPluginId?: string | null | undefined;
}

/** The Downloaded tab's two Remove notes, by {@link pluginRemoveBlocker} reason — a disabled Remove
 *  points at the one that explains it. */
const PLUGINS_REMOVE_NOTE_IDS = {
  "built-in": "plugins-remove-unavailable-note",
  enabled: "plugins-remove-enabled-note",
} as const;

/** Installed: every installed plugin, on or off, or an honest empty note when there are none. */
function InstalledPanel({ hooks, deps, kit, plugins, controller, rowHandleById, focusPluginId }: PluginsTabPanelProps) {

  const { t } = controller;
  if (plugins.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>{t("No plugins installed.")}</p>
          <p className="page-description">{t("Enabled plugins extend what this site can do.")}</p>
        </div>
      </div>
    );
  }
  return (
    <InstalledPluginRows
      {...{ hooks, deps, kit }}
      plugins={plugins}
      controller={controller}
      expandedIds={controller.expandedIds}
      onToggleExpanded={controller.onToggleExpanded}
      rowHandleById={rowHandleById}
      focusPluginId={focusPluginId}
    />
  );
}

/** Downloaded: the two remove notes as compact helper text under the tabs, then every plugin — or
 *  its own empty state. The notes sat under the list until the owner moved them up (2026-10-07). */
function DownloadedPanel({ hooks, deps, kit, plugins, controller, rowHandleById }: PluginsTabPanelProps) {

  const { t } = controller;
  if (plugins.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>{t("No plugins installed.")}</p>
          <p className="page-description">
            {t(
              "A new one appears here on the next load, once it's unpacked into the site's plugin install directory.",
            )}
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="plugins-remove-notes">
        <p id={PLUGINS_REMOVE_NOTE_IDS["built-in"]} className="page-description">
          {t(deps.builtInNote)}
        </p>
        <p id={PLUGINS_REMOVE_NOTE_IDS.enabled} className="page-description">
          {t("Turn a plugin off on Installed before removing it.")}
        </p>
      </div>
      <DownloadedPluginRows
      {...{ hooks, deps, kit }}
        plugins={plugins}
        controller={controller}
        expandedIds={controller.expandedIds}
        onToggleExpanded={controller.onToggleExpanded}
        rowHandleById={rowHandleById}
        onRequestRemove={controller.onRequestRemove}
      />
    </>
  );
}

/** Marketplace: a designed empty state — see this file's header for why nothing is listed. Same
 *  capped, centered card as Agent Plugins' Marketplace (owner, 2026-10-17: it ran the full column),
 *  so it reuses that screen's `agent-plugins-marketplace-*` classes rather than a second copy. */
function MarketplacePanel({ deps, kit, controller }: PluginsTabPanelProps) {

  const { t } = controller;
  const { MarketplaceTabIcon } = kit;
  return (
    <div className="agent-plugins-marketplace-empty" role="note">
      <span className="agent-plugins-marketplace-glyph">
        <MarketplaceTabIcon size={28} />
      </span>
      <h3>{t("Nothing to browse yet")}</h3>
      <p>{t(deps.marketplaceNote)}</p>
      {controller.canInstallFolder ? null : (
        <p>{t("Install a plugin by placing its files in this site's plugin install directory.")}</p>
      )}
    </div>
  );
}

/** Add a plugin: the shared install card. Without an install controller (a test hook that omits
 *  it) the tab is empty; on a server that refuses local installs the tab is disabled and never
 *  resolves here. */
function AddPanel({ deps, kit, controller }: PluginsTabPanelProps) {

  const { productName } = deps;
  const { AddPluginPanel } = kit;
  return controller.install ? <AddPluginPanel controller={controller.install} productName={productName} /> : null;
}

export const PLUGINS_TAB_PANELS: Record<PluginsTabId, ComponentType<PluginsTabPanelProps>> = {
  installed: InstalledPanel,
  downloaded: DownloadedPanel,
  add: AddPanel,
  marketplace: MarketplacePanel,
};

function DownloadedPluginAction({ plugin, t, locale, onToggleEnabled, onRequestRemove, removeBlocker, busy, deps, kit }: Pick<Parameters<typeof DownloadedPluginRows>[0], "onRequestRemove" | "deps" | "kit"> & {
  t: PluginsController["t"]; locale: string; onToggleEnabled: PluginsController["onToggleEnabled"];
  plugin: AdminPluginDto; removeBlocker: ReturnType<PluginRules["pluginRemoveBlocker"]>; busy: boolean;
}, _optional = {}) {
  const { pluginRemoveAriaLabel, pluginToggleAriaLabel } = deps;
  const { PluginTrashIcon } = kit;
  return (
          <>
            {plugin.enabled ? null : (
              <button type="button" disabled={busy} onClick={() => onToggleEnabled(plugin)} aria-label={pluginToggleAriaLabel({ plugin, locale })}>
                {t("Enable")}
              </button>
            )}
            <button
              type="button"
              className="jini-plugin-icon-btn"
              disabled={removeBlocker !== null || busy}
              onClick={() => onRequestRemove(plugin)}
              aria-label={pluginRemoveAriaLabel({ plugin, locale })}
              aria-describedby={removeBlocker ? PLUGINS_REMOVE_NOTE_IDS[removeBlocker] : undefined}
            >
              <PluginTrashIcon />
            </button>
          </>
        );
}

function installedPluginRow({ plugin, controller, expandedIds, onToggleExpanded, focusPluginId, handle, control, t, locale, onToggleEnabled, useAdminLocale, pluginToggleAriaLabel, kit }: Pick<Parameters<typeof InstalledPluginRows>[0], "controller" | "expandedIds" | "onToggleExpanded" | "focusPluginId" | "kit"> & {
  plugin: AdminPluginDto; handle: string; control: ReturnType<PluginRules["pluginToggleControl"]>;
  t: PluginsController["t"]; locale: string; onToggleEnabled: PluginsController["onToggleEnabled"];
  useAdminLocale: PluginsProps["hooks"]["useAdminLocale"]; pluginToggleAriaLabel: PluginRules["pluginToggleAriaLabel"];
}, _optional = {}) {
  const { PluginRow } = kit;
  return (
          <PluginRow
            key={plugin.id}
            useAdminLocaleHook={useAdminLocale}
            plugin={plugin}
            t={t}
            expanded={expandedIds.has(plugin.id)}
            onToggleExpanded={() => onToggleExpanded({ id: plugin.id })}
            agentHandleBase={handle}
            onInspect={() => controller.onInspectPlugin(plugin.id)}
            {...(plugin.providerSettings ? { onSettings: () => controller.onOpenSettings(plugin.id) } : {})}
            focused={plugin.id === focusPluginId}
            action={
              // AC-21: an invalid, switched-off row gets no enable-capable control — the muted dash.
              control.visible ? (
                <button
                  type="button"
                  disabled={control.disabled}
                  onClick={() => onToggleEnabled(plugin)}
                  aria-label={pluginToggleAriaLabel({ plugin, locale })}
                >
                  {control.label}
                </button>
              ) : (
                <span className="field-hint" aria-hidden="true">—</span>
              )
            }
          />
        );
}
