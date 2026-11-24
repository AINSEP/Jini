import type { AdminPost } from "../api/posts-api.types.js";

/**
 * @file What `use-posts.hooks.ts` (the LIST hook — `posts-list-*`, distinct from `use-post-editor
 * .hooks.ts`'s own `post-editor-port.hooks.ts`) needs from the outside world, as an interface
 * rather than a direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair
 * documented in `development/docs/architecture/wired-hooks-convention.md`.
 */
export interface PostsListPort {
  listPosts(): Promise<{ posts: Array<{ post: AdminPost }> }>;
  /**
   * `expectedVersion` (2026-09-18, multi-author hardening) — the optimistic-concurrency basis, same
   * contract as `post-editor-port.hooks.ts`'s `updatePost`: the row's `version` as this list last
   * loaded it, so a row action here that races a second author's edit gets `409 VERSION_CONFLICT`
   * instead of silently overwriting whatever they just saved. `togglePostPublish`
   * (`use-posts.hooks.ts`) always sends it — this is the row-menu action, not the full editor, but
   * it hits the exact same `PUT /posts/:id` route and the same shared-post race the editor already
   * guards against.
   */
  updatePost(
    required: {
      target: { id: string };
      patch: Partial<Pick<AdminPost, "title" | "slug" | "bodyJson" | "status" | "templateChoice" | "overridesThemePage">> & {
        expectedVersion?: number;
      };
    },
    optional?: Record<string, never>
  ): Promise<{ post: AdminPost }>;
  deletePost(required: { id: string }, optional?: Record<string, never>): Promise<{ post: AdminPost }>;
}
