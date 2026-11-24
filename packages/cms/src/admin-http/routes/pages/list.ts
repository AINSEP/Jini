import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizePageRead, type PageRoutePrincipal } from "./shared.js";

/** The deps this route reads. The host binds its page lister and admin post DTO into `listPageResponses`. */
export interface PageListRouteDeps {
  workspaceId: string;
  listPageResponses: (required: { workspaceId: string }) => Promise<readonly object[]>;
}

/**
 * GET admin pages — same shape as the posts list, filtered to `kind: "page"` (a page is a post row
 * with `kind: "page"`, same table, same repo, same editor), answered under the same `posts` key.
 *
 * Gated by `content.read` (2026-07-16 authz sweep — see the posts list's identical fix/note).
 */
export const pageListRoute = defineJsonRoute<Record<string, never>, { posts: readonly object[] }, PageListRouteDeps, PageRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/pages",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizePageRead({ authorize });
    return ok({ value: { posts: await deps.listPageResponses({ workspaceId: deps.workspaceId }) } });
  },
});
