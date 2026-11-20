import type { JsonValue, UUID } from "../primitives/index.js";
import { DefinitionNotFoundError, DefinitionTombstonedError, PrincipalNotFoundError, ScopeNotAllowedError, ValueValidationFailedError } from "./errors.js";
import { resolveDefinitionRaw, validateValueAgainstSchema } from "./settings.js";
import { SCOPE_BIT, type SettingScope } from "./types.js";
import { type SettingsWriteServiceDeps } from './write-service.js';
import { type SettingsValueWriteOptions, assertTargetWorkspaceMatchesAuth, authorizeValueWrite, derivePermissionFor, writeValueRevision } from './write-value-revisions.js';
export interface SetValueRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    scope: SettingScope;
    value: JsonValue;
    workspaceId?: UUID | undefined;
    principalId?: UUID | undefined;
    callerPrincipalId: UUID;
    /**
     * The ambient workspace to authorize the caller's grant in. Optional and
     * additive: when omitted, falls back to `input.workspaceId ??
     * input.callerPrincipalId`. Callers that DO have a real ambient workspace
     * (every HTTP route in a single-workspace host) should pass it
     * explicitly: for `scope=global` (no `workspaceId`), falling back to
     * `callerPrincipalId` as a stand-in "workspace" id is nonsensical against
     * the real `authorize()` (identity's own authorize looks the principal up
     * by `{workspaceId, id}` — a bogus workspaceId means `findById` returns
     * null and every request is denied `principal_disabled`, including the
     * wildcard-owner).
     */
    authWorkspaceId?: UUID | undefined;
    /** Set by a caller that has ALREADY opened a transaction around this write —
     *  see `resetNamespace`. Explicit rather than an ambient depth counter,
     *  because an ambient one cannot tell a genuine nesting from a concurrent
     *  unrelated transaction and silently merges the two. */
    skipTransaction?: boolean | undefined;
    /**
     * `deriveRequiredPermission` unconditionally derives `settings.workspace.write` for
     * `scope: "workspace"` — a caller that already authorized a narrower, domain-specific
     * permission at its own route layer (e.g. a comments module's `comments.configure`, an SEO
     * module's `admin.seo.manage`) still hits this chokepoint's generic `settings.workspace.write`
     * check and gets a masked 500 if it lacks that broader grant, even though its own domain
     * permission is exactly what the feature's admin UI advertises as sufficient. Optional and
     * additive: omitted, behavior is unchanged (every pre-existing caller still gets the
     * scope-derived permission). When a domain-settings module supplies this, the chokepoint
     * authorizes THIS permission instead of the scope-derived one — still a mandatory
     * `authorize` call before any write ( fail-closed discipline is not relaxed, only
     * which permission string is checked).
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
    requiredPermissionOverride?: string | undefined;
  };
}

export async function resolveScopedDefinitionOrThrow(
  deps: SettingsWriteServiceDeps,
  input: { namespace: string; key: string; scope: SettingScope; workspaceId?: UUID | undefined }
) {
  const definitionWorkspaceId = input.scope === "global" ? null : (input.workspaceId ?? null);
  const definition = await resolveDefinitionRaw(deps, {
    namespace: input.namespace,
    key: input.key,
    workspaceId: definitionWorkspaceId,
  });
  if (!definition) {
    throw new DefinitionNotFoundError(`setting '${input.namespace}.${input.key}' was not found`);
  }
  if (definition.status === "tombstone") {
    throw new DefinitionTombstonedError(`setting '${input.namespace}.${input.key}' has been tombstoned`);
  }
  if ((definition.scopes & SCOPE_BIT[input.scope]) === 0) {
    throw new ScopeNotAllowedError(
      `setting '${input.namespace}.${input.key}' does not allow scope '${input.scope}'`
    );
  }
  return definition;
}

/**
 * — for scope=user writes targeting another principal, verify
 * that principal resolves to an active user whose own `workspace_id` equals
 * the request's `workspaceId` (structural scoping — a principal
 * belongs to exactly one workspace, not a membership join).
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
async function assertTargetPrincipalInWorkspace(
  deps: SettingsWriteServiceDeps,
  input: { scope: SettingScope; workspaceId?: UUID | undefined; principalId?: UUID | undefined; callerPrincipalId: UUID }
): Promise<void> {
  if (input.scope !== "user") return;
  if (!input.principalId || input.principalId === input.callerPrincipalId) return;
  if (!input.workspaceId) return;

  const principal = await deps.principals.findActiveById({ workspaceId: input.workspaceId, id: input.principalId });
  if (!principal) {
    throw new PrincipalNotFoundError(
      `principal '${input.principalId}' was not found in workspace '${input.workspaceId}'`,
      input.principalId,
      input.workspaceId
    );
  }
}

/**
 * Authorize -> validate -> value + revision in one transaction. An optional expectedRevisionSeq
 * refuses a stale scoped value and rolls back its revision; omission keeps unconditional writes.
 * @example await set({ deps, input }, { expectedRevisionSeq: snapshotSeq });
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export async function set(required: SetValueRequired, optional: SettingsValueWriteOptions = {}): Promise<{ value: JsonValue; revisionSeq: number }> {
  const { deps, input } = required;

  await authorizeValueWrite({ deps, input, permission: input.requiredPermissionOverride ?? derivePermissionFor({ input }) });

  const definition = await resolveScopedDefinitionOrThrow(deps, input);

  if (!validateValueAgainstSchema({ schema: definition.schema, value: input.value })) {
    throw new ValueValidationFailedError(
      `value for '${input.namespace}.${input.key}' does not match the definition schema`
    );
  }

  await assertTargetPrincipalInWorkspace(deps, input);

  const runSet = () => writeValueRevision({
    deps, input, definition, optional, change: { op: "set", afterJson: input.value, valueJson: input.value, state: "set" },
  }).then(({ revisionSeq }) => ({ value: input.value, revisionSeq }));

  // `skipTransaction` means an enclosing caller already owns the boundary, so
  // this write joins it and a later failure rolls this one back too.
  return input.skipTransaction ? runSet() : deps.repo.transaction(runSet);
}

export interface ClearValueRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    scope: SettingScope;
    workspaceId?: UUID | undefined;
    principalId?: UUID | undefined;
    callerPrincipalId: UUID;
    /** Set by `resetNamespace` when looping `clear` in its own reset-authorized context — bypasses the inner authorize re-check, still writes a normal revision. See docs/decisions/DR-003-settings-ledger-invariants.md. */
    skipAuthorize?: boolean | undefined;
    /** Set by a caller that has ALREADY opened a transaction around this write —
     *  see `resetNamespace`. Explicit rather than an ambient depth counter,
     *  because an ambient one cannot tell a genuine nesting from a concurrent
     *  unrelated transaction and silently merges the two. */
    skipTransaction?: boolean | undefined;
    /** See `SetValueRequired.input.authWorkspaceId`'s doc. Optional/additive. */
    authWorkspaceId?: UUID | undefined;
  };
}

/**
 * Authorize -> cleared value + revision in one transaction; the optional concurrency guard has
 * the same semantics as `set`. With skipTransaction, the enclosing caller must propagate errors
 * so its transaction rolls back the appended revision on conflict.
 * @example await clear({ deps, input }, { expectedRevisionSeq: snapshotSeq });
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export async function clear(required: ClearValueRequired, optional: SettingsValueWriteOptions = {}): Promise<{ revisionSeq: number }> {
  const { deps, input } = required;

  if (!input.skipAuthorize) await authorizeValueWrite({ deps, input, permission: derivePermissionFor({ input }) });

  const definition = await resolveScopedDefinitionOrThrow(deps, input);
  await assertTargetPrincipalInWorkspace(deps, input);

  const runClear = () => writeValueRevision({
    deps, input, definition, optional, change: { op: "clear", afterJson: null, valueJson: null, state: "cleared" },
  });

  // `skipTransaction` means an enclosing caller already owns the boundary, so
  // this write joins it and a later failure rolls this one back too.
  return input.skipTransaction ? runClear() : deps.repo.transaction(runClear);
}
