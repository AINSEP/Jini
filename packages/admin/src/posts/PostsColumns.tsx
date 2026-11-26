import { DataTable, type DataTableColumn } from "../react/components/DataTable.js";
import { RowMenu } from "../react/components/RowMenu/RowMenu.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { formatTimestamp } from "@jini-ai/core/text";
import type { PostsProps } from "./Posts.js";
import type { PostsController } from "./hooks/use-posts.hooks.js";
import type { AdminPost } from "./api/posts-api.types.js";
import type { DataTableSortState } from "../core/data-table/types.js";

const columns: readonly ((required: Pick<PostsProps, "kit" | "deps"> & Pick<PostsController, "rowMenuHandleById" | "togglePostPublish" | "setPendingDelete"> & { locale: string; t: (key: string) => string }, optional?: Record<string, never>) => DataTableColumn<AdminPost>)[] = [
  ({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }, _optional = {}) => (
          {
            key: "title",
            header: t("Title"),
            // Sortable headers (2026-08-10, Updated only; generalized to all four 2026-09-02;
            // migrated onto `DataTable`'s own shared sort mechanism 2026-09-02) — `DataTable` now
            // renders the button, caret, and `aria-sort` itself from this descriptor; only the
            // domain-specific comparator and label wording live in `@jini-ai/admin/shell/lib/admin-post-list-sort`.
            sort: { compare: deps.sorting.compareAdminPostsByTitle, label: (direction) => deps.sorting.columnSortLabel({ t: t, columnName: t("Title"), direction: direction }) },
            cell: (post) => (
              <a
                href={deps.postAdminPath({ slug: post.slug })}
                {...agentHandle({ handle: `${rowMenuHandleById.get(post.id)}-edit` }, { role: "link", label: "Open this post's editor" })}
              >
                {post.title}
              </a>
            ),
          }
  ),
  ({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }, _optional = {}) => (
          {
            key: "slug",
            header: "Slug",
            sort: { compare: deps.sorting.compareAdminPostsBySlug, label: (direction) => deps.sorting.columnSortLabel({ t: t, columnName: t("Slug"), direction: direction }) },
            cell: (post) => (
              <a
                href={deps.siteUrl({ path: `/${post.slug}` })}
                target="_blank"
                rel="noreferrer"
                {...agentHandle({ handle: `${rowMenuHandleById.get(post.id)}-view-live` }, { role: "link", label: "Open this post on the live public site" })}
              >
                /{post.slug}
              </a>
            ),
          }
  ),
  ({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }, _optional = {}) => (
          {
            key: "status",
            header: t("Status"),
            sort: { compare: deps.sorting.compareAdminPostsByStatus, label: (direction) => deps.sorting.columnSortLabel({ t: t, columnName: t("Status"), direction: direction }) },
            cell: (post) => <span className={`status status-${post.status}`}><kit.ServerLabel value={post.status} /></span>,
          }
  ),
  ({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }, _optional = {}) => (
          {
            key: "updated",
            header: t("Updated"),
            // "desc" (newest first) is this column's own starting direction, unlike the other
            // three's ascending default — unchanged from the pre-existing Updated-only feature.
            sort: { compare: deps.sorting.compareAdminPostsByUpdated, defaultDirection: "desc", label: (direction) => deps.sorting.updatedColumnSortLabel({ t: t, direction: direction }) },
            cell: (post) => formatTimestamp({ iso: post.updatedAt }, { viewerTimeZone: deps.viewerTimeZone }),
          }
  ),
  ({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }, _optional = {}) => (
          {
            key: "actions",
            header: t("More"),
            cell: (post) => (
              <RowMenu
                triggerLabel={t('Actions for "{title}"').replace("{title}", () => post.title)}
                agentHandle={`${rowMenuHandleById.get(post.id)}-menu`}
                items={deps.postRowMenuItems({ translate: deps.translate, post: post,
                  handlers: {
                    onEdit: ({ post }, _optional = {}) => deps.navigate({ routePath: deps.postEditorRoute({ slug: post.slug }) }),
                    onTogglePublish: togglePostPublish,
                    onDelete: setPendingDelete,
                  },
                  locale: locale },
                )}
              />
            ),
          }
  ),
];

export function PostsColumns({ posts, error, creating, createPost, rowMenuHandleById, togglePostPublish, setPendingDelete, locale, t, sort, setSort, kit, deps }: Pick<PostsProps, "kit" | "deps"> &
  Pick<PostsController, "error" | "creating" | "createPost" | "rowMenuHandleById" | "togglePostPublish" | "setPendingDelete"> & {
    posts: AdminPost[]; locale: string; t: (key: string) => string;
    sort: DataTableSortState; setSort: (next: DataTableSortState) => void;
  }, _optional = {}) {
  return <>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t("Posts")}</h1>
          <p className="page-description">{t("Manage and publish every post on this site.")}</p>
        </div>
        <div className="page-actions">
          <kit.PublishSectionButton section="posts" />
          <button
            onClick={createPost}
            disabled={creating}
            {...agentHandle({ handle: "posts-new" }, { role: "button", label: "Create a new post" })}
          >
            {creating ? t("Creating…") : t("New Post")}
          </button>
        </div>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      <DataTable
        rows={posts}
        rowKey={(post) => post.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No posts yet.")}</p>
              <p className="page-description">{t("Create your first post to get started.")}</p>
            </div>
          </div>
        }
        columns={columns.map(column => column({ t, locale, rowMenuHandleById, togglePostPublish, setPendingDelete, kit, deps }))}
      />
  </>;
}
