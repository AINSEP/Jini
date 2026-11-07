import { nowIso as readNowIso, type Clock as ClockPort, type IdGenerator as IdGeneratorPort, type UUID } from "@jini-ai/core/primitives";
import type { DomainEvent, OutboxPort, ChangeSetRecord, ChangeSetRepoPort, ChangeSetItemRecord } from "../index.js";
import type { RevertRegistry, EntityReverter } from "./appliers.js";

/**
 * @file Revert executor (ADR-018 C-004).
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
    /** Required to enforce the agent-cannot-force rule; harmless/unused when `force` is not set. */
    principalKind?: RevertPrincipalKind;
  };
}

export interface RevertChangeSetOptional {}

export async function revertChangeSet(
  required: RevertChangeSetRequired,
  _optional: RevertChangeSetOptional = {}
): Promise<ChangeSetRecord> {
  const { deps, input } = required;
  const { changeSets, registry } = deps;

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

  await requireRevertibleItems({ ordered, registry, input });

  // All preconditions passed — apply inverses in descending position (INV-05: all-or-nothing).
  for (const item of ordered) {
    const reverter = registry.resolve(item.entityType, item.operation)!;
    await reverter.applyInverse({
      workspaceId: input.workspaceId,
      item,
    });
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
    const event = {
      id: deps.idGen.newId(),
      name: "change-set.reverted",
      occurredAt: reverted.revertedAt!,
      aggregateId: reverted.id,
      workspaceId: reverted.workspaceId,
      actorId: reverted.actorId,
      changeSetId: reverted.id,
      payload: { changeSetId: reverted.id },
    } as DomainEvent<{ changeSetId: UUID }>;
    await deps.outbox.enqueue(event);
  }

  return reverted;
}

async function requireRevertibleItems(
  { ordered, registry, input }: { ordered: readonly ChangeSetItemRecord[]; registry: RevertRegistry; input: RevertChangeSetRequired["input"] },
  _optional: RevertChangeSetOptional = {},
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

  // (5) every item passes the version guard (strict equality; missing entity fails). `force`
  // bypasses ONLY a stale-version mismatch (`current !== null`) — a missing entity always throws,
  // regardless of `force` (see `RevertChangeSetRequired.input.force`'s doc comment).
  for (const item of ordered) {
    const reverter = registry.resolve(item.entityType, item.operation)!;
    await requireCurrentVersion({ item, reverter, input });
  }
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
