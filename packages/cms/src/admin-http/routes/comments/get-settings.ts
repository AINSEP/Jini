import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { CommentsSettings } from "../../../comments/types.js";
import { authorizeComments, type CommentsRoutePrincipal } from "./shared.js";

/** The deps this route reads. The settings ledger read is the host's (it owns the layered settings
 *  store), injected as one function already bound to that store. */
export interface CommentsGetSettingsRouteDeps {
  workspaceId: string;
  /** Awaited before touching the settings ledger (mirrors `seoReady`'s identical convention). */
  commentsSettingsReady: Promise<unknown>;
  getCommentsSettings: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<CommentsSettings>;
}

/** GET workspace-level `comments.*` settings (SPEC-035, ADR-028 Settings Layered Ledger wiring
 * for Comments). Mirrors the seo settings GET route's exact shape. */
export const commentsGetSettingsRoute = defineJsonRoute<Record<string, never>, { data: CommentsSettings }, CommentsGetSettingsRouteDeps, CommentsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/comments/settings",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await deps.commentsSettingsReady;
    await authorizeComments({ authorize, permission: "comments.configure", entityType: "comments-settings" });
    const settings = await deps.getCommentsSettings({ workspaceId: deps.workspaceId });
    return ok({ value: { data: settings } });
  },
});
