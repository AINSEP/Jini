import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import type { UUID } from "@jini-ai/core/primitives";

import type { PostStatus } from "../core/post-vocabulary.js";

/**
 * @file Scheduled go-live announcements (2026-10-21) — the one place a scheduled post's
 * `entry.published` comes from.
 *
 * Visibility stays render-time (`contracts/core/scheduled-publish.ts`): no job has to run for a
 * scheduled post to become readable. Events cannot work that way. A save of a post scheduled for
 * later used to emit `entry.published` at SAVE time, so every outbox consumer (webhooks, SEO
 * sitemap/feed invalidation, newsletters, notifications) learned of embargoed content early, and
 * nothing fired again when it really went live. Saves now treat a scheduled row as not public
 * (`post.ts`'s `publicFacingStatus`), and this sweep announces it once its `publishAt` passes.
 *
 * Exactly once, with no new column: the event id is `${id}-entry.published-at-${publishAt}` — the
 * scheduled publication itself, not a content version (review fix, 2026-10-21). It used to be
 * `${id}-entry.published-${version}`, which collided with the id the PREVIOUS code already gave
 * the early save-time event, so a post scheduled before this deploy was never announced at its real
 * go-live; and a version-keyed id let an edit that straddled go-live (its transaction reading a
 * pre-deadline clock while a sweep read the prior version at the deadline) announce twice, once
 * per version. No save-time event has the `-at-` shape, and the outbox ignores a repeated id, so
 * a sweep that overlaps a previous window, runs in two processes, replays after a restart, or sees
 * a later version of the same schedule re-enqueues a no-op. Moving `publishAt` is a new schedule,
 * and announces again when that one passes.
 *
 * "Was saved while still scheduled" is `publishAt > updatedAt` on the row itself: a row saved at or
 * after its go-live time was announced (or not) by that save, so the sweep must leave it alone.
 */

/** Lists the rows a go-live sweep must announce. */
export interface GoLiveCandidatesPort {
  /**
   * Published, non-trashed rows of `workspaceId` with `afterIso < publishAt <= nowIso` (no lower
   * bound when `afterIso` is absent) and `publishAt > updatedAt` — saved while still scheduled.
   * Oldest go-live first.
   */
  listGoLiveCandidates(required: { workspaceId: string; nowIso: string; afterIso?: string }, optional?: Record<string, never>): Promise<GoLiveRow[]>;
}

/** The row fields a go-live decision and its event read — what an HTML page write can supply
 *  straight off its own SELECT, without a full `PostRecord`. */
export interface GoLiveRow {
  id: UUID;
  workspaceId: UUID;
  kind: string;
  status: PostStatus;
  publishAt?: string | null;
  updatedAt: string;
  deletedAt?: string | null;
}

/** True when `post` was saved while scheduled and its go-live time has since passed, so the save
 *  that wrote it announced nothing and the sweep may not have run yet. @complexity O(1). */
export function wentLiveSinceSave(required: { post: GoLiveRow; nowIso: string }, _optional: Record<string, never> = {}): boolean {
  const { post, nowIso } = required;
  const { publishAt } = post;
  if (post.status !== "published" || (post.deletedAt !== undefined && post.deletedAt !== null) || typeof publishAt !== "string") return false;
  return publishAt > post.updatedAt && publishAt <= nowIso;
}

/** The `entry.published` a scheduled row emits when it goes live; `occurredAt` is the go-live
 *  instant itself, not whenever the sweep happened to notice it. @complexity O(1). */
export function goLiveEvent(required: { post: GoLiveRow }, _optional: Record<string, never> = {}): DomainEvent {
  const { post } = required;
  return {
    id: `${post.id}-entry.published-at-${post.publishAt}`,
    name: "entry.published",
    occurredAt: post.publishAt ?? post.updatedAt,
    aggregateId: post.id,
    workspaceId: post.workspaceId,
    payload: { entryId: post.id, contentType: post.kind },
  };
}

/**
 * The go-live catch-up every writer of a post row owes BEFORE it moves `updatedAt` (2026-10-21):
 * once `updatedAt` passes `publishAt` the sweep no longer sees the row, so a row that went live
 * since its last save and has not been announced yet is announced here, with the sweep's own id
 * (the outbox de-duplicates). Call it inside the write's transaction, so the write cannot commit
 * without it. `post` is the row as it stood BEFORE the write.
 *
 * @complexity O(1) — at most one enqueue.
 */
export async function announcePendingGoLive(required: { outbox: Pick<OutboxPort, "enqueue">; post: GoLiveRow; nowIso: string }, _optional: Record<string, never> = {}): Promise<void> {
  const { outbox, post, nowIso } = required;
  if (wentLiveSinceSave({ post, nowIso })) await outbox.enqueue(goLiveEvent({ post }));
}

/**
 * Enqueues `entry.published` for every row that went live in the window.
 *
 * @param required.deps.repo lists the window's candidates.
 * @param required.deps.outbox receives one event per candidate; a repeated id must be a no-op.
 * @param required.input.workspaceId the served workspace.
 * @param required.input.nowIso the pass's instant.
 * @param optional.afterIso exclusive lower bound on `publishAt`; absent ⇒ full catch-up.
 * @returns how many candidates were enqueued (repeats included).
 * @complexity O(candidates).
 */
export async function announceDueGoLives(
  required: { deps: { repo: GoLiveCandidatesPort; outbox: OutboxPort }; input: { workspaceId: string; nowIso: string } },
  optional: { afterIso?: string } = {}
): Promise<{ announced: number }> {
  const { deps, input } = required;
  const due = await deps.repo.listGoLiveCandidates({ ...input, ...(optional.afterIso ? { afterIso: optional.afterIso } : {}) }, {});
  for (const post of due) await deps.outbox.enqueue(goLiveEvent({ post }));
  return { announced: due.length };
}
