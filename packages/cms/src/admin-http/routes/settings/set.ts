import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSettingValueDto } from "@jini-ai/core/contracts/site/cms-settings";
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

/** This route's required fields, off an untyped body: `namespace`, `key`, a `SETTING_SCOPES` member,
 *  and a `valueJson` property (its presence, not its truthiness — `null`/`0`/`""` are legal values,
 *  which is why this checks `"valueJson" in body` rather than `body.valueJson !== undefined`).
 *  `null` means the body failed that check.
 *  @complexity O(1). */
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
 * PUT set a setting's value at a scope (SPEC-007 api.spec.md `SETTINGS_SET`,
 * tasks.md T040, AC-24/RT-001). Validates fields and the body workspace BEFORE authorizing (the
 * permission depends on scope and target principal); the service keeps its own inner authorization.
 *
 * Path deviation: see `register-definitions.ts`'s header.
 *
 * `deriveRequiredPermission` (the self-vs-other rule, behavior.spec.md §1.3)
 * computes the permission before this route's own explicit `authorize()`
 * pre-check — the write service's `set()` re-checks the identical permission
 * internally (chokepoint discipline), so this is belt-and-suspenders: the
 * pre-check gives a fast, structured 403 body matching the other
 * routes; the inner check is the real, non-bypassable gate.
 *
 * `PrincipalNotFoundError` (REQ-13/INV-09 — a `scope=user` write targeting a
 * `principalId` that isn't an active principal in the request's workspace)
 * maps to 404, NOT 500 — this was Red-Team RT-001's flagged gap.
 */
export const settingsSetRoute = defineJsonRoute<SettingsRouteInput, AdminSettingValueDto, SettingsSetRouteDeps, SettingsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/value",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    const parsed = parseSetRequestFields({ rawBody: input.body });
    if (!parsed) {
      rejectRoute({ status: 400, error: "namespace, key, scope (global|workspace|user), and valueJson are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, key, scope, valueJson, bodyWorkspaceId, principalId } = parsed;
    // The write target is the ambient workspace, never the body's. See
    // `resolveTargetWorkspaceId` (`@jini-ai/core/settings`) for why a body-named
    // workspace is REJECTED rather than honored: accepting it authorized
    // against this workspace while writing another tenant's row.
    //
    // This also keeps the 2026-07-31 fix it replaces: `scope: "user"` and
    // `scope: "workspace"` writes with no `workspaceId` in the body used to
    // reach the write service's `set()` as `undefined`, which
    // `saveUserValue`/`saveWorkspaceValue` (the settings repo) require and
    // throw on -- a masked 500 for every settings-dialog tab adapter in
    // the host's admin app, none of which send it.
    // Defaulting to `deps.workspaceId` for non-global scopes is what every
    // other settings route already does (`get-effective.ts`,
    // `list-definitions.ts`), because the `:workspaceId` path param is
    // 404-checked against `deps.workspaceId` above (ADR-007).
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    const permission = deriveRequiredPermission({ scope, targetPrincipalId: principalId, callerPrincipalId: principal.id });
    await auth({ permission, entityType: "setting-value" });
    // The ambient workspace this whole route operates within (single-
    // workspace v1) — always `deps.workspaceId`, never a fallback to the
    // caller's own principal id (that fallback is what the write service
    // used internally pre-Phase-5; it breaks `authorize()`'s real
    // `findById({workspaceId, id})` lookup for `scope=global` requests,
    // which never carry a `workspaceId`). Passed through as
    // `authWorkspaceId` below so the inner chokepoint check uses the same
    // value as this pre-check.
    const result = await deps.settingsService().set({
      namespace, key, scope, value: valueJson, workspaceId: targetWorkspace.workspaceId, principalId,
      callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { key: `${namespace}.${key}`, scope, value: result.value, revisionSeq: result.revisionSeq };
  } }, { write: { body: input.body }, mappings: SET_ERROR_MAPPINGS }) }),
});
