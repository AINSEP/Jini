import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { PluginActivationRecord, PluginActivationRepoPort, PluginConflict } from "@jini-ai/core/contracts/site/plugins-host";

import { authorizePlugins, type AdminPluginDto, type PluginRouteRecord, type PluginsRoutePrincipal } from "./shared.js";

/** The `PLUGINS_LIST` envelope: every discovered plugin plus the local install sources this server takes. */
export interface AdminPluginListEnvelope { plugins: AdminPluginDto[]; installSources: string[] }

/**
 * The deps this route reads; activation is only ever looked up, never written. The functions are
 * declared as methods so a host may bind ones typed against its full discovery record.
 */
export interface PluginListRouteDeps {
  workspaceId: string;
  pluginActivationRepo: Pick<PluginActivationRepoPort, "getActivation">;
  /** Pre-bound discovery (install dir and built-ins captured by the host); runs on every call. */
  discoverPlugins(): Promise<readonly PluginRouteRecord[]>;
  /** Each plugin's name conflicts; a host without conflict tracking answers an empty map. */
  listPluginConflicts(): Promise<ReadonlyMap<string, readonly PluginConflict[]>>;
  toAdminPluginResponse(required: { discovery: PluginRouteRecord; activation: PluginActivationRecord | null }, optional?: { conflicts?: readonly PluginConflict[] }): AdminPluginDto;
  /** Whether this server takes local (folder/ZIP) installs — host policy (env, source policy). */
  localInstallAvailable(): boolean;
}

/**
 * `PLUGINS_LIST` — a plain read gated on `admin.plugins.read`. Discovery and integrity checks run
 * server-side on every call (no refresh parameter); `enabled` is projected per record from the
 * activation row, since discovery itself does not know activation state.
 */
export const pluginListRoute = defineJsonRoute<Record<string, never>, AdminPluginListEnvelope, PluginListRouteDeps, PluginsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/plugins",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizePlugins({ authorize, permission: "admin.plugins.read" });
    const discovery = await deps.discoverPlugins();
    // 2026-10-04: each row carries its name conflicts (refused, or would be if turned on).
    const conflicts = await deps.listPluginConflicts();
    const plugins = await Promise.all(discovery.map(async (record) => {
      const activation = await deps.pluginActivationRepo.getActivation({ workspaceId: deps.workspaceId, pluginId: record.id });
      return deps.toAdminPluginResponse({ discovery: record, activation }, { conflicts: conflicts.get(record.id) ?? [] });
    }));
    return ok({ value: { plugins, installSources: deps.localInstallAvailable() ? ["folder", "zip"] : [] } });
  },
});
