import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSettingClearedDto } from "@jini-ai/core/contracts/site/cms-settings";
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

/** This route's required fields, off an untyped body: `namespace`, `key`, and a `SETTING_SCOPES`
 *  member. `null` means the body failed that check.
 *  @complexity O(1). */
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

/**
 * DELETE clear a setting's value at a scope (SPEC-007 api.spec.md
 * `SETTINGS_CLEAR`, tasks.md T041, AC-24/RT-001). The layer reads as unset again.
 * Validates before authorizing, like set.
 *
 * Mirrors `set.ts`'s shape exactly: same permission-derivation pre-check,
 * same `authWorkspaceId` expression, same `PrincipalNotFoundError`
 * -> 404 mapping (not 500 — the Red-Team RT-001 fix applies equally to
 * clear, since the write service's `clear()` runs the identical
 * `assertTargetPrincipalInWorkspace` check as `set()`).
 */
export const settingsClearRoute = defineJsonRoute<SettingsRouteInput, AdminSettingClearedDto, SettingsClearRouteDeps, SettingsRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/value",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    const parsed = parseClearRequestFields({ rawBody: input.body });
    if (!parsed) {
      rejectRoute({ status: 400, error: "namespace, key, and scope (global|workspace|user) are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, key, scope, bodyWorkspaceId, principalId } = parsed;
    // See `resolveTargetWorkspaceId` (`@jini-ai/core/settings`). This route previously took the write target
    // straight from the body while authorizing against `deps.workspaceId` below — a cross-tenant
    // clear. It also never defaulted for non-global scopes, the same masked-500 gap `set.ts` was
    // fixed for on 2026-07-31 and that its comment flagged here as an unfixed follow-up.
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    const permission = deriveRequiredPermission({ scope, targetPrincipalId: principalId, callerPrincipalId: principal.id });
    await auth({ permission, entityType: "setting-value" });
    // See `set.ts`'s identical comment: always the ambient `deps.workspaceId`,
    // never a fallback to the caller's own principal id.
    const result = await deps.settingsService().clear({
      namespace, key, scope, workspaceId: targetWorkspace.workspaceId, principalId, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { key: `${namespace}.${key}`, scope, value: null, revisionSeq: result.revisionSeq };
  } }, { write: { body: input.body }, mappings: CLEAR_ERROR_MAPPINGS }) }),
});
