/**
 * @file The three local-admin-Trash seams `createCommentWriteService` requires, as test doubles.
 *
 * Mirrors `features/post/__tests__/remove-post-double.ts`: deliberately NOT a second Trash
 * implementation. It carries no `trashed_items` knowledge at all — the production binding indexes
 * the item, and a test that cares about indexing asserts on the recorded calls instead.
 *
 * `remove` reports success at the version it was handed, which is what the real binding returns for
 * comments: the moderation write has already flipped the status by then, so the adapter's marker
 * flip is a no-op that reports the row's current version.
 */
import type { CommentTransactionRunner, ForgetRemovedCommentFn, RemoveCommentFn } from "../write-service.js";

export interface CommentTrashDoubles {
  remove: RemoveCommentFn;
  forgetRemoved: ForgetRemovedCommentFn;
  runInTransaction: CommentTransactionRunner;
  /** Every `remove` call, in order — for a test that wants to assert the display snapshot. */
  removed: { workspaceId: string; id: string; display: { title: string; subtitle?: string | null } }[];
  /** Every `forgetRemoved` call, in order. */
  forgotten: { workspaceId: string; id: string }[];
}

/** @complexity O(1). */
export function commentTrashDoubles(): CommentTrashDoubles {
  const removed: CommentTrashDoubles["removed"] = [];
  const forgotten: CommentTrashDoubles["forgotten"] = [];
  return {
    removed,
    forgotten,
    remove: async (required) => {
      removed.push({ workspaceId: required.workspaceId, id: required.id, display: required.display });
      return { ok: true, version: required.expectedVersion };
    },
    forgetRemoved: async (required) => {
      forgotten.push(required);
    },
    runInTransaction: (fn) => fn(),
  };
}
