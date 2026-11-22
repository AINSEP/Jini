import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { JsonValue, UUID } from "../primitives/index.js";
import { DefinitionInvalidError, ValueValidationFailedError } from "./errors.js";
import { invalidateDefinitionNamespaceCache, validateValueAgainstSchema } from "./settings.js";
import { type SettingsWriteServiceDeps, authorizeDefinitionsManage, resolveActiveDefinitionOrThrow } from './write-service.js';
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
 * Why this is NOT a `retype`:
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

  if (!validateValueAgainstSchema({ schema: current.schema, value: input.defaultValue })) {
    throw new ValueValidationFailedError(
      `cannot reconcile the default of '${input.namespace}.${input.key}': the source default does not satisfy the definition's own schema (type '${current.schema.type}')`
    );
  }

  await deps.repo.transaction(async () => {
    const now = kernelNowIso({ clock: deps.clock });

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

  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.namespace });
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
 * `deprecateDefinition`/`tombstoneDefinition` were a jaccard-1.0
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
    const now = kernelNowIso({ clock: deps.clock });
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

  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.namespace });
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
