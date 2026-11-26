import { useState, type ComponentType, type ReactNode } from "react";
import type { AdminPost } from "./api/posts-api.types.js";
import type { PostsController } from "./hooks/use-posts.hooks.js";
import type { RowMenuItem } from "../react/components/RowMenu/RowMenu.js";
import type { DataTableSortState } from "../core/data-table/types.js";
import { createPostsTranslator } from "./Posts.hooks.js";
import { PostsColumns } from "./PostsColumns.js";
import { PostsTrashConfirm } from "./PostsTrashConfirm.js";

/**
 * @file The Posts list screen — markup only.
 *
 * State and API calls live in `hooks/use-posts.hooks.ts`; the row-menu logic lives in `rules.ts`.
 * What stays here is what actually renders: column definitions, the empty state, and the confirm
 * copy.
 */
export interface PostsProps {
  hooks: { usePostsHook: (required: Record<string, never>, optional?: Record<string, never>) => PostsController; useLocaleHook: () => string };
  kit: {
    ServerLabel: ComponentType<{ value: string }>;
    PublishSectionButton: ComponentType<{ section: "posts" }>;
  };
  deps: {
    sorting: Pick<typeof import("../shell/lib/admin-post-list-sort.js"), "DEFAULT_ADMIN_POST_SORT" | "compareAdminPostsByTitle" | "compareAdminPostsBySlug" | "compareAdminPostsByStatus" | "compareAdminPostsByUpdated" | "columnSortLabel" | "updatedColumnSortLabel">;
    translate: (required: { locale: string; key: string }) => string;
    siteUrl: (required: { path: string }) => string;
    postAdminPath: (required: { slug: string }) => string;
    postEditorRoute: (required: { slug: string }) => string;
    navigate: (required: { routePath: string }) => void;
    postRowMenuItems: (required: { translate: PostsProps["deps"]["translate"]; post: AdminPost; handlers: {
      onEdit: (required: { post: AdminPost }, optional?: Record<string, never>) => void;
      onTogglePublish: PostsController["togglePostPublish"]; onDelete: PostsController["setPendingDelete"];
    }; locale: string }) => RowMenuItem[];
    viewerTimeZone: string;
  };
}

/**
 * The loading/error guard shown before the table has anything to render — pulled out of `Posts`
 * (2026-08-06, complexity pass, fourth pass) so its two early-return checks collapse into one
 * `if` at the call site. `error && !posts` (not just `error`): once the list has loaded, a later
 * failure (create, delete) surfaces as an inline banner above the table instead of blanking the
 * whole screen — matches Pages.tsx/Media.tsx and `@jini-ai/admin/comments/react`. Mirrors `Pages.tsx`'s identical
 * `pagesListNotice`.
 */
export function postsListNotice({ posts, error, t }: { posts: AdminPost[] | null; error: string | null; t: (key: string) => string }, _optional = {}): ReactNode {
  if (error && !posts) return <div className="notice error">{error}</div>;
  if (!posts) return <div className="notice">{t("Loading posts…")}</div>;
  return null;
}

  // Owner ruling (2026-08-14): pure interactive DOM-chrome state — a client-side sort toggle with
  // no I/O behind it — stays LOCAL rather than moving into `use-posts.hooks.ts`, unlike every other
  // piece of state on this screen. The line to draw: async/API/data state always moves into the
  // hook; view-only chrome (active tab, expanded/collapsed, dialog open, sort direction) stays here
  // UNLESS a test needs to observe it. `Posts.tsx` is the file everyone else copies this pattern
  // from (this file's own `PostsProps` doc comment) — this is the canonical example of the
  // exception, not an oversight to "finish" later.
  //
  // 2026-09-02: generalized from a single Updated-only direction to `DataTableSortState`, which
  // also names the active column — Title/Slug/Status became sortable too — and only one column is
  // ever active at a time. Migrated onto `DataTable`'s own shared sort mechanism the same day: this
  // state and its setter are now passed straight through as `sort`/`onSortChange` below, and
  // `DataTable` itself applies each column's comparator, computes the next click's state, and
  // renders the caret/`aria-sort` — see `@jini-ai/admin/shell/lib/admin-post-list-sort` for what's left here.
export function Posts({ hooks, kit, deps }: PostsProps, _optional = {}) {
  const {
    posts,
    error,
    creating,
    rowSavingId,
    pendingDelete,
    setPendingDelete,
    createPost,
    togglePostPublish,
    removePost,
    rowMenuHandleById,
  } = hooks.usePostsHook({});
  const locale = hooks.useLocaleHook();
  const t = createPostsTranslator({ locale, translate: deps.translate });
  const [sort, setSort] = useState<DataTableSortState>(deps.sorting.DEFAULT_ADMIN_POST_SORT);

  // `postsListNotice` answers non-null exactly when `posts` is null, so gating on `!posts` returns
  // that notice AND keeps TS's narrowing, so `rows={posts}` below type-checks as `AdminPost[]`
  // without an `as`/`!` assertion. (The earlier `if (notice) return notice; if (!posts) return null;`
  // pair restored that narrowing with a second `!posts` check that was unreachable in practice.)
  if (!posts) return postsListNotice({ posts, error, t });

  return (
    <div className="page">
      <PostsColumns posts={posts} error={error} creating={creating} createPost={createPost}
        rowMenuHandleById={rowMenuHandleById} togglePostPublish={togglePostPublish} setPendingDelete={setPendingDelete}
        locale={locale} t={t} sort={sort} setSort={setSort} kit={kit} deps={deps} />
      <PostsTrashConfirm pendingDelete={pendingDelete} rowSavingId={rowSavingId} removePost={removePost} setPendingDelete={setPendingDelete} t={t} />
    </div>
  );
}

export function bindPosts({ hooks, kit, deps }: PostsProps, _optional = {}) {
  return function BoundPosts({ usePostsHook = hooks.usePostsHook, hooks: overrides }: {
    usePostsHook?: PostsProps["hooks"]["usePostsHook"]; hooks?: { useWiredAdminLocale: PostsProps["hooks"]["useLocaleHook"] };
  }, _optional = {}) {
    return <Posts kit={kit} deps={deps} hooks={{ usePostsHook, useLocaleHook: overrides?.useWiredAdminLocale ?? hooks.useLocaleHook }} />;
  };
}
