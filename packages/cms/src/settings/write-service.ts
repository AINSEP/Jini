import type { ClockPort, IdGeneratorPort, JsonValue, UUID } from "../core/ports.js";
import type { PrincipalRepoPort } from "../identity/index.js";
import {
  AliasDepthExceededError,
  DefinitionInvalidError,
  DefinitionNotFoundError,
  DefinitionTombstonedError,
  ForbiddenError,
  PrincipalNotFoundError,
  RenameRetypeConflictError,
  ScopeNotAllowedError,
  ValueValidationFailedError,
} from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import {
  type DefinitionInput,
  invalidateDefinitionNamespaceCache,
  resolveDefinitionRaw,
  validateDefinitionInput,
  validateValueAgainstSchema,
} from "./settings.js";
import { SCOPE_BIT, type SettingDefinitionRecord, type SettingScope, type SettingValueSchema } from "./types.js";

/**
 * @file `SettingsWriteService` — the single write chokepoint (SPEC-007 REQ-04;
 * ADR-028 §4; ADR-PIPE-007).
 *
 * Purpose:
 * The ONLY value/definition-mutation path. Repo write methods
 * (`saveDefinition`/`save*Value`/`appendRevision`/`delete*Value`) must never
 * be called from outside this file (Code Review enforces this as a file-
 * boundary check, ADR-PIPE-007 Enforcement).
 *
 * Every export here: `authorize()` first (fail-closed, INV-07) -> validate ->
 * write value/definition row + revision in one transaction (INV-01).
 *
 * `deriveRequiredPermission` is the sole source of truth for the self-vs-
 * other permission rule (behavior.spec.md §1.3) — closes Red-Team RT-003.
 * REQ-13's target-principal check reuses `identity.PrincipalRepoPort`
 * directly — no new port (closes RT-001/RT-002 at the implementation level).
 */

/** Matches `core/commands/command.ts`'s `AuthorizeFn` shape structurally — no import, kept decoupled. */
export type AuthorizeFn = (params: {
  principalId: UUID;
  permission: string;
  workspaceId: UUID;
  entityType?: string;
  entityId?: UUID;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface SettingsWriteServiceDeps {
  repo: SettingsRepoPort;
  clock: ClockPort;
  ids: IdGeneratorPort;
  authorize: AuthorizeFn;
  /** REQ-13 — reused directly from `identity`, not duplicated (ADR-PIPE-007 Pattern Evaluation). */
  principals: PrincipalRepoPort;
}

/**
 * behavior.spec.md §1.3 / REQ-06 `[internal-invariant]` — the self-vs-other
 * permission derivation. `targetPrincipalId` omitted or equal to the caller
 * -> `settings.user.self.write`; any other principal -> `settings.user.write`.
 * A divergence between this function and any other implementation of the
 * rule is a fail-open authorization bug (Red-Team RT-003) — this is the only
 * place the rule may be encoded.
 *
 * @complexity O(1), pure.
 * @overallScore 100
 */
export function deriveRequiredPermission(input: {
  scope: SettingScope;
  targetPrincipalId?: UUID | undefined;
  callerPrincipalId: UUID;
}): string {
  if (input.scope === "global") return "settings.global.write";
  if (input.scope === "workspace") return "settings.workspace.write";
  const isSelf = input.targetPrincipalId == null || input.targetPrincipalId === input.callerPrincipalId;
  return isSelf ? "settings.user.self.write" : "settings.user.write";
}

export interface RegisterDefinitionsRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    definitions: DefinitionInput[];
    callerPrincipalId: UUID;
    /** The workspace the caller is authorizing in (always required — even platform-def registration is authorized within a workspace context). */
    authWorkspaceId: UUID;
  };
}

/** REQ-02/REQ-09 chokepoint write: authorize `settings.definitions.manage` -> validate -> write + revision, one per definition, each its own tx. */
export async function registerDefinitions(
  required: RegisterDefinitionsRequired
): Promise<{ registered: string[] }> {
  const { deps, input } = required;

  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: "settings.definitions.manage",
    workspaceId: input.authWorkspaceId,
    entityType: "setting-definition",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for 'settings.definitions.manage' (${authResult.reason})`
    );
  }

  const registered: string[] = [];
  for (const definitionInput of input.definitions) {
    const validation = validateDefinitionInput(definitionInput);
    if (!validation.valid) throw validation.error;

    await deps.repo.transaction(async () => {
      const now = deps.clock.nowIso();
      const settingId = deps.ids.newId();
      await deps.repo.saveDefinition({
        settingId,
        version: 1,
        workspaceId: definitionInput.workspaceId,
        namespace: definitionInput.namespace,
        key: definitionInput.key,
        ownerKind: definitionInput.ownerKind,
        ownerId: definitionInput.ownerId ?? null,
        schema: definitionInput.schema,
        defaultValue: definitionInput.defaultValue,
        scopes: definitionInput.scopes,
        secret: false,
        status: "active",
        aliasOfNamespace: null,
        aliasOfKey: null,
        coercionTag: null,
        createdAt: now,
        updatedAt: now,
      });
      await deps.repo.appendRevision({
        entityKind: "definition",
        settingId,
        scope: null,
        workspaceId: definitionInput.workspaceId,
        principalId: null,
        op: "register",
        beforeJson: null,
        afterJson: null,
        defVersion: 1,
        actor: input.callerPrincipalId,
        originPluginId: null,
        changeSetId: null,
        createdAt: now,
      });
      registered.push(settingId);
    });
    invalidateDefinitionNamespaceCache(deps.repo, definitionInput.namespace);
  }

  return { registered };
}

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
     * `authorize()` call before any write (INV-07 fail-closed discipline is not relaxed, only
     * which permission string is checked).
     */
    requiredPermissionOverride?: string | undefined;
  };
}

async function resolveScopedDefinitionOrThrow(
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
 * Every non-global write must land in the workspace it was AUTHORIZED against.
 *
 * `authorize()` is called with `authWorkspaceId` while the value row and revision are written with
 * `input.workspaceId`. Nothing forces the two to match unless this guard runs — a caller that
 * constructs the input directly (rather than through a route that validates the body against the
 * ambient workspace) could otherwise pass a mismatched target and have the write land in a
 * workspace neither `authorize()` call was actually evaluated against.
 *
 * A host's HTTP routes should reject a mismatched body id at the route layer (the real fix, closer
 * to the request). This is the backstop: it holds for every internal caller that constructs the
 * input directly, and makes a future caller incapable of reintroducing the gap.
 *
 * `ForbiddenError` rather than a validation error because the condition is exactly "you are not
 * authorized to write to that workspace".
 *
 * `scope: "global"` is exempt: the platform partition has no workspace, and `set`/`clear` already
 * force `workspaceId: null` on that path.
 */
function assertTargetWorkspaceMatchesAuth(input: {
  scope: SettingScope;
  workspaceId?: UUID | undefined;
  authWorkspaceId: UUID;
  callerPrincipalId: UUID;
}): void {
  if (input.scope === "global") return;
  if (input.workspaceId === undefined) return;
  if (input.workspaceId === input.authWorkspaceId) return;
  throw new ForbiddenError(
    `principal '${input.callerPrincipalId}' authorized against workspace '${input.authWorkspaceId}' ` +
      `but the write targets workspace '${input.workspaceId}'`
  );
}

/**
 * REQ-13/INV-09 — for scope=user writes targeting another principal, verify
 * that principal resolves to an active user whose own `workspace_id` equals
 * the request's `workspaceId` (ADR-007 structural scoping — a principal
 * belongs to exactly one workspace, not a membership join).
 */
async function assertTargetPrincipalInWorkspace(
  deps: SettingsWriteServiceDeps,
  input: { scope: SettingScope; workspaceId?: UUID | undefined; principalId?: UUID | undefined; callerPrincipalId: UUID }
): Promise<void> {
  if (input.scope !== "user") return;
  if (!input.principalId || input.principalId === input.callerPrincipalId) return;
  if (!input.workspaceId) return;

  const principal = await deps.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
  if (!principal || principal.status === "disabled") {
    throw new PrincipalNotFoundError(
      `principal '${input.principalId}' was not found in workspace '${input.workspaceId}'`,
      input.principalId,
      input.workspaceId
    );
  }
}

/** REQ-04/REQ-13 chokepoint write: authorize -> validate -> value + revision, same tx. */
export async function set(required: SetValueRequired): Promise<{ value: JsonValue; revisionSeq: number }> {
  const { deps, input } = required;

  const permission =
    input.requiredPermissionOverride ??
    deriveRequiredPermission({
      scope: input.scope,
      targetPrincipalId: input.principalId,
      callerPrincipalId: input.callerPrincipalId,
    });
  const authWorkspaceId = input.authWorkspaceId ?? input.workspaceId ?? input.callerPrincipalId;
  assertTargetWorkspaceMatchesAuth({ ...input, authWorkspaceId });
  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission,
    workspaceId: authWorkspaceId,
    entityType: "setting-value",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for '${permission}' (${authResult.reason})`
    );
  }

  const definition = await resolveScopedDefinitionOrThrow(deps, input);

  if (!validateValueAgainstSchema(definition.schema, input.value)) {
    throw new ValueValidationFailedError(
      `value for '${input.namespace}.${input.key}' does not match the definition schema`
    );
  }

  await assertTargetPrincipalInWorkspace(deps, input);

  const result = await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();
    const revisionSeq = await deps.repo.appendRevision({
      entityKind: "value",
      settingId: definition.settingId,
      scope: input.scope,
      workspaceId: input.scope === "global" ? null : (input.workspaceId ?? null),
      principalId: input.scope === "user" ? (input.principalId ?? input.callerPrincipalId) : null,
      op: "set",
      beforeJson: null,
      afterJson: input.value,
      defVersion: definition.version,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });

    const base = {
      settingId: definition.settingId,
      scope: input.scope,
      valueJson: input.value,
      state: "set" as const,
      defVersion: definition.version,
      seq: revisionSeq,
      updatedBy: input.callerPrincipalId,
      updatedAt: now,
      originPluginId: null,
    };

    if (input.scope === "global") {
      await deps.repo.saveGlobalValue({ ...base, workspaceId: null, principalId: null });
    } else if (input.scope === "workspace") {
      await deps.repo.saveWorkspaceValue({
        ...base,
        workspaceId: input.workspaceId ?? null,
        principalId: null,
      });
    } else {
      await deps.repo.saveUserValue({
        ...base,
        workspaceId: input.workspaceId ?? null,
        principalId: input.principalId ?? input.callerPrincipalId,
      });
    }

    return { value: input.value, revisionSeq };
  });

  return result;
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
    /** Set by `resetNamespace` when looping `clear()` in its own reset-authorized context (ADR-028 §7 R3-01) — bypasses the inner authorize() re-check, still writes a normal revision. */
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

/** REQ-04/REQ-13 chokepoint write: authorize -> value + revision (state='cleared'), same tx. */
export async function clear(required: ClearValueRequired): Promise<{ revisionSeq: number }> {
  const { deps, input } = required;

  if (!input.skipAuthorize) {
    const permission = deriveRequiredPermission({
      scope: input.scope,
      targetPrincipalId: input.principalId,
      callerPrincipalId: input.callerPrincipalId,
    });
    const authWorkspaceId = input.authWorkspaceId ?? input.workspaceId ?? input.callerPrincipalId;
    assertTargetWorkspaceMatchesAuth({ ...input, authWorkspaceId });
    const authResult = await deps.authorize({
      principalId: input.callerPrincipalId,
      permission,
      workspaceId: authWorkspaceId,
      entityType: "setting-value",
    });
    if (!authResult.allowed) {
      throw new ForbiddenError(
        `principal '${input.callerPrincipalId}' is not authorized for '${permission}' (${authResult.reason})`
      );
    }
  }

  const definition = await resolveScopedDefinitionOrThrow(deps, input);
  await assertTargetPrincipalInWorkspace(deps, input);

  const runClear = async () => {
    const now = deps.clock.nowIso();
    const revisionSeq = await deps.repo.appendRevision({
      entityKind: "value",
      settingId: definition.settingId,
      scope: input.scope,
      workspaceId: input.scope === "global" ? null : (input.workspaceId ?? null),
      principalId: input.scope === "user" ? (input.principalId ?? input.callerPrincipalId) : null,
      op: "clear",
      beforeJson: null,
      afterJson: null,
      defVersion: definition.version,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });

    const base = {
      settingId: definition.settingId,
      scope: input.scope,
      valueJson: null,
      state: "cleared" as const,
      defVersion: definition.version,
      seq: revisionSeq,
      updatedBy: input.callerPrincipalId,
      updatedAt: now,
      originPluginId: null,
    };

    if (input.scope === "global") {
      await deps.repo.saveGlobalValue({ ...base, workspaceId: null, principalId: null });
    } else if (input.scope === "workspace") {
      await deps.repo.saveWorkspaceValue({
        ...base,
        workspaceId: input.workspaceId ?? null,
        principalId: null,
      });
    } else {
      await deps.repo.saveUserValue({
        ...base,
        workspaceId: input.workspaceId ?? null,
        principalId: input.principalId ?? input.callerPrincipalId,
      });
    }

    return { revisionSeq };
  };

  // `skipTransaction` means an enclosing caller already owns the boundary, so
  // this write joins it and a later failure rolls this one back too.
  const result = input.skipTransaction ? await runClear() : await deps.repo.transaction(runClear);

  return result;
}

export interface ResetNamespaceRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    scope: Exclude<SettingScope, never>;
    workspaceId?: UUID | undefined;
    principalId?: UUID | undefined;
    callerPrincipalId: UUID;
    /** See `SetValueRequired.input.authWorkspaceId`'s doc. Optional/additive. */
    authWorkspaceId?: UUID | undefined;
  };
}

/**
 * EC-09/ADR-028 §7 R3-01 — an explicit, human-invoked orchestrator: authorize
 * the matching `settings.reset.*` permission once, then loop `clear()` for
 * every setting in the namespace in the reset-authorized internal context
 * (`skipAuthorize: true`) — the outer reset permission is sufficient on its
 * own; each inner clear still emits its own `op='clear'` revision.
 *
 * `revisionSeqs` collects each inner `clear()` call's own `revisionSeq` so a
 * host's admin HTTP route can surface the full contract without a second
 * read. Existing callers that only read `.clearedCount` are unaffected.
 */
export async function resetNamespace(
  required: ResetNamespaceRequired,
  keysInNamespace: string[]
): Promise<{ clearedCount: number; revisionSeqs: number[] }> {
  const { deps, input } = required;

  const resetPermission = `settings.reset.${input.scope}`;
  const authWorkspaceId = input.authWorkspaceId ?? input.workspaceId ?? input.callerPrincipalId;
  // Asserted once here rather than per inner `clear()`: those run with `skipAuthorize: true`, which
  // short-circuits the same check inside `clear()`. This is the only gate for the whole loop.
  assertTargetWorkspaceMatchesAuth({ ...input, authWorkspaceId });
  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: resetPermission,
    workspaceId: authWorkspaceId,
    entityType: "setting-namespace",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for '${resetPermission}' (${authResult.reason})`
    );
  }

  // One transaction around the whole loop, so a reset is all-or-nothing.
  //
  // Each `clear()` opens its own transaction and commits on its own, so a
  // failure partway through used to leave the namespace HALF reset — some keys
  // durably cleared, the rest untouched — while the caller received an error and
  // could reasonably assume nothing had happened. "Reset this namespace" is not
  // a meaningful operation if it can apply to an arbitrary prefix of the keys.
  //
  // This works because each inner `clear()` is passed `skipTransaction: true`
  // and so writes into THIS frame instead of opening its own. That is explicit
  // at the call site by design: an earlier version made `transaction` reentrant
  // via an instance-level depth counter, which could not tell a genuine nested
  // call from an unrelated concurrent one and silently merged the two.
  //
  // Both adapters honour the rollback: a SQLite adapter via ROLLBACK, and
  // `repo.memory.ts` via a snapshot/restore journal.
  return deps.repo.transaction(async () => {
    let clearedCount = 0;
    const revisionSeqs: number[] = [];
    for (const key of keysInNamespace) {
      const result = await clear({
        deps,
        input: {
          namespace: input.namespace,
          key,
          scope: input.scope,
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          callerPrincipalId: input.callerPrincipalId,
          skipAuthorize: true,
          skipTransaction: true,
        },
      });
      revisionSeqs.push(result.revisionSeq);
      clearedCount++;
    }

    return { clearedCount, revisionSeqs };
  });
}

/**
 * ADR-028 §3/§7 — the single authorization gate shared by every definition-
 * lifecycle op (rename/retype/deprecate/tombstone), matching
 * `registerDefinitions`'s own `settings.definitions.manage` check (same
 * permission also gates `purge`/`coerce` per §7 — high privilege, human-only).
 */
async function authorizeDefinitionsManage(
  deps: SettingsWriteServiceDeps,
  callerPrincipalId: UUID,
  authWorkspaceId: UUID
): Promise<void> {
  const authResult = await deps.authorize({
    principalId: callerPrincipalId,
    permission: "settings.definitions.manage",
    workspaceId: authWorkspaceId,
    entityType: "setting-definition",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${callerPrincipalId}' is not authorized for 'settings.definitions.manage' (${authResult.reason})`
    );
  }
}

/** Resolves the canonical active definition at (namespace,key,workspaceId), rejecting anything but `status='active'`. */
async function resolveActiveDefinitionOrThrow(
  deps: SettingsWriteServiceDeps,
  input: { namespace: string; key: string; workspaceId: UUID | null },
  verb: string
): Promise<SettingDefinitionRecord> {
  const current = await deps.repo.findActiveDefinition(input);
  if (!current) {
    throw new DefinitionNotFoundError(`setting '${input.namespace}.${input.key}' was not found`);
  }
  if (current.status === "tombstone") {
    throw new DefinitionTombstonedError(`setting '${input.namespace}.${input.key}' has been tombstoned`);
  }
  if (current.status === "alias") {
    throw new DefinitionInvalidError(
      `cannot ${verb} '${input.namespace}.${input.key}': it is an alias marker, not the canonical active definition`
    );
  }
  return current;
}

export interface RenameDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    newNamespace: string;
    newKey: string;
    callerPrincipalId: UUID;
    /** The workspace the caller is authorizing in (see `registerDefinitions`' identical field). */
    authWorkspaceId: UUID;
  };
}

/**
 * ADR-028 §3 rename mechanism (AC-09, EC-06): a same-tx pair —
 * (1) UPDATE the active definition row's `(namespace,key)` to the new name,
 * same `setting_id`/`version` (ledgered `op='alias'`); (2) INSERT a fresh v1
 * alias marker at the OLD name pointing at the new name. Because identity
 * never moves, value rows (keyed on `setting_id` only) stay attached.
 *
 * Sequential rename (A->B then B->C) retargets every prior marker pointing
 * at the OLD name to the NEW name in the same tx. A rename target that
 * itself resolves to an existing alias is rejected `ALIAS_DEPTH_EXCEEDED`
 * (behavior.spec.md §7: "the rename target resolves to an alias").
 *
 * Never touches `schema`/`defaultValue`/`scopes` -- a pure rename can never
 * trigger `RENAME_RETYPE_CONFLICT` by construction; that guard lives in
 * `retypeDefinition` (ADR-028 §3's "no rename+retype in one op").
 */
export async function renameDefinition(
  required: RenameDefinitionRequired
): Promise<{ settingId: string; markerSettingId: string }> {
  const { deps, input } = required;
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, "rename");

  if (input.namespace === input.newNamespace && input.key === input.newKey) {
    throw new DefinitionInvalidError("rename requires newNamespace/newKey to differ from the current name");
  }

  const destination = await deps.repo.findActiveDefinition({
    namespace: input.newNamespace,
    key: input.newKey,
    workspaceId: input.workspaceId,
  });
  if (destination) {
    if (destination.status === "alias") {
      throw new AliasDepthExceededError(
        `rename target '${input.newNamespace}.${input.newKey}' resolves to an existing alias marker; a marker's alias_of must point to an active definition (depth <=1)`
      );
    }
    throw new DefinitionInvalidError(
      `rename target '${input.newNamespace}.${input.newKey}' is already in use`
    );
  }

  const result = await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();

    // Step 1: move the active row to the new name -- same setting_id, same version.
    await deps.repo.saveDefinition({ ...current, namespace: input.newNamespace, key: input.newKey, updatedAt: now });

    // Sequential rename: retarget every prior marker pointing at the OLD name to the NEW name.
    const siblings = await deps.repo.listActiveDefinitions({ workspaceId: input.workspaceId });
    for (const sibling of siblings) {
      if (
        sibling.status === "alias" &&
        sibling.aliasOfNamespace === input.namespace &&
        sibling.aliasOfKey === input.key
      ) {
        await deps.repo.saveDefinition({
          ...sibling,
          aliasOfNamespace: input.newNamespace,
          aliasOfKey: input.newKey,
          updatedAt: now,
        });
      }
    }

    // Step 2: insert a fresh v1 alias marker at the OLD name pointing at the NEW name.
    const markerSettingId = deps.ids.newId();
    await deps.repo.saveDefinition({
      settingId: markerSettingId,
      version: 1,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      key: input.key,
      ownerKind: current.ownerKind,
      ownerId: current.ownerId,
      schema: current.schema,
      defaultValue: current.defaultValue,
      scopes: current.scopes,
      secret: current.secret,
      status: "alias",
      aliasOfNamespace: input.newNamespace,
      aliasOfKey: input.newKey,
      coercionTag: null,
      createdAt: now,
      updatedAt: now,
    });

    await deps.repo.appendRevision({
      entityKind: "definition",
      settingId: current.settingId,
      scope: null,
      workspaceId: input.workspaceId,
      principalId: null,
      op: "alias",
      beforeJson: null,
      afterJson: null,
      defVersion: current.version,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });

    return { settingId: current.settingId, markerSettingId };
  });

  // Both the old (alias-marker) namespace and the new (active-row) namespace
  // need a fresh definition-cache read after a rename.
  invalidateDefinitionNamespaceCache(deps.repo, input.namespace);
  invalidateDefinitionNamespaceCache(deps.repo, input.newNamespace);
  return result;
}

export interface RetypeDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    schema: SettingValueSchema;
    defaultValue: JsonValue | null;
    /** A total coercer id/tag (EC-08 registry in `settings.ts`) for reading values recorded under any prior version. */
    coercionTag: string;
    /**
     * Present only to detect a combined rename+retype request (ADR-028 §3);
     * retype never actually moves `(namespace,key)` -- if provided and it
     * differs from the current name while `schema` also differs, the whole
     * op is rejected `RENAME_RETYPE_CONFLICT` rather than silently doing
     * only the schema half.
     */
    newNamespace?: string | undefined;
    newKey?: string | undefined;
    callerPrincipalId: UUID;
    authWorkspaceId: UUID;
  };
}

/**
 * ADR-028 §3 retype mechanism (AC-10, EC-05): a same-tx pair --
 * (1) UPDATE the prior active version's `status` to `deprecated` FIRST (else
 * the insert in step 2 collides with the one-active-row-per-slot
 * invariant); (2) INSERT the new `version+1` row as `active`, same
 * `setting_id`/`namespace`/`key`. Rejected unless every prior version
 * (2..N) already carries a total coercer -- `coercionTag` is `null` only for
 * version 1 by construction (`types.ts`), so this walks 2..N and requires
 * each to be non-null.
 */
export async function retypeDefinition(
  required: RetypeDefinitionRequired
): Promise<{ settingId: string; version: number }> {
  const { deps, input } = required;
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, "retype");

  const namespaceOrKeyChanged =
    (input.newNamespace !== undefined && input.newNamespace !== current.namespace) ||
    (input.newKey !== undefined && input.newKey !== current.key);
  const schemaChanged = JSON.stringify(input.schema) !== JSON.stringify(current.schema);
  if (namespaceOrKeyChanged && schemaChanged) {
    throw new RenameRetypeConflictError(
      `cannot rename and retype '${input.namespace}.${input.key}' in the same operation (ADR-028 §3); submit the rename and the retype as two separate chokepoint calls`
    );
  }

  for (let version = 2; version <= current.version; version++) {
    const priorVersion = await deps.repo.findDefinitionBySettingId({ settingId: current.settingId, version });
    if (!priorVersion || priorVersion.coercionTag == null) {
      throw new DefinitionInvalidError(
        `retype of '${input.namespace}.${input.key}' rejected: version ${version} does not carry a total coercer (ADR-028 §3)`
      );
    }
  }

  const result = await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();
    const newVersion = current.version + 1;

    // Step 1: deprecate the prior active version first.
    await deps.repo.saveDefinition({ ...current, status: "deprecated", updatedAt: now });

    // Step 2: insert the new version as active -- same setting_id/namespace/key.
    await deps.repo.saveDefinition({
      settingId: current.settingId,
      version: newVersion,
      workspaceId: current.workspaceId,
      namespace: current.namespace,
      key: current.key,
      ownerKind: current.ownerKind,
      ownerId: current.ownerId,
      schema: input.schema,
      defaultValue: input.defaultValue,
      scopes: current.scopes,
      secret: current.secret,
      status: "active",
      aliasOfNamespace: null,
      aliasOfKey: null,
      coercionTag: input.coercionTag,
      createdAt: now,
      updatedAt: now,
    });

    await deps.repo.appendRevision({
      entityKind: "definition",
      settingId: current.settingId,
      scope: null,
      workspaceId: current.workspaceId,
      principalId: null,
      op: "retype",
      beforeJson: null,
      afterJson: null,
      defVersion: newVersion,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });

    return { settingId: current.settingId, version: newVersion };
  });

  invalidateDefinitionNamespaceCache(deps.repo, input.namespace);
  return result;
}

export interface ReconcileDefinitionDefaultRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    /** The default the SOURCE declares. Wins over a differing stored default. */
    defaultValue: JsonValue;
    callerPrincipalId: UUID;
    authWorkspaceId: UUID;
  };
}

/**
 * Reconciles a stored `default_json` that has drifted from the default its
 * source declares. Idempotent and a no-op when they already agree.
 *
 * Why this exists — the bug it closes:
 * `ensure-definitions.ts` registers each definition once and then skips it
 * forever (`if (existing) continue;`). That makes a changed `defaultValue` in
 * SOURCE unreachable in any install that has already booted, for every
 * settings-dialog tab a host registers this way. It can surface as a stored
 * default staying "system" in the database while source says "light",
 * rendering a settings panel with the wrong initial state — a visibly wrong
 * value produced by entirely correct-looking source. The next occurrence
 * could be a silently wrong default with no visual tell at all.
 *
 * Why `core`-only:
 * `ownerKind` already encodes who owns a definition. `core` definitions
 * configure a platform capability and are code-owned, so code is the authority
 * on their default and may overwrite a drifted stored one. `site` and `theme`
 * definitions are operator-owned — silently overwriting those would destroy a
 * deliberate choice, so they are rejected rather than reconciled.
 *
 * Why this is NOT a `retype` (ADR-028 §3):
 * `retype` deprecates the active row and inserts `version+1` because a changed
 * SCHEMA means every stored value needs a total coercer. A changed DEFAULT
 * needs none — the schema is untouched, so every stored value stays valid and
 * only the resolution of UNSET values moves. The row is therefore updated in
 * place at the same version, and the paired revision carries the old and new
 * default in `beforeJson`/`afterJson` so the change is auditable.
 *
 * @complexity O(1) — one definition lookup plus at most one row update and one
 * revision append, in a single transaction.
 */
export async function reconcileDefinitionDefault(
  required: ReconcileDefinitionDefaultRequired
): Promise<{ settingId: string; changed: boolean }> {
  const { deps, input } = required;
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, "reconcile the default of");

  if (current.ownerKind !== "core") {
    throw new DefinitionInvalidError(
      `cannot reconcile the default of '${input.namespace}.${input.key}': only 'core' definitions are code-owned, and this one is '${current.ownerKind}' (operator-owned)`
    );
  }

  // Structural compare — `defaultValue` is a `JsonValue`, so `===` would miss a
  // changed object/array default.
  if (JSON.stringify(current.defaultValue) === JSON.stringify(input.defaultValue)) {
    return { settingId: current.settingId, changed: false };
  }

  if (!validateValueAgainstSchema(current.schema, input.defaultValue)) {
    throw new ValueValidationFailedError(
      `cannot reconcile the default of '${input.namespace}.${input.key}': the source default does not satisfy the definition's own schema (type '${current.schema.type}')`
    );
  }

  await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();

    await deps.repo.saveDefinition({ ...current, defaultValue: input.defaultValue, updatedAt: now });

    await deps.repo.appendRevision({
      entityKind: "definition",
      settingId: current.settingId,
      scope: null,
      workspaceId: current.workspaceId,
      principalId: null,
      op: "redefault",
      beforeJson: current.defaultValue,
      afterJson: input.defaultValue,
      // Unchanged, deliberately — see the retype contrast above.
      defVersion: current.version,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });
  });

  invalidateDefinitionNamespaceCache(deps.repo, input.namespace);
  return { settingId: current.settingId, changed: true };
}

export interface DeprecateDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    callerPrincipalId: UUID;
    authWorkspaceId: UUID;
  };
}

export interface TombstoneDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    callerPrincipalId: UUID;
    authWorkspaceId: UUID;
  };
}

/**
 * ADR-042 item 2: `deprecateDefinition`/`tombstoneDefinition` were a jaccard-1.0
 * duplicate pair (same authorize -> resolve -> same-tx status flip + revision
 * shape, differing only in the target status string). This is that shape,
 * written once; both thin exports below just name their target status.
 */
async function transitionDefinitionStatus(
  deps: SettingsWriteServiceDeps,
  input: { namespace: string; key: string; workspaceId: UUID | null; callerPrincipalId: UUID; authWorkspaceId: UUID },
  target: { status: "deprecated" | "tombstone"; revisionOp: "deprecate" | "tombstone" }
): Promise<{ settingId: string; version: number }> {
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, target.revisionOp);

  const result = await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();
    await deps.repo.saveDefinition({ ...current, status: target.status, updatedAt: now });
    await deps.repo.appendRevision({
      entityKind: "definition",
      settingId: current.settingId,
      scope: null,
      workspaceId: current.workspaceId,
      principalId: null,
      op: target.revisionOp,
      beforeJson: null,
      afterJson: null,
      defVersion: current.version,
      actor: input.callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });
    return { settingId: current.settingId, version: current.version };
  });

  invalidateDefinitionNamespaceCache(deps.repo, input.namespace);
  return result;
}

/** Flips the active definition's status to `deprecated`, ledgered `op='deprecate'` -- same-tx, chokepoint-gated. */
export async function deprecateDefinition(
  required: DeprecateDefinitionRequired
): Promise<{ settingId: string; version: number }> {
  return transitionDefinitionStatus(required.deps, required.input, {
    status: "deprecated",
    revisionOp: "deprecate",
  });
}

/** Flips the active definition's status to `tombstone` (kills a core key), ledgered `op='tombstone'` -- same-tx, chokepoint-gated. */
export async function tombstoneDefinition(
  required: TombstoneDefinitionRequired
): Promise<{ settingId: string; version: number }> {
  return transitionDefinitionStatus(required.deps, required.input, {
    status: "tombstone",
    revisionOp: "tombstone",
  });
}
