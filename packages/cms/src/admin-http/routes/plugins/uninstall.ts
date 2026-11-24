import type { Clock } from "@jini-ai/core/primitives";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizePlugins, pluginActorId, pluginIdParam, rejectPluginError, type PluginErrorClass, type PluginRouteRecord, type PluginsRoutePrincipal } from "./shared.js";

/** One uninstall request, as the plugin engine's `uninstallPlugin` takes it. */
export interface PluginUninstallInput { pluginId: string; workspaceId: string; at: string; actor: { principalId: string } }

/** The error classes the uninstall ladder maps, in ladder order. */
export interface PluginUninstallErrors {
  notFound: PluginErrorClass;
  notUninstallable: PluginErrorClass;
  enabled: PluginErrorClass;
  alreadyInTrash: PluginErrorClass;
  /** The host's own refusal of an id/version that is not a safe path. */
  unsafePath: PluginErrorClass;
}

/** The deps this route reads. */
export interface PluginUninstallRouteDeps {
  workspaceId: string;
  clock: Pick<Clock, "nowMs">;
  discoverPlugins(): Promise<readonly PluginRouteRecord[]>;
  /** The engine's uninstall, pre-bound to the activation repo and the host's Trash move. */
  uninstallPlugin(required: { discovery: readonly PluginRouteRecord[]; input: PluginUninstallInput }): Promise<{ trashed: unknown }>;
  uninstallErrors: PluginUninstallErrors;
}

/** The ladder, top to bottom, exactly as the hand-written route ordered it. @complexity O(1). */
function uninstallRungs(errors: PluginUninstallErrors, _optional: Record<string, never> = {}) {
  return [
    { is: errors.notFound, status: 404, code: "PLUGIN_NOT_FOUND" },
    { is: errors.notUninstallable, status: 422, code: "PLUGIN_NOT_UNINSTALLABLE" },
    { is: errors.enabled, status: 409, code: "PLUGIN_ENABLED" },
    { is: errors.alreadyInTrash, status: 409, code: "PLUGIN_IN_TRASH" },
    { is: errors.unsafePath, status: 400, code: "PLUGIN_ID_INVALID" },
  ] as const;
}

/**
 * `PLUGIN_UNINSTALL` moves a site plugin to the 60-day Trash. The package directory is shared by
 * every workspace on this site, while the Trash row belongs to the workspace making the request.
 */
export const pluginUninstallRoute = defineJsonRoute<{ pluginId: string }, { pluginId: string; trashed: unknown }, PluginUninstallRouteDeps, PluginsRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId",
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = pluginActorId({ context });
    await authorizePlugins({ authorize, permission: "admin.plugins.enable" });
    try {
      const discovery = await deps.discoverPlugins();
      const at = new Date(deps.clock.nowMs()).toISOString();
      const result = await deps.uninstallPlugin({ discovery, input: { pluginId: input.pluginId, workspaceId: deps.workspaceId, at, actor: { principalId } } });
      return ok({ value: { pluginId: input.pluginId, trashed: result.trashed } });
    } catch (err) {
      return rejectPluginError({ err, rungs: uninstallRungs(deps.uninstallErrors) });
    }
  },
});
