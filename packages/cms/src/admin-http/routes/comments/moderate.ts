import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { CommentStatus, ModerationAction } from "../../../comments/types.js";
import type { CommentWriteService, ModerationResult } from "../../../comments/write-service.js";
import { authorizeComments, commentsActorId, type CommentsRoutePrincipal } from "./shared.js";

/**
 * @file ADR-031 §6/§9 (SPEC-033) — the 5 moderation action routes (approve/spam/trash/restore/
 * purge). One file, not five — the 5 actions are near-identical (permission check → parse
 * expectedVersion → call the write-service → map the result to a status code), so a single
 * parameterized registrar per action is a reasonable simplification over 5 near-duplicate files
 * (Article III). Each still registers its OWN route/permission pairing explicitly, not a generic
 * `/action/:verb` dispatcher — route paths and permission strings stay grep-able and explicit.
 */

/** The deps these routes read. */
export interface CommentsModerateRouteDeps {
  workspaceId: string;
  commentWriteService: Pick<CommentWriteService, "applyModeration" | "purge">;
}

/** The comment id plus the untyped body, validated only after authorization (403 before 400). */
export interface CommentsModerateInput { commentId: string; body: unknown }

interface ActionSpec {
  path: string;
  permission: string;
  action: ModerationAction;
  toStatus: CommentStatus; // purge is registered separately and has no toStatus
}

/**
 * v1 simplification: `restore` always targets `approved`, regardless of whether the comment was
 * previously `trash` or `spam` — the moderation_log's own `fromStatus` still records exactly
 * which, so this is a UX default (an operator restoring anything wants it visible again), not a
 * loss of audit information.
 */
const ACTIONS: readonly ActionSpec[] = [
  { path: "approve", permission: "comments.moderate", action: "approve", toStatus: "approved" },
  { path: "spam", permission: "comments.moderate", action: "mark_spam", toStatus: "spam" },
  { path: "trash", permission: "comments.delete", action: "trash", toStatus: "trash" },
  { path: "restore", permission: "comments.moderate", action: "restore", toStatus: "approved" },
];

function parseExpectedVersion({ raw }: { raw: unknown }, _optional = {}): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") n = Number(raw);
  else return null;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** This route's `{expectedVersion, note}` body, read once; a failed `expectedVersion` is the
 *  route's flat (code-less) 400. @complexity O(1). */
function parseModerationBody({ rawBody }: { rawBody: unknown }, _optional = {}): { expectedVersion: number; note: string | null } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const expectedVersion = parseExpectedVersion({ raw: body.expectedVersion });
  if (expectedVersion === null) rejectRoute({ status: 400, error: "expectedVersion is required and must be a non-negative integer" });
  return { expectedVersion, note: typeof body.note === "string" ? body.note : null };
}

/** Refuses a failed `applyModeration` call — the not-found/version-conflict split mapped from
 *  `result.reason`, with the stored `currentVersion` when the service reported one. @complexity O(1). */
function refuseModerationResult(result: Extract<ModerationResult, { ok: false }>): never {
  const status = result.reason === "not-found" ? 404 : 409;
  throw new RouteRefusalError({ status, body: { error: result.reason, currentVersion: "currentVersion" in result ? result.currentVersion : undefined } });
}

const parseModerateInput: JsonRouteSpec<CommentsModerateInput, void, CommentsModerateRouteDeps, CommentsRoutePrincipal>["parse"] = (raw) =>
  ok({ value: { commentId: raw.params.commentId as string, body: raw.body } });

/** One moderation action's spec: 204 on success. @complexity O(1). */
function moderationActionRoute(spec: ActionSpec): JsonRouteSpec<CommentsModerateInput, void, CommentsModerateRouteDeps, CommentsRoutePrincipal> {
  return defineJsonRoute<CommentsModerateInput, void, CommentsModerateRouteDeps, CommentsRoutePrincipal>({
    method: "post",
    path: `/api/admin/v1/workspaces/:workspaceId/comments/:commentId/${spec.path}`,
    parse: parseModerateInput,
    handle: async ({ input, deps, context, authorize }) => {
      const actorPrincipalId = commentsActorId({ context });
      await authorizeComments({ authorize, permission: spec.permission, entityType: "comment" }, { entityId: input.commentId });
      const parsedBody = parseModerationBody({ rawBody: input.body });
      const result = await deps.commentWriteService.applyModeration({
        workspaceId: deps.workspaceId,
        id: input.commentId,
        expectedVersion: parsedBody.expectedVersion,
        action: spec.action,
        toStatus: spec.toStatus,
        actorPrincipalId,
        note: parsedBody.note,
      });
      if (!result.ok) refuseModerationResult(result);
      return ok({ value: undefined });
    },
  }, { successStatus: 204 });
}

/** approve / spam / trash / restore, in registration order. */
export const commentsModerationActionRoutes = ACTIONS.map(moderationActionRoute);

/** Permanently delete a comment (`comments.delete.force`); 204 on success, 404 when it is gone. */
export const commentsPurgeRoute = defineJsonRoute<CommentsModerateInput, void, CommentsModerateRouteDeps, CommentsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/comments/:commentId/purge",
  parse: parseModerateInput,
  handle: async ({ input, deps, context, authorize }) => {
    const actorPrincipalId = commentsActorId({ context });
    await authorizeComments({ authorize, permission: "comments.delete.force", entityType: "comment" }, { entityId: input.commentId });
    const body = input.body as Record<string, unknown>;
    const result = await deps.commentWriteService.purge({
      workspaceId: deps.workspaceId,
      id: input.commentId,
      actorPrincipalId,
      note: typeof body.note === "string" ? body.note : null,
    });
    if (!result.ok) rejectRoute({ status: 404, error: result.reason });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
