import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { agentPluginLifecycleFields, type AgentPluginRowCandidate } from "../../http/agent-plugins.js";
import { authorizeAgentPlugins, type AgentPluginCandidatesLoader, type AgentPluginRoutePrincipal } from "./shared.js";

/** The host's per-plugin connection status read (external-MCP rows, credential cards, API connections). */
export type AgentPluginConnectionStatusesLoader = (required?: Record<string, never>, optional?: Record<string, never>) => Promise<ReadonlyMap<string, unknown>>;

/** The deps this route reads: the workspace plus the host's two reads. */
export interface AgentPluginsListRouteDeps {
  workspaceId: string;
  loadCandidates: AgentPluginCandidatesLoader;
  loadConnectionStatuses: AgentPluginConnectionStatusesLoader;
}

/** The list response: one row per installed Agent Plugin. */
export interface AgentPluginsListEnvelope { agentPlugins: Record<string, unknown>[] }

/**
 * `AGENT_PLUGINS_LIST` — `GET /api/admin/v1/workspaces/:workspaceId/agent-plugins` (2026-09-09).
 * A plain read, mirroring `plugins/list.ts`'s own shape (workspace-param check, `admin.plugins.read`
 * authorization, one JSON body, no gateway involvement — this is a read with nothing to route
 * through a change-set/outbox pipeline).
 *
 * ---------------------------------------------------------------------------
 * Why this reuses `loadAgentPluginSearchCandidates`, not a second read
 * ---------------------------------------------------------------------------
 * `search_agent_plugin_local` (`features/agent-plugins/tool-registrations.ts`) already resolves
 * "every installed Agent Plugin in this workspace, including disabled ones, with its skills and MCP
 * server ids" — exactly what the admin Agent Plugins screen needs to stop rendering the hardcoded
 * bundled-agent-plugins catalog. Re-deriving that walk here (a second `listInstalledPlugins`
 * call, a second per-plugin skill/mcp.json read, a second single-digest-per-id policy) would give
 * the tool and this route two independent opinions about "what plugins are installed" that could
 * silently drift. This route instead calls the SAME loader and re-shapes its output for the wire —
 * one source of truth, two consumers (a tool and this HTTP surface), the pattern this feature's own
 * `listInstalledPlugins` doc already establishes for its own multiple callers.
 *
 * Permission: reuses `admin.plugins.read` rather than minting `admin.agent-plugins.read` — same
 * reasoning `tool-registrations.ts`'s `plugins_list` merge already gives for reusing this permission
 * across both plugin families: an operator who may see the site/runtime plugin list has no lesser
 * standing to see Agent Plugin ids/skills, and a second gate with an identical threat model would be
 * ceremony, not safety.
 *
 * SECURITY: no absolute host path reaches the response — `loadAgentPluginSearchCandidates` already
 * carries the same no-`packageRoot`-leak discipline `tool-registrations.ts`'s own header states for
 * `search_agent_plugin_local`, and this handler only re-shapes fields that loader already returns.
 *
 * (Both loaders are injected: the host binds its read model and its connection-status read.)
 */
export const agentPluginsListRoute = defineJsonRoute<Record<string, never>, AgentPluginsListEnvelope, AgentPluginsListRouteDeps, AgentPluginRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/agent-plugins",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeAgentPlugins({ authorize, permission: "admin.plugins.read" });
    const candidates = await deps.loadCandidates();
    const connectionStatuses = await deps.loadConnectionStatuses();
    return ok({ value: { agentPlugins: candidates.map((candidate) => agentPluginListRow({ candidate, connectionStatuses })) } });
  },
});

/** One list row; the connection status key is present only for a plugin the host reported. @complexity O(1). */
function agentPluginListRow({ candidate, connectionStatuses }: { candidate: AgentPluginRowCandidate; connectionStatuses: ReadonlyMap<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return {
    pluginId: candidate.pluginId,
    displayName: candidate.displayName ?? null,
    summary: candidate.summary ?? null,
    version: candidate.version ?? null,
    description: candidate.description ?? null,
    id: candidate.id,
    provides: candidate.provides,
    keywords: candidate.keywords,
    enabled: candidate.enabled,
    ...(connectionStatuses.has(candidate.pluginId) ? { connectionStatus: connectionStatuses.get(candidate.pluginId) } : {}),
    ...agentPluginLifecycleFields({ candidate }),
    skills: candidate.skills,
    mcpServerIds: candidate.mcpServerIds,
  };
}
