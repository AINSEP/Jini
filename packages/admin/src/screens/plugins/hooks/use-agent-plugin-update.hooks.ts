import { useState } from "react";

import type { AgentPluginListRow } from "../../../agent-plugins/models.js";

import type { AgentPluginInstallPort } from "../../integrations/agent-plugin-ports.js";
import { useAgentPluginInstall, type AgentPluginInstallHost } from "./use-agent-plugin-install.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * One operator-installed row's Update state: whether its upload panel is open, and the same bounded
 * upload controller the Add tab uses, bound to `AGENT_PLUGIN_UPDATE_ZIP` with the revision the row
 * shows (`expectedOldDigest`). Composed by the wired list (`AgentPlugins.tsx`) and handed to
 * `AgentPluginUpdateControl`, which only renders it.
 * @complexity O(1) per render.
 */
export function useAgentPluginUpdate(
  required: { plugin: AgentPluginListRow; expectedOldDigest: string; port: AgentPluginInstallPort; t: Translate; onUpdated: (plugin: AgentPluginListRow) => void } & AgentPluginInstallHost,
  _optional: Record<string, never> = {},
) {
  const { plugin, expectedOldDigest, port, t, onUpdated, productName, isApiError, rules } = required;
  const [open, setOpen] = useState(false);
  const controller = useAgentPluginInstall({ port, t, onInstalled: onUpdated, productName, isApiError, rules }, { update: { pluginId: plugin.pluginId, expectedOldDigest } });
  return { open, onToggle: () => setOpen(!open), displayName: rules.agentPluginDisplayName(plugin), controller };
}

export type AgentPluginUpdateState = ReturnType<typeof useAgentPluginUpdate>;
