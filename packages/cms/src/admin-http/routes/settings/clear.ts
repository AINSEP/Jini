import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import {
  DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError, PrincipalNotFoundError, ScopeNotAllowedError,
  deriveRequiredPermission, resolveTargetWorkspaceId, type SettingScope, type SettingsService,
} from "@jini-ai/core/settings";

import {
  SETTING_SCOPES, runSettingsRoute, settingsRouteInput,
  type SettingsErrorRung, type SettingsRouteInput, type SettingsRoutePrincipal, type SettingsWriteRouteBaseDeps,
} from "./shared.js";

/** The deps this route reads: the write base (readiness, ledger, fence) and the host's settings service. */
export interface SettingsClearRouteDeps extends SettingsWriteRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "clear">;
}

/** The `catch` ladder `DELETE /settings/value` always had, in order. */
export const CLEAR_ERROR_MAPPINGS: readonly SettingsErrorRung[] = [
  { matches: (e) => e instanceof PrincipalNotFoundError, status: 404, code: "PRINCIPAL_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionNotFoundError, status: 404, code: "DEFINITION_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionTombstonedError, status: 409, code: "DEFINITION_TOMBSTONED" },
  { matches: (e) => e instanceof ScopeNotAllowedError, status: 400, code: "SCOPE_NOT_ALLOWED" },
  { matches: (e) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" },
];

/** The clear's fields, or `null` when one is missing. @complexity O(1). */
function parseClearRequestFields({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): {
  namespace: string; key: string; scope: SettingScope; bodyWorkspaceId: unknown; principalId: string | undefined;
} | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const namespace = String(body.namespace ?? "");
  const key = String(body.key ?? "");
  const scope = body.scope as SettingScope;
  if (!namespace || !key || !SETTING_SCOPES.includes(scope)) {
    return null;
  }
  return { namespace, key, scope, bodyWorkspaceId: body.workspaceId, principalId: body.principalId ? String(body.principalId) : undefined };
}

/** DELETE one setting value (the layer reads as unset again). Validates before authorizing, like set. */
export const settingsClearRoute = defineJsonRoute<SettingsRouteInput, { key: string; scope: SettingScope; value: null; revisionSeq: number }, SettingsClearRouteDeps, SettingsRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/value",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    const parsed = parseClearRequestFields({ rawBody: input.body });
    if (!parsed) {
      rejectRoute({ status: 400, error: "namespace, key, and scope (global|workspace|user) are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, key, scope, bodyWorkspaceId, principalId } = parsed;
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    const permission = deriveRequiredPermission({ scope, targetPrincipalId: principalId, callerPrincipalId: principal.id });
    await auth({ permission, entityType: "setting-value" });
    const result = await deps.settingsService().clear({
      namespace, key, scope, workspaceId: targetWorkspace.workspaceId, principalId, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { key: `${namespace}.${key}`, scope, value: null, revisionSeq: result.revisionSeq };
  } }, { write: { body: input.body }, mappings: CLEAR_ERROR_MAPPINGS }) }),
});
