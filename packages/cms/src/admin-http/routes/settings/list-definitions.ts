import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { SettingDefinitionRecord, SettingsService } from "@jini-ai/core/settings";

import { runSettingsRoute, settingsRouteInput, type SettingsRouteBaseDeps, type SettingsRouteInput, type SettingsRoutePrincipal } from "./shared.js";

/** The deps this route reads: readiness and the host's settings service. */
export interface SettingsListDefinitionsRouteDeps extends SettingsRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "listDefinitions">;
}

/** One listed definition: identity, owner, scopes and lifecycle only (never schema or default). */
export type SettingsDefinitionSummary = Pick<SettingDefinitionRecord, "namespace" | "key" | "ownerKind" | "scopes" | "status" | "version">;

/** GET the workspace's registered setting definitions, sorted by namespace then key. */
export const settingsListDefinitionsRoute = defineJsonRoute<SettingsRouteInput, { data: SettingsDefinitionSummary[] }, SettingsListDefinitionsRouteDeps, SettingsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/definitions",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ authorize: auth }) => {
    await auth({ permission: "settings.read.definitions", entityType: "setting-definition" });
    const definitions = await deps.settingsService().listDefinitions({ workspaceId: deps.workspaceId });
    const data = definitions
      .map((def) => ({ namespace: def.namespace, key: def.key, ownerKind: def.ownerKind, scopes: def.scopes, status: def.status, version: def.version }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));
    return { data };
  } }) }),
});
