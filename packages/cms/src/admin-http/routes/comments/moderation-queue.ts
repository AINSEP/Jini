import { optionalOneOf, optionalString, readToolLimit, ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { CommentRepoPort } from "../../../comments/ports.js";
import { COMMENT_STATUSES, type CommentStatus, type ModerationQueuePage } from "../../../comments/types.js";
import { authorizeComments, type CommentsRoutePrincipal } from "./shared.js";

/**
 * @file ADR-031 §6 (SPEC-033) — `GET /api/admin/v1/workspaces/:workspaceId/comments/queue`, the
 * moderation queue read. `comments.read`-gated. Mirrors this session's established admin-route
 * shape (workspace-id 404 check → authorize() → 403-on-denial → proceed).
 */

/** The deps this route reads. */
export interface CommentsModerationQueueRouteDeps {
  workspaceId: string;
  commentRepo: Pick<CommentRepoPort, "listModerationQueue">;
}

/** The raw query string; read only after authorization, so a denied caller sees the 403 first. */
export interface CommentsModerationQueueInput { query: Record<string, unknown> }

/** Reads the query string through the same Jini checks the `comments_list_moderation_queue` tool
 *  uses, so an off-enum `status` or a malformed `limit` is a 400 rather than a silent `pending` page
 *  or a clamped one. A `limit` above 100 is still capped, as the tool schema promises.
 *  @throws {ToolInputError} naming the bad field.
 *  @complexity O(1). */
function parseQueueQuery(query: Record<string, unknown>): { status: CommentStatus; limit: number; cursor: string | null } {
  const input = { status: query.status, limit: query.limit === undefined ? undefined : Number(query.limit) };
  return {
    status: optionalOneOf({ input, key: "status", values: COMMENT_STATUSES }) ?? "pending",
    limit: readToolLimit({ input, max: 100, fallback: 20 }),
    // A repeated `cursor` arrives as an array: refused, not read as "no cursor" and page 1.
    cursor: optionalString({ input: query, key: "cursor" }) ?? null,
  };
}

export const commentsModerationQueueRoute = defineJsonRoute<CommentsModerationQueueInput, ModerationQueuePage, CommentsModerationQueueRouteDeps, CommentsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/comments/queue",
  parse: (raw) => ok({ value: { query: raw.query } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeComments({ authorize, permission: "comments.read", entityType: "comment" });
    try {
      const { status, limit, cursor } = parseQueueQuery(input.query);
      return ok({ value: await deps.commentRepo.listModerationQueue({ workspaceId: deps.workspaceId, status, limit, cursor }) });
    } catch (err) {
      // A bad query value, or a cursor naming no comment (the repo's `invalid cursor`).
      if (err instanceof ToolInputError) rejectRoute({ status: 400, error: err.message, code: "VALIDATION_ERROR" });
      throw err;
    }
  },
});
