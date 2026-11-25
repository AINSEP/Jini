
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "./hooks/agent-plugin-surfaces-port.hooks.js";
import { useAgentPluginSurfaces } from "./hooks/use-agent-plugin-surfaces.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The row's "Manage" button: shown only when an enabled plugin contributes its own admin screens
 * (for example Google Workspace's connection panel), and opening the package modal straight on the
 * first of them. Before this, those screens were reachable only through the eye icon ("Inspect package
 * files") and then a tab past Package files and Memory (Chrome check, 2026-10-20).
 */

export interface AgentPluginManageButtonProps {
  useAgentPluginSurfaces?: typeof useAgentPluginSurfaces;
  readonly pluginId: string;
  readonly displayName: string;
  readonly t: Translate;
  readonly agentHandleBase: string;
  /** Opens the modal with these (already listed) screens, so it can start on the first one. */
  readonly onManage: (surfaces: readonly AgentPluginSurfaceSummary[]) => void;
  /** The host's surfaces port (its authenticated request); a test passes a typed fake. */
  readonly port: AgentPluginSurfacesPort;
}

export function AgentPluginManageButton({ pluginId, displayName, t, agentHandleBase, onManage, port, useAgentPluginSurfaces: useAgentPluginSurfacesHook = useAgentPluginSurfaces }: AgentPluginManageButtonProps) {
  const surfaces = useAgentPluginSurfacesHook({ pluginId, port });
  if (surfaces.length === 0) return null;
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => onManage(surfaces)}
      aria-label={`${t("Manage")} ${displayName}`}
      {...agentHandle({ handle: `${agentHandleBase}-manage` }, { role: "button", label: `Open the "${displayName}" settings screens` })}
    >
      {t("Manage")}
    </button>
  );
}
