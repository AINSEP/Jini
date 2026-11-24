import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  DUPLICATE_RUNG, FORBIDDEN_RUNG, contentWriteActorId, findPageOrNotFound, idempotencyKeyOf, messageRung, pathParam, rejectContentWriteError, runContentCommand,
  type ContentEntry, type ContentErrorTest, type ContentWriteBaseDeps, type ContentWriteRoutePrincipal, type PageLookupDeps,
} from "../posts/shared.js";

/** The deps this route reads. Callbacks taking the host's prior record are methods (the host's record type is wider). */
export interface PageDeleteRouteDeps extends ContentWriteBaseDeps, PageLookupDeps {
  /** The host's soft delete (the same trash marker as a post's). */
  trashEntry: (required: { workspaceId: string; id: string; actorId: string }) => Promise<{ post: ContentEntry }>;
  restoreEntry(required: { prior: ContentEntry; actorId: string }): Promise<void>;
  postErrors: { isNotFound: ContentErrorTest; isConflict: ContentErrorTest };
}

const pageDeleteRungs = ({ errors }: { errors: PageDeleteRouteDeps["postErrors"] }) => [
  FORBIDDEN_RUNG, DUPLICATE_RUNG,
  messageRung({ matches: errors.isNotFound, status: 404 }, { code: "ENTRY_NOT_FOUND" }),
  messageRung({ matches: errors.isConflict, status: 409 }, { code: "ENTRY_CONFLICT" }),
];

/** Trashes the page as one `delete` command whose inverse clears the marker; the pre-trash page is kept for the rollback. @complexity O(1) plus the gateway. */
async function trashPageCommand(
  { deps, actorId, input }: { deps: PageDeleteRouteDeps; actorId: string; input: { pageId: string; idempotencyKey: string | undefined } },
  _optional: Record<string, never> = {},
) {
  const { pageId } = input;
  let prior: ContentEntry | null = null;
  return runContentCommand({ deps, command: {
    actorId, idempotencyKey: input.idempotencyKey, summary: `Delete page ${pageId}`, entityId: pageId, operation: "delete",
    captureInverse: async () => {
      prior = await findPageOrNotFound({ deps, pageId });
      return { deletedAt: null };
    },
    execute: () => deps.trashEntry({ workspaceId: deps.workspaceId, id: pageId, actorId }),
    rollback: () => (prior ? deps.restoreEntry({ prior, actorId }) : Promise.resolve()),
  } });
}

/**
 * DELETE a Page — a soft delete through the command gateway, mirroring the post delete (`content.write`,
 * `Idempotency-Key` via `readHeaders: ["idempotency-key"]`, inline drain, the trashed row as the body).
 * Acts on the raw `:pageId` and refuses any row that is not a page. No body cap, no plugin hook.
 */
export const pageDeleteRoute = defineJsonRoute<{ pageId: string; idempotencyKey: string | undefined }, object, PageDeleteRouteDeps, ContentWriteRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/pages/:pageId",
  parse: (raw) => ok({ value: { pageId: pathParam({ params: raw.params, name: "pageId" }), idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
  handle: async ({ input, deps, context }) => {
    const actorId = contentWriteActorId({ context, family: "pages" });
    try {
      const result = await trashPageCommand({ deps, actorId, input });
      await deps.drainOutbox();
      return ok({ value: deps.toAdminPostResponse({ post: result.post }) });
    } catch (err) {
      return rejectContentWriteError({ err, rungs: pageDeleteRungs({ errors: deps.postErrors }) });
    }
  },
});
