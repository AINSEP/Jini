import { nowIso as readNowIso, type Clock as ClockPort, type IdGenerator as IdGeneratorPort, type UUID } from "@jini-ai/core/primitives";
import type {
  DomainEvent,
  OutboxPort,
  ChangeSetRecord,
  ChangeSetRepoPort,
  ChangeSetItemRecord,
  MutationActor,
} from "@jini-ai/core/contracts/events";
import type { RevertRegistry, EntityReverter } from "./appliers.js";

/**
 * @file Revert executor.
 *
 * Undoes an applied change set by walking its items in descending `position`
 * and applying each inverse through the inverse-applier registry, under a strict
 * version guard. Preconditions are evaluated in a fixed order (BR-05) and the
 * first failure decides the error — no entity write happens during evaluation,
 * so a failed revert never partially applies (INV-05).
 *
 * `force` lets an operator explicitly override a stale-version conflict after another author
 * saved the entity. It never overrides a
 * missing entity, and an agent principal may never set it, mirroring the
 * `contracts/core/gated-mutations/gateway.ts` `confirm()` actor-class rule.
 */

/**
 * The principal classes a revert call can be driven by — redeclared locally rather than imported
 * from `contracts/core/gated-mutations/ports.ts`'s own `PrincipalKind`, for the identical
 * decoupling reason that file's own doc comment gives for not importing `identity`'s: this file
 * (`contracts/core/commands`) and `core/gated-mutations` are sibling leaf packages under
 * `contracts/core`, and neither needs the other's internals to do its own job. `dependency-cruiser`
 * has no rule forbidding the edge (checked: `contracts-no-server-or-app-imports` only polices
 * `contracts/**` -> `server`/`apps`/features/`platform/db`), so this is a style choice, not a
 * boundary requirement — but it matches this codebase's own established precedent for exactly this
 * situation. Structurally identical to `@jini-ai/cms/identity`'s `PrincipalKind` (verified against
 * the installed package), which is what `getAuthedPrincipal(res).kind` actually returns.
 */
export type RevertPrincipalKind = "user" | "agent" | "api_key" | "system";

export class ChangeSetNotFoundError extends Error {}
export class ChangeSetInvalidStatusError extends Error {}
export class RevertNotPossibleError extends Error {}
/**
 * Thrown when an agent principal passes `force: true` (see `RevertChangeSetRequired.input.force`).
 * An agent may revert normally; it may never force past a version conflict, regardless of what
 * permission it otherwise holds — the same unconditional actor-class rule
 * `gated-mutations/gateway.ts`'s `confirm()` enforces for `kind === "agent"`.
 */
export class RevertForbiddenError extends Error {
  readonly reasonCode: string;
  constructor(message: string, reasonCode: string) {
    super(message);
    this.reasonCode = reasonCode;
  }
}
export class RevertConflictError extends Error {
  readonly entityType: string;
  readonly entityId: UUID;
  /** The entity's real current version, or `null` when it no longer exists. Lets a route build a
   *  structured `details` field (mirroring `versionConflictEnvelope`'s `{expectedVersion,
   *  currentVersion}` convention in `features/post/expected-version.ts`) instead of parsing
   *  `message`. */
  readonly currentVersion: number | null;
  /** The raw principal id that made the entity's current write, or `null` when it no longer exists
   *  or the registered reverter has no `currentActor`. */
  readonly currentActorId: string | null;
  constructor(
    message: string,
    entityType: string,
    entityId: UUID,
    currentVersion: number | null = null,
    currentActorId: string | null = null
  ) {
    super(message);
    this.entityType = entityType;
    this.entityId = entityId;
    this.currentVersion = currentVersion;
    this.currentActorId = currentActorId;
  }
}

export interface RevertChangeSetDeps {
  changeSets: ChangeSetRepoPort;
  registry: RevertRegistry;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  /** When provided, `change-set.reverted` is enqueued for async consumers. */
  outbox?: OutboxPort;
}

export interface RevertChangeSetRequired {
  deps: RevertChangeSetDeps;
  input: {
    workspaceId: UUID;
    changeSetId: UUID;
    /**
     * Operator override: bypass a stale-version conflict (case (2) below) and apply the inverse
     * anyway. Never bypasses a missing entity (case (1)) — there is nothing for `applyInverse` to
     * write onto, so "forcing" a resurrection isn't a meaningful operation. Omitted/`false` is the
     * default and reproduces the exact pre-existing strict behavior (no silent behavior change for
     * every existing caller that never sends this field).
     */
    force?: boolean;
    /** Required with `force` (a force without it is refused); unused when `force` is not set. */
    principalKind?: RevertPrincipalKind;
    /**
     * Who performs this revert, stamped on `change-set.reverted`. Required: the revert is a new
     * write, so it carries its own trusted attribution rather than the reverted set's author.
     * The execution channel supplies attribution, the principal ID still governs authorization,
     * and the two are not interchangeable.
     */
    actor: MutationActor;
  };
}

export interface RevertChangeSetOptional {
  /** The principal performing this revert; passed to each `applyInverse`, never the original writer. */
  actorId?: UUID;
  /**
   * Asks the caller's authorizer whether the current principal may undo one policy-bearing item
   * (see `EntityReverter.policy`). It receives only the scoped ids and the permission, never the
   * inverse payload, and throws to refuse. Required whenever any item's reverter declares a policy:
   * without it the revert fails closed, because a grant to revert an ordinary audited change must
   * not confer the stricter authority that kind's inverse needs.
   */
  authorizeItem?: (
    required: { permission: string; entityType: string; entityId: UUID },
    _optional?: Record<string, never>,
  ) => Promise<void>;
}

/** Plain words for an item whose undo needs a permission the caller could not show. */
const ITEM_PERMISSION_DENIED_MESSAGE = "You don't have permission to undo one of the changes in this set.";
/** Plain words for a force on a kind that never allows it. */
const ITEM_CANNOT_FORCE_MESSAGE =
  "This change can't be forced back over a newer version. Keep the newer version and edit it again instead.";

function revertedChangeSetEvent(deps: RevertChangeSetDeps, reverted: ChangeSetRecord, actor: MutationActor): DomainEvent<{ changeSetId: UUID }> {
  return {
    id: deps.idGen.newId(),
    name: "change-set.reverted",
    occurredAt: reverted.revertedAt!,
    aggregateId: reverted.id,
    workspaceId: reverted.workspaceId,
    // The reverting actor, not the reverted set's author: undoing someone's change is a new act.
    actorId: actor.id,
    actor: { id: actor.id, kind: actor.kind },
    changeSetId: reverted.id,
    payload: { changeSetId: reverted.id },
  } as DomainEvent<{ changeSetId: UUID }>;
}

export async function revertChangeSet(
  required: RevertChangeSetRequired,
  _optional: RevertChangeSetOptional = {}
): Promise<ChangeSetRecord> {
  const { deps, input } = required;
  const { changeSets, registry } = deps;

  requireForceAllowed({ input });

  // (1) exists in workspace
  const found = await changeSets.findById({
    workspaceId: input.workspaceId,
    id: input.changeSetId,
  });
  if (!found) {
    throw new ChangeSetNotFoundError(`change set '${input.changeSetId}' was not found`);
  }

  const { changeSet, items } = found;

  // (2) status is applied
  if (changeSet.status !== "applied") {
    throw new ChangeSetInvalidStatusError(
      `change set '${changeSet.id}' is '${changeSet.status}', only 'applied' can be reverted`
    );
  }

  const ordered = [...items].sort((a, b) => b.position - a.position);

  await requireRevertibleItems({ ordered, registry, input }, _optional);

  // All preconditions passed — apply inverses in descending position (INV-05: all-or-nothing).
  // The actor is whoever is reverting now, never the item's original writer.
  const inverseOptional = _optional.actorId === undefined ? {} : { actorId: _optional.actorId };
  for (const item of ordered) {
    const reverter = registry.resolve(item.entityType, item.operation)!;
    await reverter.applyInverse({
      workspaceId: input.workspaceId,
      item,
    }, inverseOptional);
  }

  // Compare-and-set: re-assert the change set is still 'applied' before flipping,
  // so a concurrent revert that already flipped it loses here (RT-003 / INV-006).
  const latest = await changeSets.findById({
    workspaceId: input.workspaceId,
    id: input.changeSetId,
  });
  if (!latest || latest.changeSet.status !== "applied") {
    throw new ChangeSetInvalidStatusError(
      `change set '${input.changeSetId}' was already reverted concurrently`
    );
  }

  const reverted: ChangeSetRecord = {
    ...latest.changeSet,
    status: "reverted",
    revertedAt: readNowIso({ clock: deps.clock }),
  };
  await changeSets.save(reverted);

  if (deps.outbox) {
    const event = revertedChangeSetEvent(deps, reverted, input.actor);
    await deps.outbox.enqueue(event);
  }

  return reverted;
}

/** Only a named, non-agent principal may force a revert past a version conflict. */
function requireForceAllowed(
  { input }: { input: RevertChangeSetRequired["input"] },
  _optional: RevertChangeSetOptional = {},
): void {
  // Agent-cannot-force — fires FIRST, unconditionally, before any repo read, mirroring
  // `gated-mutations/gateway.ts`'s `confirm()` `principalKind === "agent"` check firing regardless
  // of what the plan actually contains. There is nothing to "escalate" here: an agent that never
  // sets `force` is unaffected by this check and reverts exactly as before.
  if (input.force && input.principalKind === "agent") {
    throw new RevertForbiddenError(
      `agent principals may not force a revert past a version conflict`,
      "AGENT_CANNOT_FORCE"
    );
  }
  // Fail closed: a force that does not say who asked cannot be checked against the rule above.
  if (input.force && input.principalKind === undefined) {
    throw new RevertForbiddenError(
      `a forced revert must say who is asking; retry without force or sign in again`,
      "FORCE_NEEDS_PRINCIPAL_KIND"
    );
  }
}

async function requireRevertibleItems(
  { ordered, registry, input }: { ordered: readonly ChangeSetItemRecord[]; registry: RevertRegistry; input: RevertChangeSetRequired["input"] },
  optional: RevertChangeSetOptional = {},
): Promise<void> {
  // (3) every item has a registered reverter, (4) every item has a non-null inverse
  for (const item of ordered) {
    const reverter = registry.resolve(item.entityType, item.operation);
    if (!reverter) {
      throw new RevertNotPossibleError(
        `no inverse applier registered for '${item.entityType}/${item.operation}'`
      );
    }
    if (item.inversePayload === undefined) {
      throw new RevertNotPossibleError(
        `change-set item '${item.id}' has no inverse payload and cannot be reverted`
      );
    }
  }

  // (4b) every policy-bearing item is authorized — all of them, before the first version read or
  // inverse write, so a denial on any item leaves every entity untouched.
  await requireItemPolicies({ ordered, registry, input }, optional);

  // (5) every item passes the version guard (strict equality; missing entity fails). `force`
  // bypasses ONLY a stale-version mismatch (`current !== null`) — a missing entity always throws,
  // regardless of `force` (see `RevertChangeSetRequired.input.force`'s doc comment).
  for (const item of ordered) {
    const reverter = registry.resolve(item.entityType, item.operation)!;
    await requireCurrentVersion({ item, reverter, input });
  }
}

/**
 * Enforces each registered reverter's `policy`. The policy is read from the registry only — never
 * from client input or the stored inverse. Force and missing-authorizer refusals are checked for
 * every item first (no I/O), then each item's authorization is awaited in descending position.
 * @complexity O(n) in the item count plus one authorizer call per policy-bearing item.
 */
async function requireItemPolicies(
  { ordered, registry, input }: { ordered: readonly ChangeSetItemRecord[]; registry: RevertRegistry; input: RevertChangeSetRequired["input"] },
  optional: RevertChangeSetOptional = {},
): Promise<void> {
  const checks: Array<{ permission: string; entityType: string; entityId: UUID }> = [];
  for (const item of ordered) {
    const policy = registry.resolve(item.entityType, item.operation)!.policy;
    if (!policy) continue;
    if (input.force && policy.allowForce === false) {
      throw new RevertForbiddenError(ITEM_CANNOT_FORCE_MESSAGE, "ITEM_CANNOT_FORCE");
    }
    checks.push({ permission: policy.permission, entityType: policy.authorizationEntityType ?? item.entityType, entityId: item.entityId });
  }
  if (checks.length === 0) return;
  // Fail closed: a caller that cannot answer for an item does not get to undo it.
  const { authorizeItem } = optional;
  if (!authorizeItem) throw new RevertForbiddenError(ITEM_PERMISSION_DENIED_MESSAGE, "ITEM_PERMISSION_DENIED");
  for (const check of checks) await authorizeItem(check);
}

async function requireCurrentVersion(
  { item, reverter, input }: { item: ChangeSetItemRecord; reverter: EntityReverter; input: RevertChangeSetRequired["input"] },
  _optional: RevertChangeSetOptional = {},
): Promise<void> {
  const current = await reverter.currentVersion({
    workspaceId: input.workspaceId,
    entityId: item.entityId,
  });
  // operator override — case (2) only
  if (current !== null && (current === item.entityVersionAtApply || input.force)) return;

  const currentActorId =
    current !== null
      ? ((await reverter.currentActor?.({ workspaceId: input.workspaceId, entityId: item.entityId })) ?? null)
      : null;
  const actorSuffix = currentActorId ? `, last changed by principal '${currentActorId}'` : "";
  throw new RevertConflictError(
    `entity '${item.entityType}:${item.entityId}' changed since this change set (expected version ${item.entityVersionAtApply}, found ${current ?? "missing"}${actorSuffix})`,
    item.entityType,
    item.entityId,
    current,
    currentActorId
  );
}
