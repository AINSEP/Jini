import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizePlugins, pluginIdParam, rejectPluginError, requireDiscovered, type PluginErrorClass, type PluginRouteRecord, type PluginsRoutePrincipal } from "./shared.js";

/** The `PLUGIN_FILES` envelope. */
export interface PluginFilesEnvelope { pluginId: string; source: string; files: readonly unknown[]; truncated: boolean; limits: unknown }

/** The deps this route reads (methods, so a host may bind ones typed against its full record). */
export interface PluginFilesRouteDeps {
  workspaceId: string;
  discoverPlugins(): Promise<readonly PluginRouteRecord[]>;
  /** Pre-bound package-files listing: maps the record to its directory, bounded, never following a symlink. */
  readPluginPackageFiles(record: PluginRouteRecord): Promise<{ files: readonly unknown[]; truncated: boolean }>;
  /** The listing's bounds, echoed to the viewer (the plugin engine's constant). */
  packageFileLimits: unknown;
  /** Thrown by the listing when the record's id or version is not a safe path segment. */
  unsafePathError: PluginErrorClass;
}

/**
 * `PLUGIN_FILES` — the admin Plugins screen's read-only package-files viewer: every file in ONE
 * discovered plugin's own directory. Gated on `admin.plugins.read` and authorized BEFORE the id is
 * looked up, so a caller without it learns nothing about which plugin ids exist. The id must name a
 * record in a fresh discovery pass, so no request text is ever joined into a path directly.
 */
export const pluginFilesRoute = defineJsonRoute<{ pluginId: string }, PluginFilesEnvelope, PluginFilesRouteDeps, PluginsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/files",
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePlugins({ authorize, permission: "admin.plugins.read" });
    try {
      const record = requireDiscovered({ records: await deps.discoverPlugins(), pluginId: input.pluginId });
      const { files, truncated } = await deps.readPluginPackageFiles(record);
      return ok({ value: { pluginId: input.pluginId, source: record.source, files, truncated, limits: deps.packageFileLimits } });
    } catch (err) {
      // The path error's own message names absolute server paths, so fixed text replaces it.
      return rejectPluginError({ err, rungs: [{ is: deps.unsafePathError, status: 400, code: "PLUGIN_ID_INVALID", error: "plugin id or version is not a safe path" }] });
    }
  },
});
