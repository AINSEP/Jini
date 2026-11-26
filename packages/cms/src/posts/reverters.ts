import { nowIso as clockNowIso, type Clock as ClockPort, type JsonObject } from "@jini-ai/core/primitives";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { emitPublicTransitionEvent } from "@jini-ai/cms/posts/post-write-effects";
import { createRevertRegistry } from "@jini-ai/cms/core/commands";
import type { EntityReverter, RevertRegistry } from "@jini-ai/core/contracts/site/core-commands";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { PostVersionConflictError, SYSTEM_ACTOR_ID, type PostRecord, type PostRepoPort } from "@jini-ai/cms/posts/post";
import { presentScheduleFields } from "@jini-ai/cms/posts/post-write-fields";
import type { ForgetRemovedPostFn } from "../widgets/host-ports.js";
import type { PostStatus } from "@jini-ai/cms/core";

/**
 * @file Post-domain entity reverters (ADR-018 C-005/C-006).
 *
 * Purpose:
 * The concrete `post/update` and `post/delete` inverse appliers Jini `cms/core/commands/revert.ts`'s
 * generic `RevertRegistry` dispatches to. Adapter code, not core: they need `PostRecord`/
 * `PostStatus`/`classifyStatusTransition` — real domain knowledge that belongs to this feature
 * module. Moved out of `core/commands/appliers.ts` (2026-08-13 features-post-deep-import-trace.md
 * Job 2) — see that file's header for why the split is correct and cost nothing observable.
 *
 * v1 scope: `post/update` and `post/delete` are the only two registered. A `presentation-settings`
 * reverter (reading the pre-edit value via `getEffective('core.presentation.activeThemeId', …)`)
 * was previously forward-reserved for here but never built — `features/presentation/` has no
 * reverter and no `version` field on its record (verified directly), so there was nothing to keep;
 * a future one belongs in `features/presentation/reverters.ts` alongside these, not folded into
 * `PostReverterDeps`.
 */

/** Adapters the post reverters need to read/restore a post. */
export interface PostReverterDeps {
  postRepo: PostRepoPort;
  clock: ClockPort;
  /** SPEC-008 (ADR-PIPE-008 Decision §5) — `updatePost` now requires an `outbox` in its own deps. */
  outbox: OutboxPort;
  /**
   * Needed by `post/delete`'s reverter and required for both, for the same reason
   * `restorePostForward`'s is required: reverting a delete clears the marker `deletePost` wrote,
   * and the index row written alongside that marker has to go with it or the Trash screen offers a
   * permanent delete for a post that is live again. See {@link ForgetRemovedPostFn}.
   */
  forgetRemoved: ForgetRemovedPostFn;
}

/**
 * `EntityReverter.currentActor` for both post reverters (Task 14b, 2026-09-18) — the raw
 * `actorId` that produced the post's CURRENT revision, read off the same `post_revisions` ledger
 * `d90c1174f` already stamps at every write call site. `.find` (not the last array element) so
 * this stays correct regardless of `listRevisions`' documented ascending-`seq` order: matching on
 * `seq === current` is the one predicate that is order-independent by construction. Shared by both
 * reverters rather than duplicated — same post repo, same lookup, same "no revisions yet" fallback.
 *
 * Returns `null` (never throws) when no revision matches, or the post predates this ledger
 * (`listRevisions` returns `[]` for it) — `revert.ts` already treats a `null` `currentActor`
 * resolution as "unknown, omit the actor from the message", which is the correct fallback here:
 * a resolution gap should degrade the conflict message, not fail the revert outright.
 */
async function resolveCurrentActor(
  deps: PostReverterDeps,
  { workspaceId, entityId }: { workspaceId: string; entityId: string }
): Promise<string | null> {
  const post = await deps.postRepo.findById({ workspaceId, id: entityId });
  if (!post) return null;
  const revisions = await deps.postRepo.listRevisions({ workspaceId, postId: entityId });
  const matching = revisions.find((revision) => revision.seq === post.version);
  return matching ? matching.actorId : null;
}

/**
 * The one write both reverters make, inside their transaction. Conditional on the version the
 * pre-image was read against: an edit that lands between that read and this write owns the row,
 * so the revert loses with a typed conflict instead of overwriting it. The new version gets its
 * `post_revisions` row, so history shows the revert and {@link resolveCurrentActor} resolves it.
 * A reverter is given no principal, so the row is attributed to {@link SYSTEM_ACTOR_ID}.
 * @throws {PostVersionConflictError} when another write moved the row after `existing` was read.
 * @complexity O(1): one conditional write and one append; one read only when the write is refused.
 */
async function saveRevertedPost(
  { deps, existing, restored }: { deps: PostReverterDeps; existing: PostRecord; restored: PostRecord },
  _options: Record<string, never> = {}
): Promise<void> {
  const { applied } = await deps.postRepo.saveIfVersion({ record: restored, ifVersion: existing.version });
  if (!applied) {
    const current = await deps.postRepo.findById({ workspaceId: restored.workspaceId, id: restored.id });
    const currentVersion = current?.version ?? existing.version;
    throw new PostVersionConflictError({
      message: `post '${restored.id}' was modified while it was being reverted (expected version ${existing.version}, current version ${currentVersion})`,
      expectedVersion: existing.version,
      currentVersion,
    });
  }
  await deps.postRepo.appendRevision({
    postId: restored.id,
    workspaceId: restored.workspaceId,
    seq: restored.version,
    op: "restore",
    stateJson: restored,
    actorId: SYSTEM_ACTOR_ID,
    delegatedByWorkspaceId: null,
    delegatedById: null,
    recordedAt: restored.updatedAt,
  });
}

/**
 * The slug a delete revert puts back. `retire()`'s inverse also carries the holder's slug from
 * before the retire renamed it (`x` -> `x-replaced-<date>`): without it, a revert un-trashes the row
 * at the renamed address and `/x` stays dead. Restored only while no other row holds it (the
 * replacement may still be live there); otherwise, and for an ordinary delete's `{deletedAt}`-only
 * inverse, the current slug stays. `findBySlug` is trash-blind, so a trashed holder counts too.
 * @complexity O(1): at most one indexed slug read.
 */
async function restorableSlug(
  { deps, existing, priorSlug }: { deps: PostReverterDeps; existing: PostRecord; priorSlug: unknown },
  _options: Record<string, never> = {}
): Promise<string> {
  if (typeof priorSlug !== "string" || priorSlug.length === 0 || priorSlug === existing.slug) return existing.slug;
  const holder = await deps.postRepo.findBySlug({ workspaceId: existing.workspaceId, slug: priorSlug });
  return holder && holder.id !== existing.id ? existing.slug : priorSlug;
}

/** Fields introduced after the original inverse payload: absence keeps current values. */
function restoredPresentationFields(
  { inverse, currentPublishAt, currentFeatured }: {
    inverse: Pick<PostRecord, "publishAt" | "featuredMediaId" | "author" | "showAuthor" | "templateChoice">;
    currentPublishAt: PostRecord["publishAt"];
    currentFeatured: PostRecord["featuredMediaId"];
  },
  _options: Record<string, never> = {}
) {
  return {
    // Scheduled publishing / featured image (2026-10-05): restored from the pre-image when it
    // carries them; a pre-image recorded before these fields existed has no key at all, and
    // then the current values stay (there is nothing older to restore them to).
    ...presentScheduleFields({
      publishAt: inverse.publishAt === undefined ? currentPublishAt : inverse.publishAt,
      featuredMediaId: inverse.featuredMediaId === undefined ? currentFeatured : inverse.featuredMediaId,
    }),
    ...(inverse.author !== undefined ? { author: inverse.author } : {}),
    ...(inverse.showAuthor !== undefined ? { showAuthor: inverse.showAuthor } : {}),
    // Older pre-images omit this key; keep their current choice instead of clearing it.
    ...(inverse.templateChoice !== undefined ? { templateChoice: inverse.templateChoice } : {}),
  };
}

/**
 * Restores a post to the title/slug/bodyJson/status/ext captured before the edit.
 *
 * **SPEC-005 CIC U-005-B1 / SM2 transition (`ESCALATE_SECURITY`) — read before editing:** this
 * restore MUST write through the repo directly (`saveRevertedPost`) and MUST NEVER route through
 * `updatePost`/`createPost`. A revert re-applies a stored pre-image; it is not a genuine save, so
 * it must not fire `content.entry.beforeSave` (BR-08). Routing it through `updatePost` — which is
 * exactly what this reverter did before SPEC-005 T023 — would let a plugin that happens to be
 * enabled *now* stamp fresh `ext` onto a historical entry during someone else's undo, and would
 * make the restore depend on the contributing plugin still being installed, which AC-17 forbids.
 * Reverting is therefore a pure data write: `ext` is re-applied verbatim from the pre-image,
 * including the case where the pre-image has no `ext` at all (the reverted save was the one that
 * first created the namespace) — never merged with, or recomputed from, current state.
 *
 * `revert-plugin-ext.integration.test.ts` pins this via an observable side effect: `updatePost`
 * always calls `repo.findBySlug()` for its uniqueness check, and a correct revert never does.
 */
function createPostUpdateReverter(deps: PostReverterDeps): EntityReverter {
  return {
    async currentVersion({ workspaceId, entityId }) {
      const post = await deps.postRepo.findById({ workspaceId, id: entityId });
      return post ? post.version : null;
    },
    currentActor: (params) => resolveCurrentActor(deps, params),
    async applyInverse({ workspaceId, item }) {
      const inverse = item.inversePayload as
        | {
            title: string;
            slug: string;
            bodyJson: Record<string, unknown>;
            status: PostStatus;
            ext?: Record<string, unknown>;
            publishAt?: string | null;
            featuredMediaId?: string | null;
            author?: string | null;
            showAuthor?: boolean;
            templateChoice?: string | null;
          }
        | undefined;
      if (!inverse) {
        throw new Error("post reverter called without an inverse payload");
      }

      const existing = await deps.postRepo.findById({ workspaceId, id: item.entityId });
      if (!existing) {
        throw new Error(`post '${item.entityId}' was not found`);
      }

      // `ext` is destructured off the current record so the conditional spread below is the single
      // source of truth: a pre-image without `ext` restores to an entry without `ext` (AC-17).
      const { ext: _currentExt, publishAt: currentPublishAt, featuredMediaId: currentFeatured, ...carriedOver } = existing;
      const restored: PostRecord = {
        ...carriedOver,
        ...restoredPresentationFields({ inverse, currentPublishAt, currentFeatured }),
        title: inverse.title,
        slug: inverse.slug,
        bodyJson: inverse.bodyJson as JsonObject,
        status: inverse.status,
        // Bump version by 1 and refresh updatedAt — INV-04 (never restore the old number). This is
        // what `updatePost` used to do for us; it is reproduced here rather than delegated.
        updatedAt: clockNowIso({ clock: deps.clock }),
        version: existing.version + 1,
        ...(inverse.ext !== undefined && Object.keys(inverse.ext).length > 0
          ? { ext: inverse.ext as JsonObject }
          : {}),
      };

      await deps.postRepo.transaction({ fn: async () => {
        await saveRevertedPost({ deps, existing, restored });

        // Preserved from the previous `updatePost`-based implementation, deliberately: BR-08 forbids
        // re-firing the plugin hook, not the status-transition event. SEO's sitemap-cache
        // invalidation (SPEC-008 INV-010) subscribes to these, so dropping them would leave a stale
        // sitemap after a revert that publishes or unpublishes an entry. The shared schedule-aware
        // emitter (2026-10-21), not the stored `status`: restoring a still-scheduled pre-image is not
        // a publication yet (the go-live sweep announces it), and a pending go-live of `existing` is
        // announced before this save moves `updatedAt` past it. Same transaction as the save.
        await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing, next: restored, nowIso: restored.updatedAt });
      } });
    },
  };
}

/**
 * Restores a trashed post/page's soft-delete marker to what it was BEFORE the change set being
 * reverted — the concrete reason `deletePost` is a marker write rather than a `DELETE FROM` (see
 * `features/post/post.ts`'s `PostRecord.deletedAt`). A hard delete would leave this reverter with
 * nothing to restore.
 *
 * The inverse payload is `{ deletedAt }` (plus `slug` from `retire()`, see {@link restorableSlug}), deliberately: a soft-deleted row still
 * carries every field it had, so there is no other pre-image to re-apply — only a marker to write
 * back. Capturing a redundant copy of title/slug/bodyJson/status would create a second source of
 * truth that could disagree with the row itself.
 *
 * `deletedAt` is usually `null` (an ordinary delete's own inverse), which un-trashes the row exactly
 * as before. It is a timestamp only for `publish-content.ts`'s `retire()`, whose target can already
 * be trashed when the retire runs (`retirePostForReplacement` then only renames it, per that
 * function's own doc) — reverting THAT change set must put the row back exactly where it was: still
 * in the Trash, not live. When the payload's `deletedAt` is a timestamp AND the row is currently
 * trashed, this is that case: the row already IS where it belongs, so this returns without writing
 * anything and without forgetting the Trash index row a human's earlier, unrelated trash still owns.
 *
 * Writes through the repo directly (`saveRevertedPost`), never through `updatePost`, for the identical
 * SPEC-005 BR-08 reason spelled out on {@link createPostUpdateReverter}: an undo re-applies stored
 * state and must not fire `content.entry.beforeSave`. `updatePost` would also refuse outright — it
 * treats a trashed row as not-found.
 *
 * @complexity O(1) — one lookup plus at most one write.
 */
function createPostDeleteReverter(deps: PostReverterDeps): EntityReverter {
  return {
    async currentVersion({ workspaceId, entityId }) {
      // `findById` is trash-BLIND at the port layer (post.ts's PostRepoPort doc), which is exactly
      // what lets this read the version of the very row the revert guard needs to check.
      const post = await deps.postRepo.findById({ workspaceId, id: entityId });
      return post ? post.version : null;
    },
    currentActor: (params) => resolveCurrentActor(deps, params),
    async applyInverse({ workspaceId, item }) {
      const existing = await deps.postRepo.findById({ workspaceId, id: item.entityId });
      if (!existing) {
        throw new Error(`post '${item.entityId}' was not found`);
      }

      const inverse = item.inversePayload as { deletedAt?: unknown; slug?: unknown } | undefined;
      const priorDeletedAt = inverse?.deletedAt;

      // The holder was already trashed before the change set being reverted ran (`retire()`'s own
      // "already-trashed" inverse) — it is already exactly where a revert should put it. Restoring
      // `deletedAt: null` here would un-trash a row a human trashed independently, and calling
      // `forgetRemoved` below would delete THAT trash's index row out from under it.
      if (typeof priorDeletedAt === "string" && priorDeletedAt.length > 0 && isTrashed(existing)) {
        return;
      }

      const restored: PostRecord = {
        ...existing,
        deletedAt: null,
        slug: await restorableSlug({ deps, existing, priorSlug: inverse?.slug }),
        // Bump and refresh, never restore the old number — INV-04, same as postUpdateReverter.
        updatedAt: clockNowIso({ clock: deps.clock }),
        version: existing.version + 1,
      };

      await deps.postRepo.transaction({ fn: async () => {
        await saveRevertedPost({ deps, existing, restored });

        // Symmetric to the marker clear above, and conditional on the same thing `restorePostForward`
        // tests: only a row that WAS trashed has an index row to forget. A revert of a change set
        // whose delete some other path already undid must not delete an index row a later, unrelated
        // trash legitimately owns.
        if (isTrashed(existing)) {
          await deps.forgetRemoved({ workspaceId: restored.workspaceId, id: restored.id });
        }

        // Symmetric to `deletePost`'s own emission: trashing a published entry emitted
        // `entry.unpublished`, so restoring one must emit `entry.published` or SEO's sitemap cache
        // stays stale. A restored draft emits nothing, exactly as trashing one did. Through the
        // shared schedule-aware emitter (2026-10-21): a trashed row reads as not public, and a
        // restored row still scheduled stays not public until the go-live sweep announces it.
        await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing, next: restored, nowIso: restored.updatedAt });
      } });
    },
  };
}

/** Builds the `post/update` and `post/delete` reverters, closed over the given adapters. */
export function createPostReverters(deps: PostReverterDeps, _optional: Record<string, never> = {}): {
  update: EntityReverter;
  delete: EntityReverter;
} {
  return {
    update: createPostUpdateReverter(deps),
    delete: createPostDeleteReverter(deps),
  };
}

/**
 * Builds a `RevertRegistry` pre-loaded with the post-domain reverters — the composition-root
 * convenience `defaultRevertRegistry()` used to provide before the Job 2 inversion moved it here.
 */
export function createPostRevertRegistry(deps: PostReverterDeps, _optional: Record<string, never> = {}): RevertRegistry {
  const registry = createRevertRegistry({}, {});
  const reverters = createPostReverters(deps);
  registry.register("post", "update", reverters.update);
  registry.register("post", "delete", reverters.delete);
  return registry;
}
