import { useEffect, useState } from "react";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "./agent-plugin-surfaces-port.hooks.js";

/**
 * @file Which admin surfaces one Agent Plugin contributes, for the details modal's extra tabs.
 * A failed listing shows no surface tabs: the modal's own views stay usable either way.
 */

const NONE: readonly AgentPluginSurfaceSummary[] = [];

/** @complexity One GET per `pluginId`. */
export function useAgentPluginSurfaces(
  required: { readonly pluginId: string; readonly port: AgentPluginSurfacesPort },
  _optional: Record<string, never> = {},
): readonly AgentPluginSurfaceSummary[] {
  const { pluginId, port } = required;
  const [state, setState] = useState<{ pluginId: string; surfaces: readonly AgentPluginSurfaceSummary[] }>({ pluginId, surfaces: NONE });
  useEffect(() => {
    let live = true;
    // A 200 without a `surfaces` array (an older server, a proxy page) is the same as a failed listing.
    port.list({ pluginId }).then((listing) => { if (live) setState({ pluginId, surfaces: Array.isArray(listing.surfaces) ? listing.surfaces : NONE }); }, () => {});
    return () => { live = false; };
  }, [pluginId, port]);
  return state.pluginId === pluginId ? state.surfaces : NONE;
}
