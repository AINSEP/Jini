/**
 * @file The lock-key name of a post's revision fence. A contract, not post-slice behavior: the post
 * repo and revision thinning take this fence, and the change-set repo adapter in `platform/db` takes
 * the same one before it inserts an item naming a post revision — so the key's spelling is shared
 * vocabulary that both sides must agree on, and `platform/` must not import a feature slice for it.
 */

/**
 * The one fence over a post's revision stream: `appendRevision` and revision thinning
 * (`revision-thinning.ts`) both take it, so a thinning apply never runs between an append's read of
 * the latest row and its insert, and a new newest row cannot appear mid-apply.
 * @complexity O(1).
 */
export function postRevisionLockKey({ workspaceId, postId }: { workspaceId: string; postId: string }, _optional: Record<string, never> = {}): string {
  return `post_revisions:${workspaceId}:${postId}`;
}
