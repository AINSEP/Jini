import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeAgentPlugins, pluginIdParam, type AgentPluginRoutePrincipal } from "./shared.js";

/** One installed plugin package: its manifest id and its package root on the host. */
export interface AgentPluginPackageRecord { readonly pluginId: string; readonly packageRoot: string }

/** The workspace's Agent Plugin layout, as far as this route reads it. */
export interface AgentPluginFilesLayout {
  forWorkspace(required: { workspaceId: string }): { readonly root: string; pluginPackagesDir(required: { pluginId: string }): string };
}

/** The host's contained package-file reader (realpath containment, no symlink following, count and byte caps). */
export type AgentPluginPackageFilesReader = (required: { input: { rootDir: string; containerDir: string } }) => Promise<{ readonly files: readonly unknown[]; readonly truncated: boolean }>;

/** The deps this route reads. */
export interface AgentPluginFilesRouteDeps {
  workspaceId: string;
  agentPluginLayout: AgentPluginFilesLayout;
  /** Installed packages in the host's single-digest-per-id order; the first record per id wins. */
  listPluginPackages: (required: { workspaceRoot: string }) => Promise<readonly AgentPluginPackageRecord[]>;
  readPluginPackageFiles: AgentPluginPackageFilesReader;
  /** The reader's caps, echoed to the viewer. */
  packageFileLimits: unknown;
}

/** The files response. */
export interface AgentPluginFilesEnvelope { pluginId: string; files: readonly unknown[]; truncated: boolean; limits: unknown }

/**
 * `AGENT_PLUGIN_FILES` — `GET /api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/files`
 * (2026-09-13). The Agent Plugins screen's read-only package-files viewer: every file in ONE
 * installed Agent Plugin's own package root, switched on or off. It replaced the admin bundle's
 * compile-time catalog as that viewer's source — the catalog only knew hand-listed plugins, so
 * two bundled plugins (`supabase` among them) opened an empty viewer.
 *
 * Mirrors `plugins/files.ts`. Gated on `admin.plugins.read` and authorized BEFORE the id is looked
 * up. The id must equal an installed plugin's own manifest id from a fresh `listInstalledPlugins`
 * walk, so request text is never joined into a path. The first record per id wins — the same
 * single-digest policy `loadAgentPluginSearchCandidates` applies, so the viewer shows the package
 * the listing describes. Path safety (realpath inside this workspace's `packages` directory,
 * symlinks listed but never followed, count and byte caps) is `readPluginPackageFiles`'s.
 *
 * Activation is deliberately not consulted: reading a switched-off plugin's files executes nothing.
 */
export const agentPluginFilesRoute = defineJsonRoute<{ pluginId: string }, AgentPluginFilesEnvelope, AgentPluginFilesRouteDeps, AgentPluginRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/files",
  parse: (raw) => ok({ value: { pluginId: pluginIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAgentPlugins({ authorize, permission: "admin.plugins.read" });
    const { pluginId } = input;
    const workspaceLayout = deps.agentPluginLayout.forWorkspace({ workspaceId: deps.workspaceId });
    const plugin = (await deps.listPluginPackages({ workspaceRoot: workspaceLayout.root })).find((candidate) => candidate.pluginId === pluginId);
    if (!plugin) rejectRoute({ status: 404, error: "agent plugin was not found", code: "AGENT_PLUGIN_NOT_FOUND" });
    // A reader failure (e.g. a path-containment error, whose message names server paths) is rethrown
    // to the host's redacted 500 — never echoed.
    const { files, truncated } = await deps.readPluginPackageFiles({
      input: { rootDir: plugin.packageRoot, containerDir: workspaceLayout.pluginPackagesDir({ pluginId }) },
    });
    return ok({ value: { pluginId, files, truncated, limits: deps.packageFileLimits } });
  },
});
