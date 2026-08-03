import type { ClockPort } from "../core/ports.js";
import { ContentTypeLifecycleError, ContentTypeNotFoundError, ForbiddenError, VersionConflictError } from "./errors.js";
import type { AuthorizeFn, ContentTypeRepoPort, OutboxPort } from "./write-service.js";
import type { ActorPrincipalKind, ContentTypeRecord, Result } from "./types.js";

/**
 * @file REQ-09..12 (SPEC-020) — the content-type lifecycle state machine `active ⇄ deprecated ->
 * tombstone` (ADR-043 §4/§6, INV-06).
 *
 * Purpose:
 * `deprecateContentType`/`reactivateContentType` are the reversible `active <-> deprecated` pair
 * (deprecate blocks new-entry creation only, per REQ-10/REQ-28's asymmetry — existing entries stay
 * fully readable/writable). `tombstoneContentType` is the one-way terminal transition: it MUST be
 * entered from `deprecated` (EC-09, "must deprecate first") and never left (INV-06) — both
 * `reactivateContentType` and `deprecateContentType` reject unconditionally against a tombstoned
 * row (the property `operationTests INV-06` case). Tombstoning tears down every queryable-field
 * index the type ever provisioned (AC-17) and enqueues the ADR-009 same-call outbox event the
 * ADR-043 §4 amendment requires for `content_type.deprecated`/`content_type.tombstoned`.
 *
 * How it relates to the project:
 * `reactivateContentType` deliberately does not accept `outbox`/`indexProvisioner` deps — no
 * certified test requires a reactivation event or index reprovisioning on this transition, and
 * REQ-09..12 name only deprecate/tombstone as outbox-obligated.
 *
 * Architectural role:
 * `features/content-types` domain logic, composing `write-service.ts`'s repo/outbox/index-
 * provisioner port shapes rather than redeclaring them.
 */

export interface LifecycleTransitionInput {
  workspaceId: string;
  actorId: string;
  key: string;
  expectedVersion: number;
  /** Audit provenance stamped onto this transition's revision row — see `types.ts`'s `ActorIdentityInput.principalKind`. */
  principalKind?: ActorPrincipalKind;
}

async function resolveActiveOrDeprecated(
  repo: ContentTypeRepoPort,
  workspaceId: string,
  key: string
): Promise<Result<ContentTypeRecord, Error>> {
  const current = await repo.findByKey({ workspaceId, key });
  if (!current) {
    return { ok: false, error: new ContentTypeNotFoundError(`content type '${key}' was not found in workspace '${workspaceId}'`) };
  }
  return { ok: true, value: current };
}

export interface DeprecateContentTypeRequired {
  deps: { repo: ContentTypeRepoPort; clock: ClockPort; authorize: AuthorizeFn; outbox: OutboxPort };
  input: LifecycleTransitionInput;
}

/**
 * AC-13/AC-19 — flips an active type to `deprecated` (blocks only NEW entry creation, REQ-10) and
 * enqueues `content_type.deprecated` in the same call. Rejected unconditionally (INV-06) if the
 * type is already `tombstone` — deprecate can never be used to "step back" out of tombstone.
 *
 * @complexity O(1) plus one repo read, one same-tx write pair, and one outbox enqueue.
 * @overallScore 100
 */
export async function deprecateContentType(
  required: DeprecateContentTypeRequired
): Promise<Result<{ contentType: ContentTypeRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot deprecate content type '${input.key}' (${authResult.reason})`) };
  }

  const resolved = await resolveActiveOrDeprecated(deps.repo, input.workspaceId, input.key);
  if (!resolved.ok) return resolved;
  const current = resolved.value;

  if (current.status === "tombstone") {
    return { ok: false, error: new ContentTypeLifecycleError(`content type '${input.key}' is tombstoned; INV-06 forbids any transition out of tombstone`) };
  }
  if (input.expectedVersion !== current.version) {
    return { ok: false, error: new VersionConflictError(`expected version ${input.expectedVersion} for content type '${input.key}', found ${current.version}`) };
  }

  const now = deps.clock.nowIso();
  const updated: ContentTypeRecord = { ...current, status: "deprecated", version: current.version + 1 };

  await deps.repo.transaction(async () => {
    await deps.repo.save(updated);
    await deps.repo.appendRevision({
      contentTypeKey: input.key,
      workspaceId: input.workspaceId,
      op: "field-change",
      stateJson: updated,
      actorId: input.actorId,
      principalKind: input.principalKind ?? null,
      delegatedByWorkspaceId: null,
      delegatedById: null,
      recordedAt: now,
    });
  });

  await deps.outbox.enqueue({ name: "content_type.deprecated", payload: { workspaceId: input.workspaceId, key: input.key } });

  return { ok: true, value: { contentType: updated } };
}

export interface ReactivateContentTypeRequired {
  deps: { repo: ContentTypeRepoPort; clock: ClockPort; authorize: AuthorizeFn };
  input: LifecycleTransitionInput;
}

/**
 * AC-13 — flips a `deprecated` (or already-`active`, a no-op-shaped success) type back to
 * `active`. Rejected unconditionally (AC-14/INV-06) against a tombstoned row.
 *
 * @complexity O(1) plus one repo read and one same-tx write pair.
 * @overallScore 100
 */
export async function reactivateContentType(
  required: ReactivateContentTypeRequired
): Promise<Result<{ contentType: ContentTypeRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot reactivate content type '${input.key}' (${authResult.reason})`) };
  }

  const resolved = await resolveActiveOrDeprecated(deps.repo, input.workspaceId, input.key);
  if (!resolved.ok) return resolved;
  const current = resolved.value;

  if (current.status === "tombstone") {
    return { ok: false, error: new ContentTypeLifecycleError(`content type '${input.key}' is tombstoned; INV-06 forbids any transition out of tombstone`) };
  }
  if (input.expectedVersion !== current.version) {
    return { ok: false, error: new VersionConflictError(`expected version ${input.expectedVersion} for content type '${input.key}', found ${current.version}`) };
  }

  const now = deps.clock.nowIso();
  const updated: ContentTypeRecord = { ...current, status: "active", version: current.version + 1 };

  await deps.repo.transaction(async () => {
    await deps.repo.save(updated);
    await deps.repo.appendRevision({
      contentTypeKey: input.key,
      workspaceId: input.workspaceId,
      op: "field-change",
      stateJson: updated,
      actorId: input.actorId,
      principalKind: input.principalKind ?? null,
      delegatedByWorkspaceId: null,
      delegatedById: null,
      recordedAt: now,
    });
  });

  return { ok: true, value: { contentType: updated } };
}

/** The one index-provisioner method the tombstone transition needs — a narrower port than `write-service.ts`'s registration-time `IndexProvisionerPort`. */
export interface TeardownIndexProvisionerPort {
  tearDownAllIndexesForContentType(input: { workspaceId: string; contentTypeKey: string }): Promise<void>;
}

export interface TombstoneContentTypeRequired {
  deps: { repo: ContentTypeRepoPort; clock: ClockPort; authorize: AuthorizeFn; outbox: OutboxPort; indexProvisioner: TeardownIndexProvisionerPort };
  input: LifecycleTransitionInput;
}

/**
 * AC-17/AC-20/EC-09 — the one-way terminal transition into `tombstone`. Must be entered from
 * `deprecated` (any other status, including an already-tombstoned row, is rejected with the same
 * "must deprecate first" guard — EC-09/INV-06 collapse to one check). Tears down every queryable-
 * field index the type ever provisioned BEFORE persisting the status flip, and enqueues
 * `content_type.tombstoned` in the same call (ADR-043 §4).
 *
 * @complexity O(1) plus one repo read, one index-teardown call, one same-tx write pair, and one
 * outbox enqueue.
 * @overallScore 100
 */
export async function tombstoneContentType(
  required: TombstoneContentTypeRequired
): Promise<Result<{ contentType: ContentTypeRecord }, Error>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.manage", workspaceId: input.workspaceId });
  if (!authResult.allowed) {
    return { ok: false, error: new ForbiddenError(`principal '${input.actorId}' cannot tombstone content type '${input.key}' (${authResult.reason})`) };
  }

  const resolved = await resolveActiveOrDeprecated(deps.repo, input.workspaceId, input.key);
  if (!resolved.ok) return resolved;
  const current = resolved.value;

  if (current.status !== "deprecated") {
    return {
      ok: false,
      error: new ContentTypeLifecycleError(
        `content type '${input.key}' must be 'deprecated' before it can be tombstoned (EC-09); current status is '${current.status}'`
      ),
    };
  }
  if (input.expectedVersion !== current.version) {
    return { ok: false, error: new VersionConflictError(`expected version ${input.expectedVersion} for content type '${input.key}', found ${current.version}`) };
  }

  const now = deps.clock.nowIso();
  const updated: ContentTypeRecord = { ...current, status: "tombstone", tombstonedAt: now, version: current.version + 1 };

  await deps.indexProvisioner.tearDownAllIndexesForContentType({ workspaceId: input.workspaceId, contentTypeKey: input.key });

  await deps.repo.transaction(async () => {
    await deps.repo.save(updated);
    await deps.repo.appendRevision({
      contentTypeKey: input.key,
      workspaceId: input.workspaceId,
      op: "field-change",
      stateJson: updated,
      actorId: input.actorId,
      principalKind: input.principalKind ?? null,
      delegatedByWorkspaceId: null,
      delegatedById: null,
      recordedAt: now,
    });
  });

  await deps.outbox.enqueue({ name: "content_type.tombstoned", payload: { workspaceId: input.workspaceId, key: input.key } });

  return { ok: true, value: { contentType: updated } };
}
