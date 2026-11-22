import type { CommentsModuleDeps } from "../index.js";

/**
 * @file What a public comment may attach to. Comments key on ADR-022 entries (ADR-031 §2), but the
 * public blog still renders legacy `posts` rows, a separate table: a thread rendered under a post
 * carries the post's id, and an entries-only lookup would refuse every one of those submissions as
 * `entry-not-found`. So an entry wins and a post is the fallback. Ids are UUIDs, so the two tables
 * cannot alias one another.
 *
 * Posts have no publish timestamp, so `closeAfterDays` cannot close a post's thread (a `null`
 * `publishedAt` never passes the close window in `Jini packages/cms/src/comments/module.ts`); the draft gate still holds.
 */
type Lookup = CommentsModuleDeps["entryLookup"];
type FindById<T> = { findById(required: { workspaceId: string; id: string }): Promise<T | null> };

/** @complexity O(1): at most two keyed reads. */
export function createCommentTargetLookup(required: {
  entries: FindById<{ status: string; publishedAt: string | null }>;
  posts: FindById<{ status: string }>;
}, _options = {}): Lookup {
  return async ({ workspaceId, entryId }) => {
    const entry = await required.entries.findById({ workspaceId, id: entryId });
    if (entry) return { status: entry.status, publishedAt: entry.publishedAt };
    const post = await required.posts.findById({ workspaceId, id: entryId });
    return post ? { status: post.status, publishedAt: null } : null;
  };
}
