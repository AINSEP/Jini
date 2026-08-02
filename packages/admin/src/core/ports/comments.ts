/**
 * @file `AdminCommentsPort` — the moderation queue for visitor-submitted comments, plus the
 * site-wide comments configuration.
 *
 * ## `moderateComment`/`purgeComment` resolve to `void`
 *
 * The reference implementation's moderation routes answer `204 No Content` on success — there is no updated
 * comment in the response body to return. A panel must re-fetch (or optimistically patch its own
 * local copy of) `listCommentsQueue` to see the new state; do not assume this port hands back the
 * post-moderation row. On a version conflict, expect a conflict-class rejection whose error body
 * carries `currentVersion` (see `../transport/errors.ts`'s "`body` is kept raw" decision) so a
 * panel can refresh and retry without a second round-trip just to learn the current value.
 *
 * ## `purgeComment` has no `expectedVersion` and a different permission than moderation actions
 *
 * The four moderation actions (`approve`/`spam`/`trash`/`restore`, expressed here as
 * `CommentModerationAction`) are all optimistic-concurrency-guarded and share one moderation
 * permission. `purge` is a separate, narrower-permissioned, ungated hard delete — mirroring the
 * same "ordinary action vs `.force`-suffixed destructive action" split documented on
 * `AdminMediaPort.deleteMedia`. Do not fold `purge` into `CommentModerationAction`; it is
 * deliberately not one of the four.
 */

export type CommentStatus = "pending" | "approved" | "spam" | "trash";

/** A comment as it appears in the moderation queue. */
export interface AdminComment {
  readonly id: string;
  readonly entryId: string;
  /** Null for a top-level comment. */
  readonly parentId: string | null;
  /** The top-level ancestor of this comment's thread — same value as `id` for a top-level
   *  comment itself. */
  readonly threadRootId: string;
  readonly depth: number;
  readonly status: CommentStatus;
  /** Set when the author was a signed-in member; null for an anonymous/guest comment. */
  readonly authorPrincipalId: string | null;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly authorUrl: string | null;
  /** A hash, never the raw IP — this port never carries an operator-identifiable raw address. */
  readonly authorIpHash: string | null;
  readonly bodyText: string;
  /** Null when no spam classifier ran (e.g. moderation was manual-only for this comment). */
  readonly spamScore: number | null;
  readonly spamProvider: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic-concurrency version — required as `expectedVersion` on every moderation action;
   *  not required by `purgeComment` (see the file header). */
  readonly version: number;
}

/** A keyset-paginated page of the moderation queue. */
export interface AdminCommentsQueuePage {
  readonly items: readonly AdminComment[];
  readonly nextCursor: string | null;
}

export interface CommentsSettings {
  readonly enabled: boolean;
  readonly requireModeration: boolean;
  readonly maxDepth: number;
  /** `null` means comments never auto-close by age. A host's own "never" sentinel, if it has one
   *  internally, should never be sent to or expected from this port directly — always `null`. */
  readonly closeAfterDays: number | null;
  readonly spamAutoRejectScore: number;
  readonly maxPerIpPerHour: number;
}

/** The four real per-comment moderation actions — see the file header for why `purge` is not a
 *  fifth member of this union. */
export type CommentModerationAction = "approve" | "spam" | "trash" | "restore";

export interface AdminCommentsPort {
  listCommentsQueue(options?: {
    status?: CommentStatus;
    cursor?: string;
    limit?: number;
  }): Promise<AdminCommentsQueuePage>;
  /** See the file header: resolves to `void` even on success. */
  moderateComment(
    commentId: string,
    input: { action: CommentModerationAction; expectedVersion: number },
    options?: { note?: string },
  ): Promise<void>;
  /** Hard delete, no version guard, separate permission — see the file header. */
  purgeComment(commentId: string, options?: { note?: string }): Promise<void>;
  getCommentsSettings(): Promise<CommentsSettings>;
  putCommentsSettings(patch?: Partial<CommentsSettings>): Promise<CommentsSettings>;
}
