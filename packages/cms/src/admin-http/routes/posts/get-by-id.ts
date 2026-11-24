import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { authorizePostRead, type PostRoutePrincipal } from "./shared.js";

/** The deps this route reads. `readPost` is the host's id-or-slug lookup plus its admin post DTO and
 *  published-ever check; `isPostNotFound` recognizes the host's own not-found error. */
export interface PostGetRouteDeps {
  workspaceId: string;
  readPost: (required: { workspaceId: string; idOrSlug: string }) => Promise<{ post: object; everPublished: boolean }>;
  isPostNotFound: (required: { err: unknown }) => boolean;
  /** Words the classified not-found refusal for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
}

/** Gated by `content.read` (2026-07-16 authz sweep — see `posts/list.ts`'s identical fix/note). */
export const postGetRoute = defineJsonRoute<{ idOrSlug: string }, { post: object }, PostGetRouteDeps, PostRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/posts/:postId",
  parse: (raw) => ok({ value: { idOrSlug: String(raw.params.postId ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePostRead({ authorize });
    try {
      // Admin URLs use the slug when one resolves (cleaner than the raw stored id, 2026-08-10) — this
      // route accepts either so an old id-based bookmark/link keeps working (the host's lookup
      // tries id first, falls back to slug; see that function's own doc).
      const { post, everPublished } = await deps.readPost({ workspaceId: deps.workspaceId, idOrSlug: input.idOrSlug });
      return ok({ value: { post: { ...post, everPublished } } });
    } catch (err) {
      // No code: the legacy shape this route has always answered. The copy is the host's outward wording of the not-found error.
      if (deps.isPostNotFound({ err })) rejectRoute({ status: 404, error: err instanceof Error ? deps.outwardErrorMessage({ error: err }) : String(err) });
      throw err;
    }
  },
});
