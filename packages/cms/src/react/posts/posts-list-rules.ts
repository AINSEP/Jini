
/** One row-menu entry (structurally the host `RowMenu` component's own item type). */
export interface PostRowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "warning" | "danger";
  destructive?: boolean;
}

/** The admin post-row fields the row menu reads. */
export interface PostRowMenuPost {
  id: string;
  status: "draft" | "published";
}
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";


/**
 * @file Pure logic for the `posts` feature — everything that computes a value rather than rendering
 * one.
 *
 * Named `rules.ts` to match the convention `@jini-ai/chat` already uses for the same job
 * (`features/chat-pane/rules.ts`, `model picker rules`): the slice's decisions live in
 * one importable, directly testable module with no React in it.
 *
 * The bar for landing here is "does it compute something", not "is it rendered". A function that
 * builds a menu array is logic even though a menu is drawn from it — leaving it inside the
 * component only means the branch can be reached exclusively by rendering a table and opening a
 * popover, which is how a `post.status` conditional ends up permanently untested.
 */

/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s `TAXONOMY_RESOURCE`
 * for why this is a plain colocated constant rather than a shared registry. `content_post_create`/
 * `_update`/`_delete` (`host src/features/post/agent-tools.ts`) are agent-callable, so
 * `use-posts.hooks.ts` needs the same "an assistant write shows up without a reload" fix
 * `use-taxonomy.hooks.ts` shipped first — this is the bug this whole pass was dispatched to fix.
 */
export const POSTS_RESOURCE = "posts";

/** The callbacks a row menu needs. Passed in rather than imported so this module stays free of
 *  state and navigation, and so a test can assert exactly which one a given row wires up. */
export interface PostRowMenuHandlers<P extends PostRowMenuPost = PostRowMenuPost> {
  onEdit: (required: { post: P }, optional?: Record<string, never>) => void;
  onTogglePublish: (post: P) => void;
  onDelete: (post: P) => void;
}

/**
 * The row-action menu for one post.
 *
 * The branch is the reason this is exported: **the middle item's label and key flip with the row's
 * own status** — "Unpublish" for a published post, "Publish" for a draft — rather than either
 * omitting the item for a draft (the pre-2026-09-22 "Disable" behavior) or rendering it disabled.
 * Owner rename (2026-09-22): the old always-published-only "Disable" item did two things wrong at
 * once — it never let an operator publish a draft from this list at all (the ONLY way was opening
 * the full editor), and clicking it on a published row 500'd with "title is required" (owner
 * screenshot) because `usePosts().disablePost` sent `{ status: "draft", expectedVersion }` alone;
 * `PUT /posts/:id`'s `validateUpdatePostInput` (`features/post/post.ts`) treats a missing `title` as
 * `""` and rejects it before ever reaching the version check. `onTogglePublish` (`use-posts.hooks.ts`)
 * now sends the row's own `title`/`slug`/`bodyJson` alongside the flipped `status` — see that
 * function's own doc for the full fix.
 *
 * Both branches call the SAME handler — `onTogglePublish` reads `post.status` itself to decide which
 * way to flip, so this menu builder does not need two callbacks for what is one reversible toggle.
 *
 * "Delete" is marked `destructive` and only OPENS the confirmation; the delete itself is
 * `usePosts().removePost`, gated on `ConfirmDialog`.
 *
 * @complexity Time/space: O(1) — exactly three entries, no iteration.
 */
export function postRowMenuItems<P extends PostRowMenuPost>({ post, handlers, locale, translate }: { post: P; handlers: PostRowMenuHandlers<P>; locale: string; translate: (required: { locale: string; key: string }) => string }, _options: Record<string, never> = {}): PostRowMenuItem[] {
  const t = ({ key }: { key: string }, _options: Record<string, never> = {}): string => translate({ locale, key });
  const items: PostRowMenuItem[] = [{ key: "edit", label: t({ key: "Edit" }), onSelect: () => handlers.onEdit({ post }) }];
  items.push(
    post.status === "published"
      ? { key: "unpublish", label: t({ key: "Unpublish" }), onSelect: () => handlers.onTogglePublish(post) }
      : { key: "publish", label: t({ key: "Publish" }), onSelect: () => handlers.onTogglePublish(post) }
  );
  items.push({ key: "delete", label: t({ key: "Delete" }), destructive: true, onSelect: () => handlers.onDelete(post) });
  return items;
}

/**
 * Row-menu agent handle for every post, keyed by post id. `Posts.tsx` looks a row's handle up BY
 * ID rather than by render position, so a row keeps the same handle even after the table re-sorts
 * (`buildAgentListHandles`'s own contract derives a handle from each id's position in THIS array,
 * not the table's current render order). `null` (list not loaded yet) returns an empty map rather
 * than throwing, so the caller can memoize this unconditionally above its own loading-state early
 * return without special-casing the not-yet-loaded render.
 *
 * @complexity Time/space: O(n) in post count.
 */
export function buildPostRowMenuHandleMap({ posts }: { posts: readonly Pick<PostRowMenuPost, "id">[] | null }, _options: Record<string, never> = {}): Map<string, string> {
  if (!posts) return new Map();
  const handles = buildAgentListHandles({ prefix: "posts-row", ids: posts.map((post) => post.id) }
  );
  return new Map(posts.map((post, index) => [post.id, handles[index]!]));
}
