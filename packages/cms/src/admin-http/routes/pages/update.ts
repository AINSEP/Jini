import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  DUPLICATE_RUNG, FORBIDDEN_RUNG, contentWriteActorId, findPageOrNotFound, idempotencyKeyOf, messageRung, pathParam, rejectContentWriteError, runContentCommand,
  type ContentEntry, type ContentErrorTest, type ContentInverse, type ContentWriteBaseDeps, type ContentWriteRoutePrincipal, type PageLookupDeps,
} from "../posts/shared.js";

/** The deps this route reads. Callbacks taking the host's prior record are methods (the host's record type is wider). */
export interface PageUpdateRouteDeps extends ContentWriteBaseDeps, PageLookupDeps {
  /** The pre-edit field set stored as the update's inverse (the host owns the record's fields). */
  updateInverse(required: { prior: ContentEntry }): ContentInverse;
  /** The host's update service over the request body (coercion, `expectedVersion`, featured-image checks). */
  updateEntry: (required: { workspaceId: string; id: string; actorId: string; body: unknown }) => Promise<{ post: ContentEntry }>;
  restoreEntry(required: { prior: ContentEntry; actorId: string }): Promise<void>;
  postErrors: { isValidation: ContentErrorTest; isVersionConflict: ContentErrorTest; isConflict: ContentErrorTest; isNotFound: ContentErrorTest; versionConflictBody: (required: { err: unknown }) => object };
  rejectPluginHookFailure: (required: { err: unknown }) => void;
}

/** The PUT /pages ladder: the version conflict before the slug conflict it extends; every rung carries a `code`. */
function pageUpdateRungs({ errors }: { errors: PageUpdateRouteDeps["postErrors"] }, _optional: Record<string, never> = {}) {
  return [
    FORBIDDEN_RUNG, DUPLICATE_RUNG,
    messageRung({ matches: errors.isValidation, status: 400 }, { code: "VALIDATION_ERROR" }),
    { matches: errors.isVersionConflict, status: 409, body: errors.versionConflictBody },
    messageRung({ matches: errors.isConflict, status: 409 }, { code: "SLUG_CONFLICT" }),
    messageRung({ matches: errors.isNotFound, status: 404 }, { code: "ENTRY_NOT_FOUND" }),
  ];
}

/** Runs the update as one change-set command; the pre-edit page is kept for the rollback. @complexity O(1) plus the gateway. */
async function executePageUpdate(
  { deps, actorId, input }: { deps: PageUpdateRouteDeps; actorId: string; input: { pageId: string; body: unknown; idempotencyKey: string | undefined } },
  _optional: Record<string, never> = {},
) {
  const { pageId } = input;
  let prior: ContentEntry | null = null;
  return runContentCommand({ deps, command: {
    actorId, idempotencyKey: input.idempotencyKey, summary: `Update page ${pageId}`, entityId: pageId, operation: "update",
    captureInverse: async () => {
      prior = await findPageOrNotFound({ deps, pageId });
      return deps.updateInverse({ prior });
    },
    execute: () => deps.updateEntry({ workspaceId: deps.workspaceId, id: pageId, actorId, body: input.body }),
    rollback: async () => {
      if (prior) await deps.restoreEntry({ prior, actorId });
    },
  } });
}

/**
 * PUT a Page (SPEC-002 `PAGE_UPDATE`) through the command gateway, like the post update: `content.write`,
 * `Idempotency-Key` (`readHeaders: ["idempotency-key"]`), `expectedVersion` 409, inline outbox drain.
 * Acts on the raw `:pageId` and refuses any row that is not a page. The 1 MiB cap is the host's binding.
 */
export const pageUpdateRoute = defineJsonRoute<{ pageId: string; body: unknown; idempotencyKey: string | undefined }, object, PageUpdateRouteDeps, ContentWriteRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/pages/:pageId",
  parse: (raw) => ok({ value: { pageId: pathParam({ params: raw.params, name: "pageId" }), body: raw.body, idempotencyKey: idempotencyKeyOf({ headers: raw.headers }) } }),
  handle: async ({ input, deps, context }) => {
    const actorId = contentWriteActorId({ context, family: "pages" });
    try {
      const result = await executePageUpdate({ deps, actorId, input });
      await deps.drainOutbox();
      return ok({ value: deps.toAdminPostResponse({ post: result.post }) });
    } catch (err) {
      return rejectContentWriteError({ err, rungs: pageUpdateRungs({ errors: deps.postErrors }) }, { rejectPluginHookFailure: deps.rejectPluginHookFailure });
    }
  },
});
