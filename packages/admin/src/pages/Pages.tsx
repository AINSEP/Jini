import { createPagesTabSelect } from "./Pages.hooks.js";
import { DataTable, type DataTableColumn } from "../react/components/DataTable.js";
import { RowMenu } from "../react/components/RowMenu/RowMenu.js";
import { ConfirmDialog } from "../react/components/ConfirmDialog/ConfirmDialog.js";
import type { DataTableSortDirection, DataTableSortState } from "../core/data-table/types.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { useState, type ComponentType, type ReactNode } from "react";

import { adminHref, navigate } from "../shell/lib/router.js";
import { TabBar } from "../react/kit.js";
import { pageRowMenuItems } from "./pages-list-rules.js";
import type { PagesController } from "./hooks/use-pages.hooks.js";
import type { PageListRow } from "./hooks/pages-port.hooks.js";
import { resolvePagesTabFromUrl, type PagesTabId } from "./hooks/pages-tab-url.hooks.js";

import { type Translate, formatTimestamp } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../shell/lib/viewer-time-zone.js";
/**
 * @file The Pages list screen — markup only.
 *
 * State and API calls live in `hooks/use-pages.hooks.ts` (My Pages) and `hooks/use-theme-
 * pages.hooks.ts` (Theme Pages); the row-menu logic lives in `rules.ts`. What stays here is what
 * actually renders: column definitions, the empty state, and the confirm copy. The "My Pages" side
 * mirrors `features/posts/Posts.tsx` exactly, since this screen is `Posts.tsx`'s twin, backed by
 * the pages-filtered endpoints (`GET/POST .../pages`). A page is a `post` row with `kind: "page"`
 * (see `features/post/post.ts`), so it's edited through the same `PostEditor` reached via
 * `/admin/posts/{id}`.
 *
 * "Theme Pages" (2026-08-10) is a second, deliberately separate tab: the ACTIVE theme's own bundled
 * `pages/*.html` (`static` tier only — see `getPresentation()`'s `activeThemeStaticPageIds`), not
 * database rows. Kept visually and structurally apart from "My Pages" on purpose — the
 * `templateChoice`/`overridesThemePage` work elsewhere this session exists specifically so theme
 * content and an operator's own authored content read as two different things that survive a theme
 * switch independently, and merging them into one list here would blur exactly that distinction.
 * A theme page has no `PostRecord` behind it (no id, no draft/published status to speak of as a
 * database row) — its row offers a publish switch and a "see more" disclosure, not a `RowMenu`. The
 * row's own link goes to the THEME STUDIO (`/admin/themes/explore?theme=&page=`), not the live
 * site. The whole tab body — that link, the publish switch, the disclosure — now lives in its own
 * file, `ThemePagesTab.tsx` (2026-08-30, deep-link/publish-toggle pass), split out once it grew
 * past a bare read-only row link; see that file's own header.
 *
 * The active tab itself is now addressable: `?tab=themes` opens directly on Theme Pages
 * (`hooks/pages-tab-url.hooks.ts`), the same deep-link contract Theme Studio's Explore screen
 * already has for `?theme=`/`?page=`/`?file=`.
 * Now: the Theme Pages hook and tab are the host's, injected as `useThemePagesHook` +
 * `ThemePagesTab`; this screen reads only `pageCount` from it, for the tab badge. The row-menu
 * logic is `pages-list-rules.ts`. Wiring: see `README.md` (`## Wiring`) in this folder.
 */

/** The only field of the host's Theme Pages controller this screen reads itself (the tab count);
 *  everything else is handed back, untouched, to the host's own {@link PagesProps.ThemePagesTab}. */
export interface PagesThemeTabController {
  pageCount: number;
}

/** The host's per-column comparators and accessible sort labels (shared with its Posts list, so
 *  they stay a host rule) plus the list's starting sort. */
export interface PagesListSorting<Row extends PageListRow> {
  defaultSort: DataTableSortState;
  compareByTitle: (a: Row, b: Row) => number;
  compareBySlug: (a: Row, b: Row) => number;
  compareByStatus: (a: Row, b: Row) => number;
  compareByUpdated: (a: Row, b: Row) => number;
  columnSortLabel: (required: { t: Translate; columnName: string; direction: DataTableSortDirection | null }) => string;
  updatedColumnSortLabel: (required: { t: Translate; direction: DataTableSortDirection | null }) => string;
}

/** The host's page link rules: the admin editor route path (slug-vs-id, shared with the page
 *  editor), the public path (root slug `"/"` stays `"/"`), and the public-site URL builder. */
export interface PagesListPaths {
  pageAdminPath: (page: Pick<PageListRow, "id" | "slug">) => string;
  pagePublicPath: (required: { slug: string }) => string;
  siteUrl: (required: { path: string }) => string;
}

export interface PagesProps<Row extends PageListRow, Theme extends PagesThemeTabController> {
  /** The host's bound "My Pages" hook — typically `usePages` from `hooks/use-pages.hooks.ts` wired
   *  to the real port. A test supplies a stub and drives every state directly. */
  usePagesHook: () => PagesController<Row>;
  /** The host's Theme Pages data hook (themes stay with the host). */
  useThemePagesHook: () => Theme;
  /** The host's Theme Pages tab body, handed the controller {@link useThemePagesHook} returned. */
  ThemePagesTab: ComponentType<{ controller: Theme; t: Translate }>;
  /** The host's "publish this section" header action. */
  PublishSectionButton: ComponentType<{ section: "pages" }>;
  /** The host's localized label for a server status value (`draft`/`published`). */
  ServerLabel: ComponentType<{ value: string }>;
  sorting: PagesListSorting<Row>;
  paths: PagesListPaths;
}

/**
 * The loading/error guard shown before the table has anything to render — pulled out of `Pages`
 * (2026-08-06, complexity pass, fourth pass) so its two early-return checks collapse into one
 * `if` at the call site. `error && !pages` (not just `error`), matching Media.tsx and `@jini-ai/admin/comments/react`:
 * once the list has loaded, a later failure (create, delete) surfaces as an inline banner above
 * the table instead of blanking out the whole screen behind it. Mirrors `Posts.tsx`'s identical
 * `postsListNotice`, matching this pair's existing "twin screens" convention (this file's own
 * header).
 */
export function pagesListNotice({ pages, error, t }: { pages: readonly PageListRow[] | null; error: string | null; t: Translate }, _options = {}): ReactNode {
  if (error && !pages) return <div className="notice error">{error}</div>;
  if (!pages) return <div className="notice">{t("Loading pages…")}</div>;
  return null;
}

export function Pages<Row extends PageListRow, Theme extends PagesThemeTabController>(props: PagesProps<Row, Theme>) {
  const { ThemePagesTab, PublishSectionButton, sorting } = props;
  const {
    pages,
    error,
    creating,
    rowSavingId,
    pendingDelete,
    setPendingDelete,
    createPage,
    togglePagePublish,
    removePage,
    t,
    locale,
    rowMenuHandleById,
  } = props.usePagesHook();
  const themePages = props.useThemePagesHook();
  // Owner ruling (2026-08-14): pure interactive DOM-chrome state — which tab is showing, no I/O
  // behind it — stays LOCAL rather than moving into `use-pages.hooks.ts`, unlike every other piece
  // of state on this screen. The line to draw: async/API/data state always moves into the hook;
  // view-only chrome (active tab, expanded/collapsed, dialog open, sort direction) stays here
  // UNLESS a test needs to observe it — see `Posts.tsx`'s identical `sort` state, the canonical
  // example this mirrors. Initialized from `?tab=` (`resolvePagesTabFromUrl`) rather than a fixed
  // `"mine"`, so a deep link opens directly on the right tab; read once, matching `useState`'s own
  // lazy-initializer contract — this must NOT re-resolve on every render, or a later in-page
  // `writePagesTabToUrl` call would immediately fight with it.
  const [activeTab, setActiveTab] = useState<PagesTabId>(() => resolvePagesTabFromUrl({}));
  // Same "My Pages" sort state as `Posts.tsx`'s `sort` (2026-09-02, multi-column sort pass; migrated
  // onto `DataTable`'s own shared sort mechanism the same day) — one active column at a time, local
  // chrome state per the same owner ruling above, passed straight through as `sort`/`onSortChange`.
  const [sort, setSort] = useState<DataTableSortState>(sorting.defaultSort);

  const selectTab = createPagesTabSelect({ setActiveTab });

  // `pagesListNotice` answers non-null exactly when `pages` is null, so gating on `!pages` returns
  // that notice AND keeps TS's narrowing, so `rows={pages}` below type-checks as `AdminPost[]`
  // without an `as`/`!` assertion. (The earlier `if (notice) return notice; if (!pages) return null;`
  // pair restored that narrowing with a second `!pages` check that was unreachable in practice.)
  // Now: the rows type is the generic `Row[]`.
  if (!pages) return pagesListNotice({ pages, error, t });

  return (
    <div className="page">
      <PagesHeader t={t} activeTab={activeTab} creating={creating} createPage={createPage} PublishSectionButton={PublishSectionButton} />
      <TabBar
        ariaLabel={t("Pages")}
        tabs={[
          { id: "mine", label: t("My Pages"), count: pages.length, handle: "pages-tab-mine", handleLabel: "Switch to My Pages" },
          { id: "theme", label: t("Theme Pages"), count: themePages.pageCount, handle: "pages-tab-theme", handleLabel: "Switch to Theme Pages" },
        ]}
        activeId={activeTab}
        onChange={(id) => selectTab(id as PagesTabId)}
        containerHandle="pages-tab-bar"
      />
      {activeTab === "mine" ? (
        <PagesMineTab
          pages={pages}
          error={error}
          t={t}
          sort={sort}
          setSort={setSort}
          columns={pagesListColumns({ props, t, locale, rowMenuHandleById, togglePagePublish, setPendingDelete })}
        />
      ) : (
        <ThemePagesTab controller={themePages} t={t} />
      )}
      <PagesDeleteConfirm t={t} pendingDelete={pendingDelete} rowSavingId={rowSavingId} removePage={removePage} setPendingDelete={setPendingDelete} />
    </div>
  );
}

/** The page header: kicker/title/description plus the host's publish action and, on "My Pages"
 *  only, "New Page". Split out of `Pages` for the function-size budget; markup unchanged. */
function PagesHeader(
  { t, activeTab, creating, createPage, PublishSectionButton }:
    { t: Translate; activeTab: PagesTabId; creating: boolean; createPage: () => Promise<void>; PublishSectionButton: ComponentType<{ section: "pages" }> }
) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <p className="page-kicker">{t("Content")}</p>
        <h1 className="page-title">{t("Pages")}</h1>
        <p className="page-description">{t("Manage every standalone page on this site.")}</p>
      </div>
      <div className="page-actions">
        <PublishSectionButton section="pages" />
        {activeTab === "mine" ? (
          <button
            onClick={createPage}
            disabled={creating}
            {...agentHandle({ handle: "pages-new" }, { role: "button", label: "Create a new page" })}
          >
            {creating ? t("Creating…") : t("New Page")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "My Pages": the inline post-load error banner above the sortable table (see
 *  {@link pagesListNotice} for why a later failure is a banner, not a blank screen). */
function PagesMineTab<Row extends PageListRow>(
  { pages, error, t, sort, setSort, columns }:
    { pages: Row[]; error: string | null; t: Translate; sort: DataTableSortState; setSort: (next: DataTableSortState) => void; columns: DataTableColumn<Row>[] }
) {
  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}
      <DataTable
        rows={pages}
        rowKey={(page) => page.id}
        sort={sort}
        onSortChange={setSort}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No pages yet.")}</p>
              <p className="page-description">{t("Create your first page to get started.")}</p>
            </div>
          </div>
        }
        columns={columns}
      />
    </>
  );
}

/** The soft-delete confirmation — stays mounted unconditionally (see `ConfirmDialog`'s own doc);
 *  `pendingDelete` drives `open`, and `pending` is THIS row's in-flight delete. */
function PagesDeleteConfirm<Row extends PageListRow>(
  { t, pendingDelete, rowSavingId, removePage, setPendingDelete }:
    { t: Translate } & Pick<PagesController<Row>, "pendingDelete" | "rowSavingId" | "removePage" | "setPendingDelete">
) {
  return (
    <ConfirmDialog
      open={pendingDelete !== null}
      agentHandle="pages-delete"
      title={t("Move to trash?")}
      body={
        pendingDelete ? (
          <p>
            {t("Move")} &quot;{pendingDelete.title}&quot; {t("to trash? It will disappear from the site and from this list.")}
          </p>
        ) : null
      }
      confirmLabel={t("Move to trash")}
      destructive
      pending={pendingDelete !== null && rowSavingId === pendingDelete.id}
      onConfirm={removePage}
      onCancel={() => setPendingDelete(null)}
    />
  );
}

/**
 * "My Pages"' column definitions — split out of `Pages` only to keep that function inside the
 * size budget once the host's sorting/paths/label seams became props; the cells are unchanged.
 */
type PagesColumnsInput<Row extends PageListRow, Theme extends PagesThemeTabController> =
  { props: PagesProps<Row, Theme>; t: Translate } & Pick<PagesController<Row>, "locale" | "rowMenuHandleById" | "togglePagePublish" | "setPendingDelete">;

function pagesListColumns<Row extends PageListRow, Theme extends PagesThemeTabController>(
  input: PagesColumnsInput<Row, Theme>,
  _options = {}
): DataTableColumn<Row>[] {
  return [...pagesLinkColumns(input), ...pagesRowStateColumns(input)];
}

/** Title (admin editor link) and Slug (public site link). */
function pagesLinkColumns<Row extends PageListRow, Theme extends PagesThemeTabController>(
  { props, t, rowMenuHandleById }: PagesColumnsInput<Row, Theme>,
  _options = {}
): DataTableColumn<Row>[] {
  const { sorting, paths } = props;
  const { pageAdminPath, pagePublicPath, siteUrl } = paths;
  return [
    {
      key: "title",
      header: t("Title"),
      // Sortable headers (2026-09-02, ported from `Posts.tsx`'s identical block; migrated
      // onto `DataTable`'s own shared sort mechanism the same day) — `DataTable` now
      // renders the button, caret, and `aria-sort` itself from this descriptor; only the
      // domain-specific comparator and label wording live in `lib/admin-post-list-sort.ts`.
      // Now: the comparator and label wording are the host's list-sort rules.
      sort: { compare: sorting.compareByTitle, label: (direction: DataTableSortDirection | null) => sorting.columnSortLabel({ t, columnName: t("Title"), direction }) },
      // The admin editor route (`panels.tsx`'s `/:slug` pattern) is one path segment, so a
      // Page holding the root slug `"/"` (`pagePublicPath`'s own doc) can't be expressed in
      // slug form at all — `pageAdminPath` (`rules.ts`) picks slug-vs-id per page so this
      // link reads as a slug for every ordinary page and falls back to the id only for that
      // one. `adminHref` (`lib/router.ts`) turns the bare route path into a real `<a href>`.
      // Now: `pageAdminPath` is a host rule and `adminHref` is `shell/lib/router.ts`.
      cell: (page: Row) => (
        <a
          href={adminHref({ routePath: pageAdminPath(page) })}
          {...agentHandle({ handle: `${rowMenuHandleById.get(page.id)}-edit` }, { role: "link", label: "Open this page's editor" })}
        >
          {page.title}
        </a>
      ),
    },
    {
      key: "slug",
      header: "Slug",
      sort: { compare: sorting.compareBySlug, label: (direction: DataTableSortDirection | null) => sorting.columnSortLabel({ t, columnName: t("Slug"), direction }) },
      // The public site link and its visible text both go through `pagePublicPath` so the
      // root-slug page reads "/" — a bare `/${page.slug}` template would render "//" and
      // link nowhere real for that one page.
      cell: (page: Row) => (
        <a
          href={siteUrl({ path: pagePublicPath({ slug: page.slug }) })}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: `${rowMenuHandleById.get(page.id)}-view-live` }, { role: "link", label: "Open this page on the live public site" })}
        >
          {pagePublicPath({ slug: page.slug })}
        </a>
      ),
    },
  ];
}

/** Status, Updated and the per-row actions menu. */
function pagesRowStateColumns<Row extends PageListRow, Theme extends PagesThemeTabController>(
  { props, t, locale, rowMenuHandleById, togglePagePublish, setPendingDelete }: PagesColumnsInput<Row, Theme>,
  _options = {}
): DataTableColumn<Row>[] {
  const { ServerLabel, sorting, paths } = props;
  const { pageAdminPath } = paths;
  return [
    {
      key: "status",
      header: t("Status"),
      sort: { compare: sorting.compareByStatus, label: (direction: DataTableSortDirection | null) => sorting.columnSortLabel({ t, columnName: t("Status"), direction }) },
      cell: (page: Row) => <span className={`status status-${page.status}`}><ServerLabel value={page.status} /></span>,
    },
    {
      key: "updated",
      header: t("Updated"),
      // "desc" (newest first) is this column's own starting direction, unlike the other
      // three's ascending default — unchanged from the pre-existing Updated-only feature.
      sort: { compare: sorting.compareByUpdated, defaultDirection: "desc" as const, label: (direction: DataTableSortDirection | null) => sorting.updatedColumnSortLabel({ t, direction }) },
      cell: (page: Row) => formatTimestamp({ iso: page.updatedAt }, { viewerTimeZone: VIEWER_TIME_ZONE }),
    },
    {
      key: "actions",
      header: t("More"),
      cell: (page: Row) => (
        <RowMenu
          triggerLabel={t('Actions for "{title}"').replace("{title}", () => page.title)}
          agentHandle={`${rowMenuHandleById.get(page.id)}-menu`}
          items={pageRowMenuItems({
            page,
            handlers: {
              // Same `pageAdminPath` slug-vs-id reasoning as the Title column's own edit
              // link above; `navigate` takes the bare route path directly.
              onEdit: ({ page }, _options = {}) => navigate({ routePath: pageAdminPath(page) }),
              onTogglePublish: togglePagePublish,
              onDelete: setPendingDelete,
            },
            locale,
          })}
        />
      ),
    },
  ];
}
