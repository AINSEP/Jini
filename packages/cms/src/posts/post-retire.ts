import { type UUID, type Clock as ClockPort, nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { type PostRepoPort, type PostRecord, PostNotFoundError, ROOT_SLUG, PostConflictError, PostVersionConflictError, SYSTEM_ACTOR_ID } from "@jini-ai/cms/posts/post";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import type { RemovePostFn } from "./post-trash.js";
import { versionConflictMessage, appendPostRevision, emitPublicTransitionEvent, persistUpdatedPost } from "@jini-ai/cms/posts/post-write-effects";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { releaseTrashedSlug } from "@jini-ai/cms/posts/post-slugs";

export interface RetirePostForReplacementInput {
  workspaceId: UUID;
  id: UUID;
  /**
   * The version this call believes `id` is at, the same optimistic-concurrency basis
   * {@link UpdatePostInput.expectedVersion} is — REQUIRED here (not opt-in) because the only caller
   * is a publish apply-loop re-planning against a holder it read moments earlier; there is no
   * unversioned caller to stay backward-compatible with, the way `updatePost`'s opt-in exists for.
   */
  expectedVersion: number;
  /**
   * `yyyymmdd`, e.g. `"20260924"` — supplied by the caller rather than derived from
   * `clockNowIso({ clock: deps.clock })`'s ISO format, so the renamed slug is a pure function of an explicit input
   * instead of this function parsing a timestamp string it does not otherwise need to understand.
   */
  today: string;
  actorId?: UUID;
  delegatedByWorkspaceId?: UUID | null;
  delegatedById?: UUID | null;
}

export interface RetirePostForReplacementDeps {
  repo: PostRepoPort;
  clock: ClockPort;
  outbox: OutboxPort;
  /** See {@link RemovePostFn}. Same trash primitive `deletePost` is handed. */
  remove: RemovePostFn;
}

export interface RetirePostForReplacementRequired {
  deps: RetirePostForReplacementDeps;
  input: RetirePostForReplacementInput;
}

export interface RetirePostForReplacementOptional {}

/**
 * Frees `id`'s current slug and moves the row to the Trash under a renamed slug
 * (`<slug>-replaced-<today>`, suffixed `-2`, `-3`, … on collision — the same disambiguation loop
 * `createPost`'s derived-slug path uses at `:1037-1043`), so a different row can take the address.
 *
 * This is publish's "overwrite on live, address clash" primitive (`publish-overwrite-live-plan
 * §4/§5 S3`): the live holder is RETIRED, not overwritten in place, because the incoming row is
 * created under its own (local) id afterward — see the plan's §1 for why in-place replacement is
 * wrong here (kind guard, header-nav id references, restore semantics).
 *
 * Two writes, one transaction: the row is saved under its new slug first (an `"update"` revision),
 * then handed to {@link RetirePostForReplacementDeps.remove} exactly as {@link deletePost} does (a
 * `"delete"` revision). If the holder is ALREADY trashed, it is only moved aside through
 * {@link releaseTrashedSlug} (`<slug>-trashed`, the same move any authoring write makes) — there is
 * nothing left to remove, and a second `"delete"` revision for a row that never left the Trash would
 * misrepresent the ledger. That move keeps the row's version and appends no revision (so
 * `revisionId` is `null`): the Trash index compares the version it recorded at trash time, and a
 * bump here once left the row in the Trash forever, neither restorable nor purgeable (2026-10-08).
 *
 * Refuses `ROOT_SLUG` (`/` has no other address to move to) and a stale `expectedVersion`
 * (`PostVersionConflictError`, the same guard {@link assertExpectedVersion} applies to `updatePost`)
 * — both checked before either write, so a refusal never leaves the row half-renamed.
 *
 * EVENT: emits `entry.unpublished` when a PUBLISHED row is retired, exactly like {@link deletePost}
 * — retiring removes the row from the public site precisely like trashing it does.
 *
 * @complexity O(s) for the slug-disambiguation loop (s = colliding renamed slugs, bounded in
 * practice by same-day retirements of the same address), O(1) otherwise.
 * @overallScore 100
 */
export async function retirePostForReplacement(
  required: RetirePostForReplacementRequired,
  _optional: RetirePostForReplacementOptional = {}
): Promise<{ post: PostRecord; revisionId: string | null; previousRevisionId: string | null }> {
  const { deps, input } = required;
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) {
    throw new PostNotFoundError(`post '${input.id}' was not found`);
  }
  if (existing.slug === ROOT_SLUG) {
    throw new PostConflictError("the home page cannot be replaced by publishing");
  }
  if (existing.version !== input.expectedVersion) {
    throw new PostVersionConflictError({
      message: versionConflictMessage({ id: existing.id, expectedVersion: input.expectedVersion, currentVersion: existing.version }),
      expectedVersion: input.expectedVersion,
      currentVersion: existing.version,
    });
  }

  // An already-trashed holder was already off the public site before this call, so no
  // `entry.unpublished` either — re-emitting it would duplicate the one `deletePost` (or an earlier
  // retire) already sent for the same transition.
  if (isTrashed(existing)) {
    const post = await deps.repo.transaction({ fn: () => releaseTrashedSlug({ repo: deps.repo, holder: existing }) });
    return { post, revisionId: null, previousRevisionId: null };
  }

  // Same disambiguation loop as `createPost`'s derived-slug path (`:1037-1043`): a trashed row keeps
  // reserving its slug (see `deletePost`'s own doc), so a second same-day retirement of the same
  // address collides with the first retirement's renamed slug and must suffix past it.
  const base = `${existing.slug}-replaced-${input.today}`;
  let slug = base;
  let suffix = 1;
  while (await deps.repo.findBySlug({ workspaceId: input.workspaceId, slug })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  const now = clockNowIso({ clock: deps.clock });
  const renamed: PostRecord = { ...existing, slug, updatedAt: now, version: existing.version + 1 };

  const { post, id: revisionId, previousId: previousRevisionId } = await persistRetirement({ deps, input, existing, renamed, now });

  return { post, revisionId, previousRevisionId };
}

function persistRetirement(
  { deps, input, existing, renamed, now }: { deps: RetirePostForReplacementDeps; input: RetirePostForReplacementInput; existing: PostRecord; renamed: PostRecord; now: string },
  _optional: Record<string, never> = {}
) {
  return deps.repo.transaction({ fn: async () => {
    // Compare-and-set on the version the preflight read: a save landing during the slug search
    // above must win, not be overwritten by this rename (same guard `updatePost` uses).
    await persistUpdatedPost({ repo: deps.repo, post: renamed, expectedVersion: existing.version });
    await appendPostRevision({ repo: deps.repo, post: renamed, op: "update", attribution: input });

    // `expectedVersion` here is the CAS basis `remove` compares against the row's version RIGHT NOW
    // — which is `renamed.version`, since the rename above already landed inside this same
    // transaction (mirrors `deletePost`'s own call, whose basis is likewise the row's current
    // version at the moment of the call, not a target).
    const removed = await deps.remove({
      workspaceId: input.workspaceId,
      id: input.id,
      display: { title: existing.title, subtitle: `${existing.slug} (replaced by publish)` },
      at: renamed.updatedAt,
      expectedVersion: renamed.version,
      actor: { principalId: input.actorId ?? SYSTEM_ACTOR_ID },
    });
    if (!removed.ok) {
      // `not-found` can only mean the row was removed between the read above and this write.
      if (removed.reason === "not-found") throw new PostNotFoundError(`post '${input.id}' was not found`);
      throw new PostConflictError(`post '${input.id}' changed while it was being retired`);
    }

    const trashed: PostRecord = { ...renamed, deletedAt: renamed.updatedAt, version: renamed.version + 1 };
    const deleteRevision = await appendPostRevision({ repo: deps.repo, post: trashed, op: "delete", attribution: input });
    await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing, next: trashed, nowIso: now });
    return { post: trashed, id: deleteRevision.id, previousId: deleteRevision.previousId };
  } });
}
