import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file ADR-031 §3/§8 — the moderation write-service: wraps `CommentRepoPort.applyModeration`/
 * `purge` with outbox event emission and the `comments.statusChanged` action hook. Routes call
 * `authorize()` first (ADR-021 flat `comments.*` strings), then this service, never the repo
 * directly — the same "typed, core-owned write, no side-door" discipline ADR-023 §7 requires of
 * the repo itself, one layer up.
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";
import type { OutboxPort } from "../core/index.js";
import type { CommentHookRegistry } from "./hooks.js";
import type { CommentEventName, CommentRepoPort } from "./ports.js";
import type { CommentRecord, CommentStatus, ModerationAction, ModerationLogEntry } from "./types.js";

/**
 * Hands one comment's removal to whoever owns removal in this composition.
 *
 * Structurally typed ON PURPOSE — this file imports nothing from `features/trash`, exactly as
 * `post.ts`'s `RemovePostFn` does not. The composition root binds the real implementation (which
 * records the item for the Trash screen) and hands it in already bound to this domain's entity
 * type, so the moderation service never learns that a Trash exists.
 *
 * `display` is REQUIRED because the caller already holds the record: `applyModeration` returns the
 * updated row, so the two strings the Trash screen shows come from columns, with no second read and
 * no payload parse.
 */
export type RemoveCommentFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;

/**
 * Drops any removal record for a comment that has come back out of `trash` by a route other than a
 * Trash-screen restore — i.e. an ordinary moderation decision.
 *
 * This is the half of the pair it is easy to forget, and forgetting it is the expensive mistake:
 * without it, approving a trashed comment leaves a row in the index pointing at a comment that is
 * live on the page again, so the Trash screen offers to permanently delete published content.
 */
export type ForgetRemovedCommentFn = (required: { workspaceId: string; id: string }) => Promise<void>;

/**
 * Runs `fn` inside one database transaction. MUST be reentrant — see the composition root's runner.
 *
 * Structurally typed for the same reason as {@link RemoveCommentFn}: no trash import here.
 */
export type CommentTransactionRunner = <T>(fn: () => Promise<T>) => Promise<T>;

export interface CommentWriteServiceDeps {
  repo: CommentRepoPort;
  outbox: OutboxPort;
  hooks: CommentHookRegistry;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  /** See {@link RemoveCommentFn}. Called only on the transition INTO `trash`. */
  remove: RemoveCommentFn;
  /** See {@link ForgetRemovedCommentFn}. Called only on the transition OUT of `trash`. */
  forgetRemoved: ForgetRemovedCommentFn;
  /**
   * Wraps the moderation write and the index write so they are both-or-neither. `applyModeration`
   * opens its own `better-sqlite3` transaction, which nests as a SAVEPOINT when one is already
   * open, so this runner may be the outer one.
   */
  runInTransaction: CommentTransactionRunner;
}

/** The one `CommentStatus` value that means "deleted" — the marker the Trash index mirrors. */
const TRASHED_STATUS: CommentStatus = "trash";

/** Longest body excerpt stored as the Trash row's subtitle; matches the backfill's `substr(...,120)`. */
const TRASH_SUBTITLE_MAX = 120;

/**
 * Raised when the moderation write landed but its Trash index write could not.
 *
 * Only reachable if the comment row changed between two statements of the same transaction, which
 * it cannot — so this is an invariant breach, not a runtime condition. It is thrown rather than
 * returned so the enclosing transaction rolls the moderation back: a comment hidden with no Trash
 * row is unrecoverable from the UI, which is strictly worse than a failed moderation the operator
 * can retry.
 */
export class CommentRemovalIndexError extends Error {}

export type ModerationResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "conflict"; currentVersion?: number | undefined };

const EVENT_NAME_BY_ACTION: Partial<Record<ModerationAction, CommentEventName>> = {
  approve: "comments.approved",
  mark_spam: "comments.marked_spam",
  trash: "comments.trashed",
};

// Inline object literal at the enqueue() call site (not a `CommentDomainEvent`-typed
// intermediate) — see ingress.ts's identical note on why: TS only infers a
// `Record<string, unknown>`-compatible index signature for a FRESH literal argument.
async function emitEvent(
  deps: CommentWriteServiceDeps,
  required: { workspaceId: UUID; name: CommentEventName; commentId: UUID; entryId: UUID; status: CommentStatus }
): Promise<void> {
  await deps.outbox.enqueue({
    id: deps.idGen.newId(),
    name: required.name,
    occurredAt: clockNowIso({ clock: deps.clock }),
    aggregateId: required.commentId,
    workspaceId: required.workspaceId,
    payload: { commentId: required.commentId, entryId: required.entryId, status: required.status },
  });
}

export interface CommentWriteService {
  applyModeration(required: {
    workspaceId: UUID;
    id: UUID;
    expectedVersion: number;
    action: ModerationAction;
    toStatus: CommentStatus;
    actorPrincipalId: UUID;
    /** The assistant's AI marker on the Trash row's `actor.pluginId` (2026-09-21, trash T4c) —
     *  unset by every non-assistant caller (the admin moderation route), so a human's own moderation
     *  stays human-only. Held here only for the transition into `trash` ({@link syncRemovalIndex});
     *  never persisted onto this domain's OWN moderation log, which has no such column. */
    actorPluginId?: UUID | null;
    note: string | null;
  }, optional?: Record<string, never>): Promise<ModerationResult>;

  purge(required: { workspaceId: UUID; id: UUID; actorPrincipalId: UUID; note: string | null }, optional?: Record<string, never>): Promise<ModerationResult>;
}

/**
 * Keeps the Trash index in step with a moderation decision that just landed.
 *
 * Keys off the TRANSITION, not off the target status, and takes the transition from
 * `log.fromStatus` — which `applyModeration` reads inside its own compare-and-set, so it is the one
 * signal here that cannot race a concurrent moderation. That is what makes both failure modes
 * unreachable rather than merely unlikely:
 *
 *  - **double index write** — `fromStatus !== trash` fires at most once per entry into the Trash,
 *    so a repeated `trash` action cannot add a second row (the index's own uniqueness is a second
 *    net, not the first one);
 *  - **stranded index row** — `fromStatus === trash` with any other target fires on every exit,
 *    including the ones that never touch the Trash screen, so an approved comment cannot stay
 *    listed as deleted.
 *
 * Runs inside the caller's transaction, so a throw here rolls the moderation back with it.
 *
 * @complexity O(1) — at most one delegated write.
 */
async function syncRemovalIndex(
  deps: CommentWriteServiceDeps,
  required: { at: string; log: ModerationLogEntry; record: CommentRecord; actorPluginId: UUID | null }
): Promise<void> {
  const from = required.log.fromStatus;
  const to = required.record.status;

  if (to === TRASHED_STATUS && from !== TRASHED_STATUS) {
    const removed = await deps.remove({
      workspaceId: required.record.workspaceId,
      id: required.record.id,
      // From the row `applyModeration` just returned — columns only, no second read.
      display: {
        title: `Comment on ${required.record.entryId}`,
        subtitle: required.record.bodyText.slice(0, TRASH_SUBTITLE_MAX),
      },
      at: required.at,
      // The version AFTER the flip: what the sweeper's compare-and-delete checks, and what a
      // restore bumps past so the item always survives a race.
      expectedVersion: required.record.version,
      actor: { principalId: required.log.actorPrincipalId, pluginId: required.actorPluginId },
    });
    if (!removed.ok) {
      throw new CommentRemovalIndexError(
        `comments: comment '${required.record.id}' was moved to trash but could not be indexed (${removed.reason})`
      );
    }
    return;
  }

  if (from === TRASHED_STATUS && to !== TRASHED_STATUS) {
    await deps.forgetRemoved({ workspaceId: required.record.workspaceId, id: required.record.id });
  }
}

export function createCommentWriteService(deps: CommentWriteServiceDeps, _optional: Record<string, never> = {}): CommentWriteService {
  return {
    async applyModeration(required) {
      // Pulled out before the spread below: `deps.repo.applyModeration` persists this domain's OWN
      // moderation log, which has no `actorPluginId` column — spreading it in would be an excess
      // property on a fresh object literal (a real `tsc` error, not just a lint nit). The Trash's
      // `actor.pluginId` is a SEPARATE concern, carried only as far as `syncRemovalIndex` below.
      const { actorPluginId, ...repoRequired } = required;
      const at = clockNowIso({ clock: deps.clock });
      const result = await deps.runInTransaction(async () => {
        const applied = await deps.repo.applyModeration({ ...repoRequired, at });
        if (!applied.ok) return applied;
        await syncRemovalIndex(deps, { at, log: applied.log, record: applied.record, actorPluginId: actorPluginId ?? null });
        return applied;
      });
      if (!result.ok) return result;

      await deps.hooks.runStatusChangedHooks({
        workspaceId: required.workspaceId,
        commentId: required.id,
        fromStatus: result.log.fromStatus,
        toStatus: result.record.status,
      });

      const eventName = EVENT_NAME_BY_ACTION[required.action];
      if (eventName) {
        await emitEvent(deps, {
          workspaceId: required.workspaceId,
          name: eventName,
          commentId: required.id,
          entryId: result.record.entryId,
          status: result.record.status,
        });
      }

      return { ok: true };
    },

    async purge(required) {
      const at = clockNowIso({ clock: deps.clock });
      const before = await deps.repo.findById({ workspaceId: required.workspaceId, id: required.id });
      const result = await deps.runInTransaction(async () => {
        const purged = await deps.repo.purge({ ...required, at });
        // The row is gone for good, so its index row would otherwise outlive it and offer the Trash
        // screen a "Restore" that can never succeed. Same both-or-neither transaction as the
        // moderation path above.
        if (purged.ok) await deps.forgetRemoved({ workspaceId: required.workspaceId, id: required.id });
        return purged;
      });
      if (!result.ok) return result;

      if (before) {
        await emitEvent(deps, {
          workspaceId: required.workspaceId,
          name: "comments.purged",
          commentId: required.id,
          entryId: before.entryId,
          status: before.status,
        });
      }

      return { ok: true };
    },
  };
}
