import { useId, type ComponentType, type CSSProperties } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import { I18nProvider, SettingsDialogShell, type KitDictionaries, type SettingsDialogTab } from "../../react/kit.js";
import type { PluginRulesProvider } from "./rules-context.js";
import type { AgentPluginDisableConfirmDialog } from "./AgentPluginDisableConfirmDialog.js";
import type { AddAgentPluginPanel } from "./AddAgentPluginPanel.js";
import type { AgentPluginRow } from "./AgentPluginRow.js";
import type { AgentPluginManageButton } from "./AgentPluginManageButton.js";
import type { AgentPluginUpdateSlot } from "./AgentPluginUpdateControl.js";
import type { PluginRules } from "./rules.js";
import type { AgentPluginInstallPort } from "../integrations/agent-plugin-ports.js";
import type { useAgentPluginInstall, AgentPluginInstallHost } from "./hooks/use-agent-plugin-install.hooks.js";
import type { useAgentPluginUpdate } from "./hooks/use-agent-plugin-update.hooks.js";
import type { useAgentPluginTab } from "./hooks/use-agent-plugin-tab.hooks.js";
import type { useAgentPluginConfirmation } from "./AgentPlugins.hooks.js";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "./hooks/agent-plugin-surfaces-port.hooks.js";
import type { useAgentPluginSurfaces } from "./hooks/use-agent-plugin-surfaces.hooks.js";
import type { AgentPluginDetailsModalController, useAgentPluginDetailsView } from "./hooks/use-agent-plugin-details-modal.hooks.js";
import type { AgentPluginMemoryController } from "./hooks/use-agent-plugin-memory.hooks.js";
import { agentPluginsTabs } from "./AgentPluginsTabs.js";
import { AgentPluginsOverlays } from "./AgentPluginsOverlays.js";
interface InspectedAgentPlugin {
  readonly maturity?: AgentPluginListRow["maturity"];
  readonly id: string;
  readonly displayName: string;
  /** Set by the row's "Manage" button: the screens it already listed, so the modal opens on the first. */
  readonly surfaces?: readonly AgentPluginSurfaceSummary[];
}

export interface AgentPluginsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  agentPlugins: AgentPluginListRow[] | null;
  error: string | null;
  /** The last failed toggle's message, or `null`. Separate from `error` (which means "the list
   *  itself could not load"), so a refused toggle does not blank the list the operator is reading. */
  toggleError: string | null;
  /** Plugin ids with an enable/disable request in flight right now. A `Set` rather than the sibling
   *  screen's single `rowSavingId` — see {@link useAgentPlugins}'s `@tradeoffs`. */
  togglingIds: ReadonlySet<string>;
  /** Flips one plugin's activation and replaces that row with the server's answer. */
  onToggleEnabled: (plugin: AgentPluginListRow) => Promise<void>;
  /** Adds (or replaces) the row the "Add a plugin" upload answered with, so no list re-fetch. */
  onInstalled: (plugin: AgentPluginListRow) => void;
  /** Plugin ids whose row detail panel (skills, MCP servers) is open. */
  expandedIds: ReadonlySet<string>;
  /** Opens or closes one row's detail panel. */
  onToggleExpanded: (required: { pluginId: string }, optional?: Record<string, never>) => void;
  /** The plugin currently open in the read-only package inspector, or `null` when it's closed. */
  inspectedPlugin: InspectedAgentPlugin | null;
  /** Opens the inspector for `plugin`. */
  inspectPlugin: (plugin: InspectedAgentPlugin) => void;
  /** Closes the inspector. */
  closeInspector: () => void;
  /** Bound translator — `AgentPlugins.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `AgentPlugins.tsx` passes it straight through
   *  to `I18nProvider`'s own `initialLocale`, not because anything here needs it beyond `t`. Same
   *  reasoning as `use-plugins.hooks.ts`'s own `locale` field. */
  locale: string;
}

export interface AgentPluginsProps {
  tabId?: string | null | undefined;
  agentPluginInstallPort?: AgentPluginInstallPort | undefined;
  hooks: {
    useAdminThemeBoundaryHook: (required: Record<string, never>, optional: Record<string, never>) => { "data-theme"?: string; style?: CSSProperties };
    useAgentPluginTabHook: typeof useAgentPluginTab;
    useAgentPluginInstallHook: typeof useAgentPluginInstall;
    useAgentPluginConfirmationHook: typeof useAgentPluginConfirmation;
    useAgentPluginUpdateHook: typeof useAgentPluginUpdate;
    useAgentPluginsHook: () => AgentPluginsController;
    useDetails: (required: { pluginId: string }) => AgentPluginDetailsModalController;
    useAgentPluginMemoryHook: (required: { pluginId: string }) => AgentPluginMemoryController;
    useAgentPluginDetailsViewHook: typeof useAgentPluginDetailsView;
    useAgentPluginSurfacesHook: typeof useAgentPluginSurfaces;
  };
  kit: {
    PluginRulesProvider: typeof PluginRulesProvider;
    AgentPluginDisableConfirmDialog: typeof AgentPluginDisableConfirmDialog;
    AddAgentPluginPanel: typeof AddAgentPluginPanel;
    AgentPluginRow: typeof AgentPluginRow;
    AgentPluginManageButton: typeof AgentPluginManageButton;
    AgentPluginUpdateSlot: typeof AgentPluginUpdateSlot;
    AgentPluginDetailsModal: ComponentType<Pick<AgentPluginsProps["hooks"], "useDetails" | "useAgentPluginMemoryHook" | "useAgentPluginDetailsViewHook" | "useAgentPluginSurfacesHook"> & {
      plugin: InspectedAgentPlugin; t: Translate; onClose: () => void;
    }>;
  };
  deps: Omit<AgentPluginInstallHost, "rules"> & {
    pluginRules: PluginRules;
    agentPluginDisplayName: PluginRules["agentPluginDisplayName"];
    updatableAgentPluginDigest: PluginRules["updatableAgentPluginDigest"];
    agentPluginInstallPort: AgentPluginInstallPort;
    defaultAgentPluginSurfacesPort: AgentPluginSurfacesPort;
    translateAdminNavLabel: (required: { locale: string; key: string }) => string;
    dictionaries: KitDictionaries;
    uninstallNote: string;
    marketplaceNote: string;
    downloadedNote: string;
  };
}
/**
 * Settings-style Agent Plugins catalog. Downloaded/Installed are both read from
 * `AGENT_PLUGINS_LIST` (real, per-workspace installed state); Marketplace is future-only.
 *
 * REDESIGNED 2026-09-09. Five changes worth stating, because each replaced something that was
 * deliberate at the time:
 *
 *  1. Cards became rows (`AgentPluginRow` — see its own header for the before/after and why
 *     nothing was dropped in the process).
 *  2. The enable/disable switch is REAL. This file's prior revision carried an explicit comment
 *     saying there is intentionally no toggle here because the read path was all that existed.
 *     `AGENT_PLUGIN_SET_ENABLED` now exists, so the toggle is wired end to end and its off-state
 *     genuinely refuses an assistant run.
 *  3. Marketplace got a designed empty state rather than one grey sentence. Its copy stays exactly
 *     as honest: nothing is fetched, listed, or installable, and the panel offers no control that
 *     pretends otherwise.
 *  4. The single "Installed" tab split into Downloaded (every package on disk for this workspace,
 *     unfiltered) and Installed (only `enabled: true`). They read identically today — every bundled
 *     package ships enabled — and diverge the moment an operator disables one; each has its own
 *     honest empty state for that day.
 *  5. Owner correction, same day: Installed is the FIRST/default tab (not Downloaded) — it is the
 *     "what's active" view, so it leads. And Downloaded's row dropped the Enable/Disable switch for
 *     a single Remove/Enable action (`AgentPluginRowStateControl`'s `"remove-or-enable"` variant):
 *     showing the switch on BOTH tabs repeated the same on/off fact Installed already conveys by
 *     which rows it lists at all. Both directions still turn a plugin's activation on or off through
 *     the exact same `AGENT_PLUGIN_SET_ENABLED` call either way — only which CONTROL asks, and
 *     whether it interrupts first, differs. See `AgentPluginDisableConfirmDialog`'s own header for
 *     the two `variant`s that follow from this.
 *  6. Owner decision 2026-09-13: Installed lists EVERY installed plugin, switched on or off, so its
 *     switch's off state is reachable again and a switched-off bundled plugin can be turned on
 *     from the default tab. Item 4's "Installed (only `enabled: true`)" scope no longer holds.
 */
function AgentPluginsScreen(props: AgentPluginsProps) {
  const { tabId, agentPluginInstallPort = props.deps.agentPluginInstallPort, deps } = props;
  const { isApiError, folderZip, pluginRules } = deps;

  const themeBoundary = props.hooks.useAdminThemeBoundaryHook({}, {});
  const tab = props.hooks.useAgentPluginTabHook({ tabId } as Parameters<typeof useAgentPluginTab>[0]);
  const controller = props.hooks.useAgentPluginsHook();
  const { t, agentPlugins, onToggleEnabled } = controller;
  const installController = props.hooks.useAgentPluginInstallHook({ port: agentPluginInstallPort, t, onInstalled: controller.onInstalled, productName: deps.productName, isApiError, folderZip, rules: pluginRules });
  // One id, referenced by every row's disabled uninstall control — see `AgentPluginRow`'s header
  // for why the reason is stated once at section level rather than once per row.
  const uninstallNoteId = useId();

  const { pendingDisable, setPendingDisable, pendingDisablePlugin, onRequestToggleEnabled, onRequestRemove } =
    props.hooks.useAgentPluginConfirmationHook({ agentPlugins, onToggleEnabled });

  const tabs = agentPluginsTabs({ props, controller, installController, uninstallNoteId, onRequestToggleEnabled, onRequestRemove, agentPluginInstallPort });

  return <AgentPluginsView {...{ props, themeBoundary, tab, controller, tabs, pendingDisable, pendingDisablePlugin, setPendingDisable }} />;
}

function AgentPluginsView({ props, themeBoundary, tab, controller, tabs, pendingDisable, pendingDisablePlugin, setPendingDisable }: {
  props: AgentPluginsProps;
  themeBoundary: ReturnType<AgentPluginsProps["hooks"]["useAdminThemeBoundaryHook"]>;
  tab: ReturnType<AgentPluginsProps["hooks"]["useAgentPluginTabHook"]>;
  controller: AgentPluginsController;
  tabs: SettingsDialogTab[];
} & Pick<ReturnType<typeof useAgentPluginConfirmation>, "pendingDisable" | "pendingDisablePlugin" | "setPendingDisable">, _optional = {}) {
  const { t, locale } = controller;
  return (
    <I18nProvider
      initialLocale={locale}
      dictionaries={props.deps.dictionaries}
      fallbackLocale="en"
      syncDocumentAttributes={false}
    >
      {/* `agent-plugins-section` (styles.css) scopes this screen's own measure to it alone — this
          panel has no `--page-flow` variant, so it had none of that modifier's existing
          `max-width` on `.jini-tabbed-dialog-content` (added for the identical "card ran the full
          admin column" problem on the BYOK tab). The row layout wants more of that column than the
          old card measure allowed, since a row carries its controls to the RIGHT of its text
          rather than underneath it — see that rule's own comment for the widened value.
          Classic keeps its unverified-dark light pin; Glass follows the document scheme. */}
      <div className="settings-ui-section agent-plugins-section" {...themeBoundary}>
        <SettingsDialogShell
          {...tab}
          tabs={tabs}
          presentation="inline"
          className="jini-tabbed-dialog--inline"
          fullscreenEnabled={false}
          labels={{ kicker: t("Plugins") }}
        />
        {AgentPluginsOverlays({ props, controller, pendingDisable, pendingDisablePlugin, setPendingDisable })}
      </div>
    </I18nProvider>
  );
}

/** The agent-plugins screen under the host-bound rule functions the Jini rows and dialogs read. */
export function AgentPlugins(props: AgentPluginsProps, _optional = {}) {
  const { pluginRules } = props.deps;
  const { PluginRulesProvider } = props.kit;
  return (
    <PluginRulesProvider rules={pluginRules}>
      <AgentPluginsScreen {...props} />
    </PluginRulesProvider>
  );
}

export function bindAgentPlugins({ kit, hooks, deps }: Pick<AgentPluginsProps, "kit" | "hooks" | "deps">, _optional = {}) {
  return function BoundAgentPlugins(props: Partial<AgentPluginsProps["hooks"]> & Pick<AgentPluginsProps, "tabId" | "agentPluginInstallPort">, _optional = {}) {
    return <AgentPlugins {...props} kit={kit} hooks={{ ...hooks, ...props }} deps={deps} />;
  };
}
