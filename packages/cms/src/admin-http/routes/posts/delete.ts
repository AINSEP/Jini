import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  DUPLICATE_RUNG, FORBIDDEN_RUNG, contentWriteActorId, idempotencyKeyOf, messageRung, pathParam, rejectContentWriteError, resolveEntryId, runContentCommand,
  type ContentEntry, type ContentErrorTest, type ContentWriteBaseDeps, type ContentWriteRoutePrincipal, type EntryIdLookupFn,
} from "./shared.js";

/** The deps this route reads. Callbacks taking the host's prior record are methods (the host's record type is wider). */
export interface PostDeleteRouteDeps extends ContentWriteBaseDeps {
  findPostId: EntryIdLookupFn;
  findEntry: (required: { workspaceId: string; id: string }) => Promise<ContentEntry | null>;
  /** The host's soft delete: stamps the trash marker and writes the Trash index row. */
  trashEntry: (required: { workspaceId: string; id: string; actorId: string }) => Promise<{ post: ContentEntry }>;
  /** Compensates the row, its revision ledger AND the Trash index row inside one restore. */
  restoreEntry(required: { prior: ContentEntry; actorId: string }): Promise<void>;
  postErrors: { isNotFound: ContentErrorTest; isConflict: ContentErrorTest };
}

/**
 * Not found, then the lost compare-and-set (2026-09-20: the trash write can lose a race with another
 * save; the version-conflict subclass answers here too). This route is a NEW endpoint, so its codes
 * follow errors.spec.md §1. No plugin hook runs on a delete.
 */
const postDeleteRungs = ({ errors }: { errors: PostDeleteRouteDeps["postErrors"] }) => [
  FORBIDDEN_RUNG, DUPLICATE_RUNG,
  messageRung({ matches: errors.isNotFound, status: 404 }, { code: "ENTRY_NOT_FOUND" }),
  messageRung({ matches: errors.isConflict, status: 409 }, { code: "ENTRY_CONFLICT" }),
];

/**
 * Trashes the post as one `delete` command (the operation that routes a revert to the delete
 * reverter). The whole inverse of a soft delete is "clear the marker"; the full pre-trash record is
 * kept for the rollback, so a failed change-set record restores it exactly, marker and version included.
 * @complexity O(1) plus the gateway and the injected service.
 */
async function trashPostCommand(
  { deps, postId, actorId, idempotencyKey }: { deps: PostDeleteRouteDeps; postId: string; actorId: string; idempotencyKey: string | undefined },
  _optional: Record<string, never> = {},
) {
  let prior: ContentEntry | null = null;
  return runContentCommand({ deps, command: {
    actorId, idempotencyKey, summary: `Delete post ${postId}`, entityId: postId, operation: "delete",
    captureInverse: async () => {
      prior = await deps.findEntry({ workspaceId: deps.workspaceId, id: postId });
      return prior ? { deletedAt: null } : null; // execute() throws the not-found → 404
    },
    execute: () => deps.trashEntry({ workspaceId: deps.workspaceId, id: postId, actorId }),
    rollback: () => (prior ? deps.restoreEntry({ prior, actorId }) : Promise.resolve()),
  } });
}

/**
 * DELETE post — a SOFT delete routed through the command gateway exactly like the update: same
 * `content.write` permission (deleting content IS writing content), same `Idempotency-Key` handling
 * (mount `readHeaders: ["idempotency-key"]`), same inline outbox drain (a trashed PUBLISHED row's
 * `entry.unpublished`), and the same success body, so a client sees the record it just trashed. No
 * body cap: a DELETE carries no body.
 */
export const postDeleteRoute = defineJsonRoute<{ postId: string; idempotencyKey: string | undefined }, object, PostDeleteRouteDeps, ContentWriteRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/posts/:postId",
  parse: (raw) => ok({ value: { postId: pathParam({ params: raw.params, name: "postId" }), idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
  handle: async ({ input, deps, context }) => {
    const actorId = contentWriteActorId({ context, family: "posts" });
    try {
      const postId = await resolveEntryId({ deps, rawParam: input.postId });
      const result = await trashPostCommand({ deps, postId, actorId, idempotencyKey: input.idempotencyKey });
      await deps.drainOutbox();
      return ok({ value: deps.toAdminPostResponse({ post: result.post }) });
    } catch (err) {
      return rejectContentWriteError({ err, rungs: postDeleteRungs({ errors: deps.postErrors }) });
    }
  },
});
