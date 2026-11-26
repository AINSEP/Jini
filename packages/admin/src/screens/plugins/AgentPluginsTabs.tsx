import type { AgentPluginInstallPort } from "../integrations/agent-plugin-ports.js";
import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import { type SettingsDialogTab } from "../../react/kit.js";
import { addPluginTabSoonTag, marketplaceTabSoonTag } from "./add-plugin-tab-soon.js";
import { InstalledIcon, MarketplaceIcon, UploadIcon } from "./agent-plugins-visuals.js";
import type { useAgentPluginInstall } from "./hooks/use-agent-plugin-install.hooks.js";
import type { AgentPluginsProps, AgentPluginsController } from "./AgentPlugins.js";
import { InstalledOnlyPanel, DownloadedPanel, MarketplacePanel } from "./AgentPluginLists.js";
export function agentPluginsTabs(required: {
  props: AgentPluginsProps;
  controller: AgentPluginsController;
  installController: ReturnType<typeof useAgentPluginInstall>;
  uninstallNoteId: string;
  agentPluginInstallPort: AgentPluginInstallPort;
  onRequestToggleEnabled: (plugin: AgentPluginListRow) => void;
  onRequestRemove: (plugin: AgentPluginListRow) => void;
}, _optional = {}): SettingsDialogTab[] {
  return [installedAgentPluginsTab(required), downloadedAgentPluginsTab(required), addAgentPluginsTab(required), marketplaceAgentPluginsTab(required)];
}

function installedAgentPluginsTab(required: Parameters<typeof agentPluginsTabs>[0], _optional = {}): SettingsDialogTab {
  const { props, controller, uninstallNoteId, onRequestToggleEnabled, agentPluginInstallPort } = required;
  const { hooks, deps, kit } = props;
  const { t } = controller;

  return {
      id: "installed",
      label: t("Installed"),
      icon: <InstalledIcon />,
      title: t("Agent Plugins"),
      subtitle: t("Portable packages installed for this workspace."),
      panel: (
        <InstalledOnlyPanel
          {...{ hooks, deps, kit }}
          controller={controller}
          updatePort={agentPluginInstallPort}
          uninstallNoteId={uninstallNoteId}
          stateControlFor={(plugin) => ({ kind: "toggle", onToggleEnabled: () => onRequestToggleEnabled(plugin) })}
        />
      ),
    };
}

function downloadedAgentPluginsTab(required: Parameters<typeof agentPluginsTabs>[0], _optional = {}): SettingsDialogTab {
  const { props, controller, uninstallNoteId, onRequestRemove, agentPluginInstallPort } = required;
  const { hooks, deps, kit } = props;
  const { t, onToggleEnabled } = controller;

  return {
      id: "downloaded",
      label: t("Downloaded"),
      icon: <InstalledIcon />,
      title: t("Agent Plugins"),
      subtitle: t("Every package downloaded to this workspace."),
      panel: (
        <DownloadedPanel
          {...{ hooks, deps, kit }}
          controller={controller}
          updatePort={agentPluginInstallPort}
          uninstallNoteId={uninstallNoteId}
          stateControlFor={(plugin) => ({
            kind: "remove-or-enable",
            onRemove: () => onRequestRemove(plugin),
            onEnable: () => void onToggleEnabled(plugin),
          })}
        />
      ),
    };
}

/** `SettingsDialogTab.navHint` is optional (exactOptionalPropertyTypes): an absent tag omits the key. */
function optionalNavHint(navHint: string | undefined, _optional = {}): { navHint?: string } {
  return navHint === undefined ? {} : { navHint };
}

function addAgentPluginsTab(required: Parameters<typeof agentPluginsTabs>[0], _optional = {}): SettingsDialogTab {
  const { props, controller, installController } = required;
  const { deps } = props;
  const { AddAgentPluginPanel } = props.kit;
  const { t, locale } = controller;
  const { translateAdminNavLabel } = deps;
  return {
      id: "add",
      label: t("Add a plugin"),
      // `TabbedDialogTab` has no tag slot, so the "Soon" tag rides `navHint`; styles.css turns this
      // screen's nav hint into the sidebar's `.soon` pill beside the label.
      ...optionalNavHint(addPluginTabSoonTag({ locale, translateAdminNavLabel })),
      icon: <UploadIcon />,
      title: t("Agent Plugins"),
      subtitle: t("Install a package you already have."),
      panel: <AddAgentPluginPanel controller={installController} />,
    };
}

function marketplaceAgentPluginsTab(required: Parameters<typeof agentPluginsTabs>[0], _optional = {}): SettingsDialogTab {
  const { props, controller } = required;
  const { deps } = props;
  const { t, locale } = controller;
  const { translateAdminNavLabel } = deps;
  return {
      id: "marketplace",
      label: t("Marketplace"),
      ...optionalNavHint(marketplaceTabSoonTag({ locale, translateAdminNavLabel })),
      icon: <MarketplaceIcon />,
      title: t("Agent Plugin Marketplace"),
      subtitle: t("A future place to discover portable Agent Plugins."),
      panel: <MarketplacePanel t={t} deps={deps} />,
    };
}
