import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizePostRead, type PostRoutePrincipal } from "./shared.js";

/** The deps this route reads. The host binds its post reader and admin post DTO into `listPostResponses`. */
export interface PostListRouteDeps {
  workspaceId: string;
  listPostResponses: (required: { workspaceId: string }) => Promise<readonly object[]>;
}

/** Gated by `content.read` (2026-07-16 authz sweep: previously had zero permission check
 * beyond session auth — `content.read` was defined in the catalog but never enforced anywhere). */
export const postListRoute = defineJsonRoute<Record<string, never>, { posts: readonly object[] }, PostListRouteDeps, PostRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/posts",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizePostRead({ authorize });
    return ok({ value: { posts: await deps.listPostResponses({ workspaceId: deps.workspaceId }) } });
  },
});
