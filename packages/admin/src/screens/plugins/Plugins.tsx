import type { ComponentType } from "react";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { resolveActiveTabId } from "@jini-ai/core/text";
import type { TabBarTab, TabBarProps } from "../../react/kit.js";
import { UploadIcon } from "./agent-plugins-visuals.js";
import { addPluginTabSoonTag, marketplaceTabSoonTag } from "./add-plugin-tab-soon.js";
import { DownloadedTabIcon, InstalledTabIcon, MarketplaceTabIcon } from "./plugins-visuals.js";
import { PluginRulesProvider } from "./rules-context.js";
import type { PluginRules } from "./rules.js";
import type { PluginsController } from "./hooks/use-plugins.hooks.js";
import type { PluginPackageFilesController } from "./hooks/use-plugin-package-files.hooks.js";
import type { PluginProviderSettingsController } from "./hooks/use-plugin-provider-settings.hooks.js";
import type { AdminPluginProviderSettings } from "./api/plugins-api.types.js";
import { PLUGINS_TAB_PANELS } from "./PluginLists.js";
import { PluginsOverlays } from "./PluginsOverlays.js";
/*
 * The row shell and the package-files viewer this screen renders moved to Jini (`PluginRow`, `PluginPackageFilesModal`),
 * which cannot name this product's package format. Their original rationale stays here beside the host code that
 * supplies the format, the translator and the listing hook:
 */
/**
 * @file One `host-format plugin package` plugin, as a ROW — the shared shell both the Installed and Downloaded
 * tabs render through. Structurally mirrors `AgentPluginRow.tsx` (icon, name + version chip, a
 * one-line subline, an expander, then right-aligned controls), the sibling screen's own
 * plain-table-to-row redesign from the same night, but is not byte-for-byte identical and imports
 * nothing from that file: `AdminPluginDto` has no free-text description (its subline is
 * `source · tier · status` instead, via `pluginSubline`) and a `host-format plugin package` row exposes exactly
 * ONE tab-specific control at a time (after the eye button every row carries, 2026-09-13) — the
 * Enabled toggle on Installed, or Remove on Downloaded —
 * never both, since that split is what replaced the single unified table `Plugins.tsx` used to
 * render (see that file's own header for the tab-by-tab rationale).
 *
 * The action area itself is a caller-supplied slot (`action`) rather than a `tab` enum branching
 * inside this component: `Plugins.tsx` already knows which tab it is rendering and builds the
 * right control (a plain toggle button, or the Remove icon button) itself, so this file's only job
 * stays the row's shell — identity, expansion, and the quarantine/errors detail panel — the same
 * single-responsibility split `AgentPluginListPanel`'s own slot props establish for its sibling.
 *
 * Accessibility decisions carried over verbatim from `AgentPluginRow`'s own header (not
 * re-litigated here):
 *  - The expander is the row's own summary button (`aria-expanded`/`aria-controls`), not a separate
 *    chevron competing with the action control for a hit target.
 *  - The detail panel is ALWAYS rendered and hidden via the `hidden` attribute, so `aria-controls`
 *    always resolves; `styles.css` carries the matching `[hidden] { display: none; }` guard.
 *  - The summary's accessible name is the heading text alone (`aria-labelledby`), not the whole
 *    button's content — the row's built-in-plugin note or long error list must not become part of
 *    the expander's own announced name.
 */
/**
 * @file The Plugins screen's read-only package-files viewer — the same `PackageFilesModal` the Agent
 * Plugins screen opens, fed by the server's `PLUGIN_FILES` listing rather than a build-time catalog
 * (a `host-format plugin package` lands in the install directory at runtime, so no catalog could know its files).
 * Opened from a row's eye button on the Installed and Downloaded tabs (`PluginRow`'s `onInspect`).
 */
/**
 * @file `Plugins` — the admin `host-format plugin package` list screen (SPEC-005 REQ-12..18, ui.spec.md), rebuilt
 * from a single flat `DataTable` into the row-based, tabbed shape `AgentPlugins.tsx` (a sibling
 * screen for the unrelated agent-plugins.org standard — see `panels.tsx`'s own "Integrations" group
 * comment for why these two are deliberately not the same system) already has, but independent of
 * it: nothing here imports from `AgentPlugins.tsx`/`AgentPluginRow.tsx`, and neither can this file's
 * behavior change by editing those.
 *
 * State and API calls live in `hooks/use-plugins.hooks.ts`; the server-error-message override,
 * toggle-cell decision, subline, and remove-confirm copy live in `rules.ts`. Route `/addons/plugins`;
 * consumes `PLUGINS_LIST`/`PLUGIN_SET_ENABLED`/`PLUGIN_UNINSTALL` (`api.listPlugins()`/
 * `api.setPluginEnabled()`/`api.uninstallPlugin()`) as a black box. Every Installed and Downloaded
 * row also has an eye button opening `PluginPackageFilesModal` (`PLUGIN_FILES`, 2026-09-13) — the
 * same read-only package-files viewer Agent Plugins uses.
 *
 * Four tabs, Installed first (owner correction, applied identically to the sibling screen the same
 * night — Installed before Downloaded, not the other way round):
 *  - **Installed** — every installed plugin, on or off (owner 2026-10-25, the same call Agent
 *    Plugins' Installed got on 2026-09-13: a provider plugin that is installed but off was listed
 *    only under Downloaded). Carries the Enable/Disable toggle unchanged from the pre-split table
 *    (`pluginToggleControl`/`onToggleEnabled`). `?plugin=<id>` scrolls to, focuses and highlights
 *    that row (`usePluginRowFocus`) — a linked agent plugin's padlock on Agent Plugins links here.
 *  - **Downloaded** — every plugin `PLUGINS_LIST` returns, unfiltered (this workspace's on-disk
 *    set). Every row carries Remove, which drives the REAL `PLUGIN_UNINSTALL` route: it deletes the
 *    plugin's on-disk artifact, gated behind `PluginRemoveConfirmDialog`. Remove is usable only
 *    where that route can succeed — a switched-off site plugin. On a built-in row, or a row that is
 *    still on, it is honestly disabled and points at a section note saying why
 *    (`pluginRemoveBlocker`; 2026-09-13 fix — before it, Remove showed ONLY on enabled rows, which
 *    the route always refuses). A disabled row also carries a direct, unconfirmed Enable (written
 *    when Installed listed only enabled rows; Installed's toggle now does the same).
 *  - **Add a plugin** — the shared `InstallTabCard` (`AddPluginPanel.tsx`): a server folder or one
 *    `.zip`, previewed before install. Replaced the header "Install plugin" popup (owner, 2026-10-06),
 *    so all three install screens (Skills, Agent Plugins, Plugins) share one tab and card. On a
 *    server that refuses local installs (`installSources` without "folder", e.g. a hosted install) the tab is
 *    greyed out and tagged "Soon" instead (owner, 2026-10-17): it has no destination there, so it is
 *    disabled and `?tab=add` falls back to Installed.
 *  - **Marketplace** — a designed empty state; nothing is fetched, listed, or installable (REQ-02:
 *    install is a filesystem operation, placing files under this site's plugin install directory,
 *    not an HTTP one — `api.spec.md` §1 lists no install/marketplace route for this family either).
 *
 * `?tab=` is URL-deep-linked through the shared `resolveActiveTabId` guard, the same idiom
 * `Security.tsx`/`Database.tsx`/`SourceControl.tsx`/`Deployment.tsx` all use — `panels.tsx`'s
 * `plugins` entry passes `ctx.query.get("tab")` through as `tabId`.
 */
export interface PluginsProps {
  tabId?: string | null | undefined;
  focusPluginId?: string | null | undefined;
  hooks: {
    usePluginsHook: () => PluginsController;
    useAdminLocale: () => string;
    useWiredPluginPackageFiles: (required: { pluginId: string }) => PluginPackageFilesController;
    useWiredPluginProviderSettings: (required: { pluginId: string }) => PluginProviderSettingsController;
    useProviderSettingsFocus: (required: { card: AdminPluginProviderSettings | null; fieldId: string }, optional?: Record<string, never>) => void;
  };
  kit: {
    Toast: ComponentType<{ message: string; role: "status"; tone: "success"; ttlMs: number; onDismiss: () => void }>;
    TabBar: ComponentType<TabBarProps>;
    PluginProviderSettingsDialog: ComponentType<{
      useSettings: PluginsProps["hooks"]["useWiredPluginProviderSettings"];
      useProviderSettingsFocusHook: PluginsProps["hooks"]["useProviderSettingsFocus"];
      plugin: Pick<AdminPluginDto, "id" | "name">; agentHandleBase: string; onClose: () => void; onSaved: () => void;
    }>;
  };
  deps: Pick<PluginRules, "pluginRemoveAriaLabel" | "pluginRemoveBlocker" | "pluginToggleAriaLabel" | "pluginToggleControl"> & {
    pluginRules: PluginRules;
    translateAdminNavLabel: (required: { locale: string; key: string }) => string;
    onTabChange: (nextTabId: string) => void;
    productName: string;
    builtInNote: string;
    marketplaceNote: string;
  };
}

const PLUGINS_TAB_IDS = ["installed", "downloaded", "add", "marketplace"] as const;
export type PluginsTabId = (typeof PLUGINS_TAB_IDS)[number];

/** Falls back to the Installed tab for an absent or unrecognized `?tab=` value, and for `add` when
 *  this server refuses local installs (that tab is disabled). Delegates to the shared
 *  `../../lib/resolve-active-tab-id` guard every other URL-deep-linked tabbed admin screen uses. */
function resolvePluginsTabId({ tabId, canInstall }: { tabId: string | null | undefined; canInstall: boolean }, _options = {}): PluginsTabId {
  const validIds = canInstall ? PLUGINS_TAB_IDS : PLUGINS_TAB_IDS.filter((id) => id !== "add");
  return resolveActiveTabId({ tabId: tabId, validIds: validIds, defaultId: "installed" });
}

function PluginsScreen({ tabId, focusPluginId, hooks, kit, deps }: PluginsProps) {
  const { usePluginsHook } = hooks;
  const controller = usePluginsHook();
  const { plugins, error, t } = controller;

  // `error && !plugins`, not `error` alone (2026-09-20 platform review, X1): a NEVER-loaded fetch
  // (no `plugins` yet) is still fatal — there is nothing else to show. But once the list has loaded
  // once, a later reload failure (a toggle's post-write re-fetch) must not blank the whole screen —
  // see `LoadedPlugins`'s own error notice below, and `use-plugins.hooks.ts`'s `reload()` header.
  if (error && !plugins) return <div className="notice error">{error}</div>;
  if (!plugins) return <div className="notice">{t("Loading plugins…")}</div>;
  return <LoadedPlugins {...{ kit, hooks, deps }} plugins={plugins} controller={controller} activeTabId={resolvePluginsTabId({ tabId, canInstall: controller.canInstallFolder === true })} focusPluginId={focusPluginId} />;
}

/**
 * Per-row agent handles, computed once from the FULL unfiltered list, plus the handles of the plugin
 * whose settings or remove dialog is open (a dialog for a plugin with no row is a bug, so it throws).
 */
function deriveRowHandles(
  { plugins, settingsPlugin, pendingRemovePlugin }: { plugins: AdminPluginDto[]; settingsPlugin: AdminPluginDto | null; pendingRemovePlugin: AdminPluginDto | null },
  _options: Record<string, never> = {},
) {
  // Plugin ids are stable and unique, same per-row-handle derivation every other list on this
  // workstream uses (`buildAgentListHandles`), computed once from the FULL unfiltered list so a
  // plugin's handle is identical whichever tab currently lists it (mirrors `AgentPluginRow`'s own
  // reasoning for deriving from the id alone, not list position).
  const rowHandles = buildAgentListHandles({ prefix: "plugins-row", ids: plugins.map((plugin) => plugin.id) }
  );
  const rowHandleById = new Map(plugins.map((plugin, index) => [plugin.id, rowHandles[index]!]));
  const settingsHandle = settingsPlugin ? rowHandleById.get(settingsPlugin.id) : undefined;
  if (settingsPlugin && settingsHandle === undefined) throw new Error(`plugin ${settingsPlugin.id} has no settings handle`);
  const removeHandle = pendingRemovePlugin ? rowHandleById.get(pendingRemovePlugin.id) : undefined;
  if (pendingRemovePlugin && removeHandle === undefined) throw new Error(`plugin ${pendingRemovePlugin.id} has no remove handle`);
  return { rowHandleById, settingsHandle, removeHandle };
}

/** The four tabs, in order; "Add a plugin" is disabled (and tagged soon) where folder install is unavailable. */
function buildPluginTabs({ t, locale, canInstall, deps }: { t: PluginsController["t"]; locale: PluginsController["locale"]; canInstall: boolean; deps: PluginsProps["deps"] }, _options: Record<string, never> = {}): TabBarTab[] {
  const { translateAdminNavLabel } = deps;
  return [
    { id: "installed", label: t("Installed"), icon: <InstalledTabIcon />, handle: "plugins-tab-installed", handleLabel: "Switch to the Installed tab — every plugin installed for this site, on or off" },
    { id: "downloaded", label: t("Downloaded"), icon: <DownloadedTabIcon />, handle: "plugins-tab-downloaded", handleLabel: "Switch to the Downloaded tab — every plugin on disk for this site, regardless of whether it's turned on" },
    { id: "add", label: t("Add a plugin"), tag: addPluginTabSoonTag({ locale, translateAdminNavLabel }, canInstall ? {} : { enabled: true }), disabled: !canInstall, icon: <UploadIcon />, handle: "plugins-tab-add", handleLabel: "Switch to the Add a plugin tab — install a plugin from a folder on this server or a .zip" },
    { id: "marketplace", label: t("Marketplace"), tag: marketplaceTabSoonTag({ locale, translateAdminNavLabel }), icon: <MarketplaceTabIcon />, handle: "plugins-tab-marketplace", handleLabel: "Switch to the Marketplace tab — a future place to discover plugins" },
  ];
}

/** The screen once `PLUGINS_LIST` has settled: header, row error, tab bar, the active tab's panel,
 *  and the package-files viewer and Remove confirm dialog (both opened through the controller). */
function LoadedPlugins({ kit, hooks, deps, plugins, controller, activeTabId, focusPluginId }: { plugins: AdminPluginDto[]; controller: PluginsController; activeTabId: PluginsTabId; focusPluginId?: string | null | undefined } & Pick<PluginsProps, "kit" | "hooks" | "deps">) {

  const { TabBar } = kit;

  const { onTabChange: navigateToPluginsTab } = deps;
  const { t, locale, pendingRemovePlugin, settingsPlugin } = controller;

  const { rowHandleById, settingsHandle, removeHandle } = deriveRowHandles({ plugins, settingsPlugin, pendingRemovePlugin });
  const ActivePanel = PLUGINS_TAB_PANELS[activeTabId];
  const canInstall = controller.canInstallFolder === true;

  const tabs = buildPluginTabs({ t, locale, canInstall, deps });

  return (
    <div className="page plugins-page">
      {PluginsHeader({ controller })}

      <TabBar ariaLabel={t("Plugins")} tabs={tabs} activeId={activeTabId} onChange={navigateToPluginsTab} containerHandle="plugins-tab-bar" />

      <ActivePanel {...{ hooks, deps }} plugins={plugins} controller={controller} rowHandleById={rowHandleById} focusPluginId={focusPluginId} />

      {PluginsOverlays({ kit, hooks, deps, controller, settingsHandle, removeHandle })}
    </div>
  );
}

/** The plugins screen under the host-bound rule functions the Jini rows and dialogs read. */
export function Plugins(props: PluginsProps, _optional = {}) {
  const { pluginRules } = props.deps;
  return (
    <PluginRulesProvider rules={pluginRules}>
      <PluginsScreen {...props} />
    </PluginRulesProvider>
  );
}

export function bindPlugins({ kit, hooks, deps }: Pick<PluginsProps, "kit" | "hooks" | "deps">, _optional = {}) {
  return function BoundPlugins({ usePluginsHook = hooks.usePluginsHook, ...props }: Pick<PluginsProps, "tabId" | "focusPluginId"> & {
    usePluginsHook?: PluginsProps["hooks"]["usePluginsHook"];
  }, _optional = {}) {
    return <Plugins {...props} kit={kit} deps={deps} hooks={{ ...hooks, usePluginsHook }} />;
  };
}

function PluginsHeader({ controller }: { controller: PluginsController }, _optional = {}) {
  const { t, rowError, error } = controller;
  return <>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Integrations")}</p>
          <h1 className="page-title">{t("Plugins")}</h1>
          <p className="page-description">
            {t("Enable or disable plugins discovered in this site's plugin install directory.")}
          </p>
        </div>
      </div>
      {rowError ? (
        <div className="notice error">
          <span role="alert">{rowError}</span>
        </div>
      ) : null}
      {/* A reload failure AFTER the list has loaded once (X1) — the list, tabs and dialogs below
       *  stay on screen; only `error && !plugins` in `Plugins` itself is fatal. Same markup as
       *  `rowError` above. */}
      {error ? (
        <div className="notice error">
          <span role="alert">{error}</span>
        </div>
      ) : null}

  </>;
}
