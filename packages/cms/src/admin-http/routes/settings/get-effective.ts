import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { EffectiveSettingRow, SettingsService } from "@jini-ai/core/settings";

import {
  rejectCrossPrincipalRead, runSettingsRoute, settingsRouteInput,
  type SettingsReadTargetFn, type SettingsRouteBaseDeps, type SettingsRouteInput, type SettingsRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: readiness, the host's settings service, and the cross-principal read policy. */
export interface SettingsGetEffectiveRouteDeps extends SettingsRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "effective">;
  resolveReadTarget: SettingsReadTargetFn;
  crossPrincipalReadPermission: string;
}

/** Plain-words 400 for the missing namespace: the admin UI shows it verbatim. */
const NAMESPACE_REQUIRED_MESSAGE = "Say which group of settings to read: add ?namespace=<group> to the address, for example ?namespace=core.language.";

/**
 * GET the effective (layer-resolved) values of one settings namespace. Authorizes before it
 * validates; the user layer defaults to the caller's own, and naming another principal needs the
 * injected cross-principal read permission. A `workspaceId` query param is ignored, not trusted.
 */
export const settingsGetEffectiveRoute = defineJsonRoute<SettingsRouteInput, { data: EffectiveSettingRow[] }, SettingsGetEffectiveRouteDeps, SettingsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/effective",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    await auth({ permission: "settings.read", entityType: "setting-value" });
    const namespace = String(input.query.namespace ?? "");
    if (!namespace) rejectRoute({ status: 400, error: NAMESPACE_REQUIRED_MESSAGE, code: "VALIDATION_ERROR" });
    const requested = input.query.principalId ? String(input.query.principalId) : principal.id;
    const readTarget = await deps.resolveReadTarget({ requestedPrincipalId: requested, callerPrincipalId: principal.id });
    if (!readTarget.allowed) {
      rejectCrossPrincipalRead({ principalId: principal.id, reason: readTarget.reason, permission: deps.crossPrincipalReadPermission });
    }
    const data = await deps.settingsService().effective({ namespace, workspaceId: deps.workspaceId, principalId: readTarget.principalId });
    return { data };
  } }) }),
});
