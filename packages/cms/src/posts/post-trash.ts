import { type UUID, type Clock as ClockPort, nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { type PostRepoPort, type PostRecord, PostNotFoundError, SYSTEM_ACTOR_ID, PostConflictError } from "@jini-ai/cms/posts/post";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { appendPostRevision, emitPublicTransitionEvent, postEventActor } from "@jini-ai/cms/posts/post-write-effects";
import type { ForgetRemovedPostFn } from "../widgets/host-ports.js";

export type RemovePostFn = (required: {
  workspaceId: string; id: string; display: { title: string; subtitle?: string | null }; at: string;
  expectedVersion: number | null; actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;
import type { MutationActor } from "@jini-ai/core/contracts/events";

export interface DeletePostInput {
  /** The assistant's AI marker on the Trash row's `actor.pluginId` (2026-09-21, trash T4c) — unset
   *  by every non-assistant caller (the admin HTTP delete route), so a human's own delete stays
   *  human-only. See {@link RemovePostFn}'s `actor.pluginId`. */
  actorPluginId?: string | null;
  workspaceId: UUID;
  id: UUID;
  /** Same optional-with-fallback contract as {@link CreatePostInput.actorId}. */
  actorId?: UUID;
  /** See {@link CreatePostInput.actor}. */
  actor?: MutationActor | undefined;
  /** Same optional-with-null-default contract as {@link CreatePostInput.delegatedByWorkspaceId}. */
  delegatedByWorkspaceId?: UUID | null;
  /** See {@link CreatePostInput.delegatedByWorkspaceId}. */
  delegatedById?: UUID | null;
}

export interface DeletePostDeps {
  clock: ClockPort;
  repo: PostRepoPort;
  /**
   * Required for the same reason `updatePost`'s is (SPEC-008 ADR-PIPE-008 Decision §5): trashing a
   * PUBLISHED entry removes it from the public site, which is precisely the signal
   * `Jini/packages/cms/src/seo/sitemap.ts`'s cache invalidation subscribes to. See `deletePost`'s own doc for why
   * this reuses `classifyStatusTransition` rather than inventing an `entry.deleted` name.
   */
  outbox: OutboxPort;
  /** See {@link RemovePostFn}. Replaces this function's former direct `repo.softDelete` call. */
  remove: RemovePostFn;
}

export interface DeletePostRequired {
  deps: DeletePostDeps;
  input: DeletePostInput;
}

export interface DeletePostOptional {}

/**
 * Moves one post/page to the trash (soft delete) and returns the trashed record.
 *
 * Reversible by construction — see {@link PostRecord.deletedAt} for why this is a marker rather
 * than a `DELETE FROM`, and `core/commands/appliers.ts`'s `postDeleteReverter` for the restore that
 * marker makes possible.
 *
 * KIND-BLIND, deliberately, exactly like `updatePost`: `PostKind`'s own doc records that a page and
 * a post share one update contract, and `pages/update.ts` puts its kind guard in the ROUTE's
 * `captureInverse` rather than in the domain function. `pages/delete.ts` and the
 * `content_post_delete` tool mirror that placement rather than pushing a `kind` param down here,
 * so the guard stays where every other kind guard in this domain already lives.
 *
 * Trashing an already-trashed row is a `PostNotFoundError`, not a no-op: a trashed row is invisible
 * to every read in this file, so "delete something you cannot see" is a not-found, which also keeps
 * the second call from bumping the version and re-emitting the event.
 *
 * EVENT: emits `entry.unpublished` when a PUBLISHED row is trashed, and nothing when a draft is —
 * computed by handing `classifyStatusTransition` the transition a trash actually is (whatever the
 * row was, to no-longer-public). No new event name is invented: `entry.unpublished` is what SEO's
 * sitemap-cache invalidation already subscribes to (`apps/website/src/server/runtime/composition/app.ts`), and "this entry left the
 * public site" is exactly what happened.
 *
 * @complexity O(1) — one lookup plus one marker write.
 * @overallScore 100
 */
export async function deletePost(
  required: DeletePostRequired,
  _optional: DeletePostOptional = {}
): Promise<{ post: PostRecord; revisionId: string; previousRevisionId: string | null }> {
  const { deps, input } = required;
  // The channel vouches for the kind, the principal authorizes: an actor naming somebody else is refused before any write.
  postEventActor({ actorId: input.actorId, actor: input.actor });
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing || isTrashed(existing)) {
    throw new PostNotFoundError(`post '${input.id}' was not found`);
  }

  const now = clockNowIso({ clock: deps.clock });
  const version = existing.version + 1;
  const post: PostRecord = { ...existing, deletedAt: now, updatedAt: now, version };

  // The removal and its revision-ledger append are one atomic unit (see `PostRepoPort.transaction`'s
  // own doc) — a revision must never be recorded for a trash that didn't really land, and a trash
  // must never land unaccompanied by its revision. `deps.remove` joins this transaction rather than
  // opening its own, so the marker, the Trash index row and the revision are all-or-nothing.
  const { id: revisionId, previousId: previousRevisionId } = await deps.repo.transaction({ fn: async () => {
    const removed = await deps.remove({
      workspaceId: input.workspaceId,
      id: input.id,
      // From columns the `findById` above already returned — no second read, no payload parse.
      display: { title: existing.title, subtitle: existing.slug },
      at: now,
      expectedVersion: existing.version,
      actor: { principalId: input.actorId ?? SYSTEM_ACTOR_ID, pluginId: input.actorPluginId ?? null },
    });
    if (!removed.ok) {
      // `not-found` can only mean the row was removed between the read above and this write.
      if (removed.reason === "not-found") throw new PostNotFoundError(`post '${input.id}' was not found`);
      throw new PostConflictError(`post '${input.id}' changed while it was being deleted`);
    }
    const revision = await appendPostRevision({ repo: deps.repo, post, op: "delete", attribution: input });
    // Inside the transaction (2026-10-21): an enqueue failure rolls the trash back with it.
    await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing, next: post, nowIso: now, actorId: input.actorId, actor: input.actor });
    return revision;
  } });

  return { post, revisionId, previousRevisionId };
}


export interface RestorePostForwardRequired {
  deps: {
    repo: PostRepoPort;
    clock: ClockPort;
    outbox: OutboxPort;
    /**
     * REQUIRED, not optional, and required at EVERY call site including the ones that only ever
     * undo an update: an optional dependency is how a compensation ends up wired at three call
     * sites out of four. Whether it actually fires is decided here, from the two records, not by
     * the caller remembering which kind of write it is undoing.
     */
    forgetRemoved: ForgetRemovedPostFn;
  };
  input: {
    /** The exact pre-`execute` record, as the mutation's own `captureInverse` read it. */
    prior: PostRecord;
    actorId?: string;
    /** See {@link CreatePostInput.actor}. */
    actor?: MutationActor | undefined;
    delegatedByWorkspaceId?: UUID | null;
    delegatedById?: UUID | null;
  };
}

export interface RestorePostForwardOptional {}

/**
 * The compensating undo every `CommandMutation.rollback` over a post calls — one definition of
 * "put this post back" for the command gateway's unit-of-work guarantee (SPEC-001
 * REQ-01 / EC-08 / AC-17, INV-01: no mutation survives without a change-set record).
 *
 * Restores the prior state as a NEW version instead of rewriting the row in place, pairs that write
 * with its own `"restore"` revision inside one {@link PostRepoPort.transaction} — the same atomic
 * pairing `createPost`/`updatePost`/`deletePost` use — and then announces the status transition the
 * undo actually is, so a subscriber that already saw the undone write's event is told the truth
 * rather than left believing it.
 *
 * ## Deliberate deviation from `@jini-ai/cms` `core/commands/command.ts:77-86`
 *
 * That contract (line 81, the clause the 2026-09-20 peer review cites as `command.ts:82`) requires
 * `rollback` to restore "the entity to its exact pre-`execute` state (verbatim, **including
 * `version`**)". This function does not: the restored row carries
 * `current.version + 1`, so an undo moves the version FORWARD.
 *
 * Why this path departs from it: the forward write is not a row write. `updatePost`, `deletePost`
 * and `importPostEntity` each write the row and append an immutable `post_revisions` row as one
 * transaction, and {@link PostRepoPort.appendRevision} is append-only by contract — the revision
 * the undone write appended cannot be removed. A verbatim restore therefore puts `version` back
 * onto a `seq` that ghost revision already occupies, and `post_revisions` carries only
 * `idx_post_revisions_workspace_post` (`platform/db/schema.sqlite.ts`) — an INDEX, not a unique constraint
 * — so the next real write silently appends a SECOND row at that same `seq` rather than erroring.
 * The ledger would then record two different states under one sequence number with nothing to tell
 * a reader which one the row ever actually held. Restoring forward keeps every `seq` mapped to
 * exactly one state, and makes the undo a recorded event instead of an erasure.
 * (sol peer review 2026-09-20, High finding 3; recorded in
 * `ADS-memory/reports/2026-09-20-post-rollback-forward-restore.md`.)
 *
 * What would have to change to remove the deviation: the transactional path `command.ts:82-83`
 * already anticipates — "On the SQLite adapter (RT-004) a real transaction replaces this and `rollback`
 * becomes a no-op" — enrolling the feature write, its revision AND the change-set insert in ONE
 * transaction. With that in place nothing is ever appended that needs undoing, and this function
 * plus all of its call sites can be deleted outright rather than reconciled.
 *
 * Callers must pass the record their `captureInverse` captured, never a freshly re-read one: a
 * re-read row is the post-`execute` state, so restoring it restores nothing.
 *
 * ## Undoing a trash also forgets its index row
 *
 * `deletePost` writes the trash marker AND an index row through {@link DeletePostDeps.remove}, as
 * one transaction. Clearing the marker here without dropping that row leaves a live, published post
 * listed for permanent deletion by whatever screen reads the index — so when (and only when) the
 * write being undone was a trash, {@link ForgetRemovedPostFn} runs inside the same transaction as
 * the restore. This is a compensation rather than a prevention because the failure it answers is
 * the change-set insert failing AFTER the delete transaction committed; enrolling that insert in
 * the delete's transaction would remove the need for this function entirely (see the deviation note
 * above), and is the strictly better fix whenever the gateway gains a transactional path.
 *
 * @returns the restored record and its revision id, or `null` when there is nothing to compensate:
 * the row has since been removed, the write never landed (`current.version <= prior.version`), or
 * another writer moved the row on while this compensation was being assembled. Clobbering that
 * writer would itself be an unrecorded mutation — the exact failure INV-01 exists to prevent — so
 * this stands down instead of forcing the write.
 * @complexity O(r) over one post's revision ledger (a single `listRevisions` read, to name the
 * revision being restored from), plus one conditional row write, one append, and — only when the
 * undone write was a trash — one index-row delete. Failure path only.
 */
export async function restorePostForward(
  required: RestorePostForwardRequired,
  _optional: RestorePostForwardOptional = {}
): Promise<{ post: PostRecord; revisionId: string } | null> {
  const { deps, input } = required;
  // The channel vouches for the kind, the principal authorizes: an actor naming somebody else is refused before any write.
  postEventActor({ actorId: input.actorId, actor: input.actor });
  const { prior } = input;

  const current = await deps.repo.findById({ workspaceId: prior.workspaceId, id: prior.id });
  if (!current || current.version <= prior.version) return null;

  const restored: PostRecord = { ...prior, updatedAt: clockNowIso({ clock: deps.clock }), version: current.version + 1 };
  // The write being undone was a trash exactly when the row is trashed NOW and was not before.
  // Read from the two records rather than taken from the caller, so an update rollback cannot
  // forget an index row that a trash it knows nothing about legitimately owns.
  const undoesATrash = isTrashed(current) && !isTrashed(prior);

  // `restoredFrom` is what makes a `"restore"` row auditable — without it the ledger says an undo
  // happened but not back to what. The ledger reads oldest-first, so the state being restored is
  // the LAST row at the prior version (a pre-fix rollback may have left more than one there).
  const ledger = await deps.repo.listRevisions({ workspaceId: prior.workspaceId, postId: prior.id });
  const restoredFrom = [...ledger].reverse().find((row) => row.seq === prior.version)?.id ?? null;

  const revisionId = await deps.repo.transaction({ fn: async () => {
    // Conditional on the version this compensation was assembled against, not unconditional: a
    // writer that landed in between owns the row now, and overwriting it would replace one
    // unrecorded mutation with another.
    const { applied } = await deps.repo.saveIfVersion({ record: restored, ifVersion: current.version });
    if (!applied) return null;
    const appended = await appendPostRevision({ repo: deps.repo, post: restored, op: "restore", attribution: input }, { restoredFrom });
    // Inside the transaction, not after it: on SQLite both writes run on the one connection this
    // transaction already opened, so the marker and the index row move together or not at all. A
    // compensation that can itself half-fail is not a compensation.
    if (undoesATrash) await deps.forgetRemoved({ workspaceId: restored.workspaceId, id: restored.id });
    // Same transaction for the event (2026-10-21), for the same all-or-nothing reason.
    await emitPublicTransitionEvent({ outbox: deps.outbox, previous: current, next: restored, nowIso: restored.updatedAt, actorId: input.actorId, actor: input.actor });
    return appended.id;
  } });
  if (revisionId === null) return null;

  return { post: restored, revisionId };
}
