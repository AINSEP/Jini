import type { UUID } from "@jini-ai/core/primitives";
import { type PostRepoPort, type PostRecord, type PostRevisionOp, type PostRevisionAppendResult, SYSTEM_ACTOR_ID, PostVersionConflictError, PostNotFoundError } from "./post.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import type { PostStatus } from "../core/index.js";
import { isLiveAt } from "@jini-ai/core/contracts/site/scheduled-publish";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { announcePendingGoLive } from "../entries/go-live.js";

/** Who a revision is attributed to; an absent actor is {@link SYSTEM_ACTOR_ID}, absent delegation `null`. */
interface RevisionAttribution {
  actorId?: string;
  delegatedByWorkspaceId?: UUID | null;
  delegatedById?: UUID | null;
}

/**
 * Appends the revision for a record write just made — the one ledger call shape every write path
 * shares. `seq` and `recordedAt` come from the written record itself (see {@link PostRevisionInput}).
 * @complexity O(1) — one repo call.
 */
export function appendPostRevision(
  required: { repo: PostRepoPort; post: PostRecord; op: PostRevisionOp; attribution: RevisionAttribution },
  optional: { restoredFrom?: string | null } = {}
): Promise<PostRevisionAppendResult> {
  const { repo, post, op, attribution } = required;
  return repo.appendRevision({
    postId: post.id,
    workspaceId: post.workspaceId,
    seq: post.version,
    op,
    stateJson: post,
    actorId: attribution.actorId ?? SYSTEM_ACTOR_ID,
    delegatedByWorkspaceId: attribution.delegatedByWorkspaceId ?? null,
    delegatedById: attribution.delegatedById ?? null,
    ...optional,
    recordedAt: post.updatedAt,
  });
}

/**
 * Optimistic-concurrency compare-and-set for `updatePost` (2026-09-06).
 *
 * A no-op when the caller sent no `expectedVersion` — that is what keeps the guard opt-in and this
 * whole change non-breaking. See {@link UpdatePostInput.expectedVersion} for the contract.
 *
 * Called BEFORE field validation and the slug-uniqueness check, unlike every other precondition in
 * `updatePost`: once the caller's basis is stale, its title, slug and body all describe a row that
 * no longer exists as it was read, so reporting a field problem in content the caller is about to
 * have to re-enter anyway would answer the wrong question. Called AFTER the not-found check so a
 * missing or trashed row still reads as a plain 404, rather than disclosing through a version
 * number that the id exists.
 */
export function assertExpectedVersion({ existing, expectedVersion }: { existing: PostRecord; expectedVersion: number | undefined }, _optional: Record<string, never> = {}): void {
  if (expectedVersion === undefined) return;
  if (expectedVersion === existing.version) return;
  throw new PostVersionConflictError({
    message: versionConflictMessage({ id: existing.id, expectedVersion, currentVersion: existing.version }),
    expectedVersion,
    currentVersion: existing.version,
  });
}

/** One definition of the conflict wording, because the guard now reports from two places — the
 *  cheap up-front compare above and the authoritative post-write rejection in
 *  {@link persistUpdatedPost} — and a client that has to tell them apart has a worse bug than the
 *  one this guard closes. @complexity O(1). */
export function versionConflictMessage({ id, expectedVersion, currentVersion }: { id: UUID; expectedVersion: number; currentVersion: number }, _optional: Record<string, never> = {}): string {
  return `post '${id}' was modified by another save (expected version ${expectedVersion}, current version ${currentVersion})`;
}

/**
 * The "set" half of `updatePost`'s compare-and-set — the write itself, predicated on the same
 * version the caller's basis claimed.
 *
 * `assertExpectedVersion` above is now only a fast, well-worded rejection for a basis that was
 * ALREADY stale when the request arrived; it cannot speak for the state of the row two awaits later
 * (fable bugs audit C01). This is where the guarantee actually lives: the version predicate travels
 * into the UPDATE, so a row another writer won during the slug check or the plugin hook rejects
 * this write outright instead of absorbing it.
 *
 * Unversioned callers keep the pre-existing unconditional `save()` — `expectedVersion` is opt-in by
 * construction (see {@link UpdatePostInput.expectedVersion}) and this change does not move that
 * line. What it fixes is callers who DID opt in and were being told they were protected.
 *
 * The re-read on the rejection path is what lets the error name the real current version rather
 * than "some other version"; it runs only on the conflict path, never on the happy one. A row that
 * has vanished (or been trashed) since the compare reports as not-found — the same answer the
 * caller would have received had it arrived a moment later — rather than a conflict against a
 * version that no longer exists.
 *
 * @complexity O(1) queries: one conditional UPDATE, plus one read only when it is rejected.
 */
export async function persistUpdatedPost(
  { repo, post, expectedVersion }: { repo: PostRepoPort; post: PostRecord; expectedVersion: number | undefined },
  _optional: Record<string, never> = {}
): Promise<void> {
  if (expectedVersion === undefined) {
    await repo.save(post);
    return;
  }

  const { applied } = await repo.saveIfVersion({ record: post, ifVersion: expectedVersion });
  if (applied) return;

  const current = await repo.findById({ workspaceId: post.workspaceId, id: post.id });
  if (!current || isTrashed(current)) throw new PostNotFoundError(`post '${post.id}' was not found`);
  throw new PostVersionConflictError({
    message: versionConflictMessage({ id: post.id, expectedVersion, currentVersion: current.version }),
    expectedVersion,
    currentVersion: current.version,
  });
}

/** The status the public sees at `nowIso`: a trashed row is "not public" whatever its stored
 *  `status` still says, and so is a published row still SCHEDULED (`publishAt` ahead) — what
 *  `isLiveAt` already decides for every public read. Feeding this, not the stored `status`, to
 *  {@link classifyStatusTransition} is what keeps a scheduled save from emitting `entry.published`
 *  before go-live (2026-10-21); `go-live.ts` announces it when it does go live. @complexity O(1). */
function publicFacingStatus(required: { post: PostRecord; nowIso: string }): PostStatus {
  return isLiveAt({ record: required.post, nowIso: required.nowIso }) ? "published" : "draft";
}

/**
 * ADR-PIPE-008 Decision §5 / INV-010 — the 4-row status-transition table,
 * certified in isolation by `post.transition-events.test.ts` (T004) before
 * `updatePost` (above) or any SEO-side subscription depends on it. Returns
 * `null` for the "no event" row (not-published -> not-published).
 *
 * SIGNATURE-CONVENTION SKIP (deliberate, not an oversight): this function's sole call site is
 * inside `updatePost` above, which a concurrent, separately-dispatched fix owns for an unrelated
 * bug (shape-mismatch handling) — converting this signature would require editing that call site
 * too, creating exactly the merge collision both dispatches were told to avoid. Independent of that
 * scheduling constraint, this is also a legitimate exemption on the merits: both parameters are the
 * same primitive union type (`PostStatus`), the function is a pure comparator (no optional/defaulted
 * field exists to justify a second `options` parameter), and it has exactly one caller in the whole
 * repo. Left as two positional params.
 */
export function classifyStatusTransition(
  previousStatus: PostStatus,
  nextStatus: PostStatus
): "entry.published" | "entry.updated" | "entry.unpublished" | null {
  const wasPublished = previousStatus === "published";
  const isPublished = nextStatus === "published";

  if (!wasPublished && isPublished) return "entry.published";
  if (wasPublished && isPublished) return "entry.updated";
  if (wasPublished && !isPublished) return "entry.unpublished";
  return null;
}

/**
 * Every write path's event step: classifies `previous` -> `next` by what the public sees at
 * `nowIso` ({@link publicFacingStatus}); `previous` is `null` for a brand-new row (classified as
 * never-published). A `previous` row saved while scheduled that has gone live since
 * (`go-live.ts`'s `wentLiveSinceSave`) may not have been announced by the go-live sweep yet, and after this
 * write the sweep will no longer see it (its `updatedAt` passes `publishAt`), so its go-live event
 * is enqueued here first ({@link announcePendingGoLive}) — the same id the sweep uses, which the
 * outbox de-duplicates.
 *
 * Exported for `reverters.ts` (2026-10-21): an undo writes through `repo.save` directly (no
 * before-save hooks, BR-08) but its event must be the same schedule-aware one every save emits.
 * Call it inside the write's transaction, so the row and its events commit or roll back together.
 */
export async function emitPublicTransitionEvent(
  required: { outbox: OutboxPort; previous: PostRecord | null; next: PostRecord; nowIso: string; actorId?: string; source?: string },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { outbox, previous, next, nowIso } = required;
  if (previous) await announcePendingGoLive({ outbox, post: previous, nowIso });
  const previousStatus = previous ? publicFacingStatus({ post: previous, nowIso }) : "draft";
  await emitStatusTransitionEvent({ outbox, previousStatus, nextStatus: publicFacingStatus({ post: next, nowIso }), post: next }, { actorId: required.actorId, source: required.source });
}

/**
 * Shared status-transition-event emitter for `deletePost` and `updatePost` — computes the event
 * name via {@link classifyStatusTransition} and enqueues it only when one applies (the "no event"
 * row returns `null`, and this is then a no-op). `nextStatus` is a separate parameter from
 * `post.status` because `deletePost` needs to classify the transition as "moved to non-public"
 * (`"draft"`) without actually changing the trashed row's own stored `status` field.
 */
async function emitStatusTransitionEvent(
  { outbox, previousStatus, nextStatus, post }: { outbox: OutboxPort; previousStatus: PostStatus; nextStatus: PostStatus; post: PostRecord },
  analytics: { actorId?: string | undefined; source?: string | undefined } = {},
): Promise<void> {
  const transitionEventName = classifyStatusTransition(previousStatus, nextStatus);
  if (!transitionEventName) return;
  await outbox.enqueue({
    id: `${post.id}-${transitionEventName}-${post.version}`,
    name: transitionEventName,
    occurredAt: post.updatedAt,
    aggregateId: post.id,
    workspaceId: post.workspaceId,
    // Omitted, not undefined: analytics fields are never fabricated, and an in-memory outbox must
    // carry the same payload a persisted (JSON) one does.
    payload: { entryId: post.id, contentType: post.kind, ...Object.fromEntries(Object.entries(analytics).filter(([, value]) => value !== undefined)) },
  });
}

/** Enqueue only after a changed revision write, inside its transaction. No document text is copied.
 * @complexity O(1), one outbox insert. */
export async function enqueueContentWrite(
  { outbox, post, actorId, source, operation }: { outbox: OutboxPort; post: PostRecord; actorId?: string;
    source?: string; operation: "created" | "saved" },
  _optional: Record<string, never> = {},
): Promise<void> {
  await outbox.enqueue({ id: `${post.id}-content.${operation}-${post.version}`, name: `content.${operation}`,
    workspaceId: post.workspaceId, aggregateId: post.id, occurredAt: post.updatedAt,
    payload: { contentType: post.kind, entryId: post.id, actorId, source: source ?? "service", initialStatus: post.status },
  });
}
