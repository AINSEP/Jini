import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { CommentsSettingsValidationError } from "../../../comments/errors.js";
import type { CommentsSettings } from "../../../comments/types.js";
import { authorizeComments, commentsActorId, type CommentsRoutePrincipal } from "./shared.js";

/** The deps this route reads. The settings ledger write is the host's (it owns the layered settings
 *  store, its clock/ids and the per-key authorization), injected as one function already bound to
 *  those collaborators. */
export interface CommentsPutSettingsRouteDeps {
  workspaceId: string;
  /** Awaited before touching the settings ledger (mirrors `seoReady`'s identical convention). */
  commentsSettingsReady: Promise<unknown>;
  setCommentsSettings: (
    required: { workspaceId: string; patch: Partial<CommentsSettings>; callerPrincipalId: string },
    optional?: Record<string, never>,
  ) => Promise<CommentsSettings>;
}

/** The untyped partial patch; the settings write validates each key it is handed. */
export interface CommentsPutSettingsInput { patch: Partial<CommentsSettings> }

/** PUT (partial) workspace-level `comments.*` settings (SPEC-035, ADR-028 Settings Layered
 * Ledger wiring for Comments). Mirrors the seo settings PUT route's exact shape. */
export const commentsPutSettingsRoute = defineJsonRoute<CommentsPutSettingsInput, { data: CommentsSettings }, CommentsPutSettingsRouteDeps, CommentsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/comments/settings",
  parse: (raw) => ok({ value: { patch: (raw.body ?? {}) as Partial<CommentsSettings> } }),
  handle: async ({ input, deps, context, authorize }) => {
    await deps.commentsSettingsReady;
    const callerPrincipalId = commentsActorId({ context });
    await authorizeComments({ authorize, permission: "comments.configure", entityType: "comments-settings" });
    try {
      const settings = await deps.setCommentsSettings({ workspaceId: deps.workspaceId, patch: input.patch, callerPrincipalId });
      return ok({ value: { data: settings } });
    } catch (err) {
      if (err instanceof CommentsSettingsValidationError) {
        rejectRoute({ status: 400, error: err.message, code: "COMMENTS_SETTINGS_VALIDATION_ERROR" });
      }
      throw err;
    }
  },
});
