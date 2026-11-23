import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { JsonValue } from "@jini-ai/core/primitives";
import {
  DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError, PrincipalNotFoundError, ScopeNotAllowedError,
  ValueValidationFailedError, deriveRequiredPermission, resolveTargetWorkspaceId, type SettingScope, type SettingsService,
} from "@jini-ai/core/settings";

import {
  SETTING_SCOPES, runSettingsRoute, settingsRouteInput,
  type SettingsErrorRung, type SettingsRouteInput, type SettingsRoutePrincipal, type SettingsWriteRouteBaseDeps,
} from "./shared.js";

/** The deps this route reads: the write base (readiness, ledger, fence) and the host's settings service. */
export interface SettingsSetRouteDeps extends SettingsWriteRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "set">;
}

/** The `catch` ladder `PUT /settings/value` always had, in order. */
export const SET_ERROR_MAPPINGS: readonly SettingsErrorRung[] = [
  { matches: (e) => e instanceof PrincipalNotFoundError, status: 404, code: "PRINCIPAL_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionNotFoundError, status: 404, code: "DEFINITION_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionTombstonedError, status: 409, code: "DEFINITION_TOMBSTONED" },
  { matches: (e) => e instanceof ScopeNotAllowedError, status: 400, code: "SCOPE_NOT_ALLOWED" },
  { matches: (e) => e instanceof ValueValidationFailedError, status: 400, code: "VALUE_VALIDATION_FAILED" },
  { matches: (e) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" },
];

/** The write's fields, or `null` when one is missing. `valueJson` only has to be present: a falsy
 * value (`false`, `0`, `""`, `null`) is a legitimate setting value.
 * @complexity O(1). */
function parseSetRequestFields({ rawBody }: { rawBody: unknown }, _optional = {}): {
  namespace: string; key: string; scope: SettingScope; valueJson: JsonValue; bodyWorkspaceId: unknown; principalId: string | undefined;
} | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const namespace = String(body.namespace ?? "");
  const key = String(body.key ?? "");
  const scope = body.scope as SettingScope;
  if (!namespace || !key || !SETTING_SCOPES.includes(scope) || !("valueJson" in body)) {
    return null;
  }
  return { namespace, key, scope, valueJson: body.valueJson as JsonValue, bodyWorkspaceId: body.workspaceId, principalId: body.principalId ? String(body.principalId) : undefined };
}

/**
 * PUT one setting value. Validates fields and the body workspace BEFORE authorizing (the permission
 * depends on scope and target principal); the service keeps its own inner authorization.
 */
export const settingsSetRoute = defineJsonRoute<SettingsRouteInput, { key: string; scope: SettingScope; value: unknown; revisionSeq: number }, SettingsSetRouteDeps, SettingsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/value",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    const parsed = parseSetRequestFields({ rawBody: input.body });
    if (!parsed) {
      rejectRoute({ status: 400, error: "namespace, key, scope (global|workspace|user), and valueJson are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, key, scope, valueJson, bodyWorkspaceId, principalId } = parsed;
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    const permission = deriveRequiredPermission({ scope, targetPrincipalId: principalId, callerPrincipalId: principal.id });
    await auth({ permission, entityType: "setting-value" });
    const result = await deps.settingsService().set({
      namespace, key, scope, value: valueJson, workspaceId: targetWorkspace.workspaceId, principalId,
      callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { key: `${namespace}.${key}`, scope, value: result.value, revisionSeq: result.revisionSeq };
  } }, { write: { body: input.body }, mappings: SET_ERROR_MAPPINGS }) }),
});
