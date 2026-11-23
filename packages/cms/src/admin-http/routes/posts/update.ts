import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  DUPLICATE_RUNG, FORBIDDEN_RUNG, contentWriteActorId, idempotencyKeyOf, messageRung, pathParam, rejectContentWriteError, resolveEntryId, runContentCommand,
  type ContentEntry, type ContentErrorTest, type ContentInverse, type ContentWriteBaseDeps, type ContentWriteRoutePrincipal, type EntryIdLookupFn,
} from "./shared.js";

/** The deps this route reads. Callbacks taking the host's prior record are methods (the host's record type is wider). */
export interface PostUpdateRouteDeps extends ContentWriteBaseDeps {
  findPostId: EntryIdLookupFn;
  findEntry: (required: { workspaceId: string; id: string }) => Promise<ContentEntry | null>;
  /** The pre-edit field set stored as the update's inverse (the host owns the record's fields). */
  updateInverse(required: { prior: ContentEntry }): ContentInverse;
  /** The host's update service over the request body (body coercion, `expectedVersion`, featured-image checks). */
  updateEntry: (required: { workspaceId: string; id: string; actorId: string; body: unknown }) => Promise<{ post: ContentEntry }>;
  /** The rollback: restores the pre-edit record exactly, version included. */
  restoreEntry(required: { prior: ContentEntry; actorId: string }): Promise<void>;
  postErrors: { isValidation: ContentErrorTest; isVersionConflict: ContentErrorTest; isConflict: ContentErrorTest; isNotFound: ContentErrorTest; versionConflictBody: (required: { err: unknown }) => object };
  rejectPluginHookFailure: (required: { err: unknown }) => void;
}

/**
 * This route's ladder. `VALIDATION_ERROR` was added 2026-10-05, matching POST /posts and PUT /pages.
 * The version conflict is BEFORE the slug conflict, because it extends it and `instanceof` would
 * otherwise be answered by the superclass first. Both are 409; the body is what tells them apart — a
 * slug collision and "somebody else saved while you were editing" need opposite responses from the
 * editor. The slug 409 and the 404 stay code-less on purpose (adding one would be a second,
 * unrequested wire change). The version-conflict body is the host's shared envelope, so the `code`
 * a client branches on has exactly one definition across every arm that can produce it.
 */
function postUpdateRungs({ errors }: { errors: PostUpdateRouteDeps["postErrors"] }, _optional: Record<string, never> = {}) {
  return [
    FORBIDDEN_RUNG, DUPLICATE_RUNG,
    messageRung({ matches: errors.isValidation, status: 400 }, { code: "VALIDATION_ERROR" }),
    { matches: errors.isVersionConflict, status: 409, body: errors.versionConflictBody },
    messageRung({ matches: errors.isConflict, status: 409 }),
    messageRung({ matches: errors.isNotFound, status: 404 }),
  ];
}

/**
 * Runs the update as one change-set command. The full pre-edit record is captured in
 * `captureInverse` and reused verbatim by `rollback`, so the gateway's unit-of-work compensation
 * (SPEC-001 REQ-01/EC-08/AC-17) restores the post exactly if the change-set record fails to persist.
 * @complexity O(1) plus the gateway and the injected service.
 */
async function executePostUpdate(
  { deps, postId, actorId, input }: { deps: PostUpdateRouteDeps; postId: string; actorId: string; input: { body: unknown; idempotencyKey: string | undefined } },
  _optional: Record<string, never> = {},
) {
  let prior: ContentEntry | null = null;
  return runContentCommand({ deps, command: {
    actorId, idempotencyKey: input.idempotencyKey, summary: `Update post ${postId}`, entityId: postId, operation: "update",
    captureInverse: async () => {
      prior = await deps.findEntry({ workspaceId: deps.workspaceId, id: postId });
      return prior ? deps.updateInverse({ prior }) : null; // execute() throws the not-found → 404
    },
    execute: () => deps.updateEntry({ workspaceId: deps.workspaceId, id: postId, actorId, body: input.body }),
    rollback: async () => {
      if (prior) await deps.restoreEntry({ prior, actorId });
    },
  } });
}

/**
 * PUT post — routed through the command gateway (SPEC-001 REQ-04): an auditable, revertible change
 * set around the host's update; a reused `Idempotency-Key` (mount `readHeaders: ["idempotency-key"]`)
 * is 409 `DUPLICATE_COMMAND`. The gateway authorizes `content.write` before its idempotency lookup
 * (INV-04). An optional body `expectedVersion` that has been superseded is 409 `VERSION_CONFLICT`
 * (2026-09-06). The outbox is drained before the response (SPEC-008), so SEO's sitemap-cache
 * invalidation sees the event at once. The 1 MiB cap is the host's binding in front of the mount.
 */
export const postUpdateRoute = defineJsonRoute<{ postId: string; body: unknown; idempotencyKey: string | undefined }, object, PostUpdateRouteDeps, ContentWriteRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/posts/:postId",
  parse: (raw) => ok({ value: { postId: pathParam({ params: raw.params, name: "postId" }), body: raw.body, idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
  handle: async ({ input, deps, context }) => {
    const actorId = contentWriteActorId({ context, family: "posts" });
    try {
      const postId = await resolveEntryId({ deps, rawParam: input.postId });
      const result = await executePostUpdate({ deps, postId, actorId, input });
      await deps.drainOutbox();
      return ok({ value: deps.toAdminPostResponse({ post: result.post }) });
    } catch (err) {
      return rejectContentWriteError({ err, rungs: postUpdateRungs({ errors: deps.postErrors }) }, { rejectPluginHookFailure: deps.rejectPluginHookFailure });
    }
  },
});
