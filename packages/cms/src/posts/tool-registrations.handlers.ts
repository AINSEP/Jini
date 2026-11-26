

import { getAdminPostById } from "@jini-ai/cms/posts/post-read";

import { optionalNumber, requireInputRecord, requireString, withSchemaOnRejection, type ToolHandler } from "@jini-ai/core";

import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";

import { PostNotFoundError } from "@jini-ai/cms/posts/post";

import { searchAdminPosts } from "@jini-ai/cms/posts/search";

import { isPostShapeRejection } from "@jini-ai/cms/posts/post-tool-errors";
import { requirePostKind, optionalPostStatus } from "./post-tool-input.js";
import { toPostToolViewWithPublicUrl } from "@jini-ai/cms/posts/post-tool-views";

import type { PostToolDeps } from "./post-tool-deps.js";
import { listPostToolPosts, createPostToolPost, deletePostToolPost } from "./tool-registrations.js";
import { updatePostToolPost } from "./tool-registrations.update.js";

    /**
     * Ranked search. Gated exactly like `content_post_list` — same `content.read` permission, same
     * inline check in the route's place, because `searchAdminPosts` (like `listAdminPosts`) takes no
     * `authorize` param of its own. No `entityId` on the check: the caller has not named a row yet,
     * which is the whole point of searching, so this authorizes the ACT of reading posts in this
     * workspace rather than access to any particular one.
     *
     * `withSchemaOnRejection` wraps it for the same reason the write handlers use it: the two things
     * that can go wrong here (a query with no searchable term, a non-numeric `limit`) are both
     * `PostValidationError`s a different input would fix, so publishing the schema alongside saves
     * the model a turn.
     */
export function buildPostHandlers({ routeDeps }: { routeDeps: PostToolDeps }, _optional = {}): Record<string, ToolHandler> {
  return {
    content_post_search: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.contentReadPermission }, { entityType: "post" });

      return withSchemaOnRejection({ toolId: "content_post_search", catalog: routeDeps.catalog, isShapeRejection: ({ error }) => isPostShapeRejection({ error }), fn: async () => {
        const query = requireString({ input: input, key: "query" });
        const kind = input.kind !== undefined ? requirePostKind(input) : undefined;
        const status = optionalPostStatus(input);
        const limit = optionalNumber({ input: input, key: "limit" });

        const { hits } = await searchAdminPosts({
          deps: { search: routeDeps.postSearch },
          input: {
            workspaceId: routeDeps.workspaceId,
            query,
            ...(kind !== undefined ? { kind } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
        });

        // `hits` is already the model-facing shape (`PostSearchHit`), so unlike every other handler
        // here there is no `toPostToolView` projection to apply — and deliberately no `bodyJson` to
        // drop, because the search layer never loads one. See `search.ts`'s `PostSearchHit` doc.
        return { hits };
      } });
    },

    /**
     * Reads the existing workspace inventory, filters before limit and optionally projects rows.
     * Permission and selector failures are ToolInputError or the existing permission refusal.
     * One repository list call; no writes or per-row repository reads. Inventory remains unbounded
     * at the repository, while the returned rows are capped at MAX_POST_LIST_LIMIT.
     * @complexity O(n * s + b + f) time and O(n + b + f) space: n loaded rows, s title/slug length,
     * b returned body text and f requested projection keys across returned rows.
     */
    content_post_list: async (ctx) => listPostToolPosts({ routeDeps, ctx }),

    content_post_get: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const id = requireString({ input: input, key: "id" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.contentReadPermission }, { entityType: "post", entityId: id });

      const kind = input.kind === undefined ? undefined : requirePostKind(input);
      const { post } = await getAdminPostById({ deps: { repo: routeDeps.postRepo }, input: { workspaceId: routeDeps.workspaceId, id } });

      // Disclosed asymmetry (agent-tools.ts's own header): kind:"page" is guarded exactly like
      // pages/get-by-id.ts (a kind mismatch 404s identically to not-found); kind:"post" is NOT
      // guarded, exactly like posts/get-by-id.ts's own legacy, kind-blind lookup.
      if (kind === "page" && post.kind !== "page") {
        throw new PostNotFoundError(`page '${id}' was not found`);
      }

      return { post: toPostToolViewWithPublicUrl({ deps: routeDeps.postToolViewDeps({ routeDeps }), post }) };
    },

    content_post_create: async (ctx) => createPostToolPost({ routeDeps, ctx }),

    content_post_update: async (ctx) => updatePostToolPost({ routeDeps, ctx }),

    /** Domain execution after the shared approval policy asks the human.
     * Permission and version checks still apply here; the registration composition owns the card. */
    content_post_delete: async (ctx) => deletePostToolPost({ routeDeps, ctx }),
  };
}

