import type { DataTableSortDirection, DataTableSortState } from "../../core/index.js";

import type { AdminPost } from "../../posts/api/posts-api.types.js";

import { type Translate } from '@jini-ai/core/text';
// Historical column-sort section headers from the two former rules files:
// ---------------------------------------------------------------------------
// Column sort (2026-09-02) — mirrors `features/posts/rules.ts`'s own column-sort block exactly, same
// "twin screens" convention as the rest of this file (this file's own header). "My Pages" had no
// sort code at all before this pass; migrated onto `DataTable`'s own shared sort mechanism the same
// day this landed, so it never shipped its own hand-rolled dispatcher/caret/next-state logic — see
// `posts/rules.ts`'s identical section for the full rationale. Only the domain-specific pieces live
// here: each column's ascending comparator, the Updated column's non-default starting direction, and
// every column's accessible-name phrasing.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Column sort (2026-08-10, Updated only; generalized to Title/Slug/Status 2026-09-02; migrated onto
// `DataTable`'s own shared sort mechanism 2026-09-02) — `Posts.tsx` used to hand-roll its own sort
// dispatcher, header-click transition, caret glyph, and accessible-name plumbing because `DataTable`
// had nowhere to put any of that (see that component's own file header, `@jini-ai/admin`). Now that
// `DataTable` owns all of it generically via `DataTableColumn.sort`/`DataTableProps.sort`/
// `onSortChange`, only the genuinely domain-specific pieces stay here: each column's ascending
// comparator, the Updated column's non-default starting direction, and every column's
// accessible-name phrasing. One active column at a time — the owner did not ask for multi-column
// sort, and `DataTable` itself enforces that.
// ---------------------------------------------------------------------------
// Shared by Pages.tsx and Posts.tsx (twin screens).

/** Updated newest first matches both lists' original default, so sorting more columns does not
 *  change the first view and switching screens keeps a consistent starting order. */
export const DEFAULT_ADMIN_POST_SORT: DataTableSortState = { column: "updated", direction: "desc" };

/** `status` is exactly `"draft" | "published"`, so alphabetical order equals domain order without
 *  a rank table. Comparators are ascending only: DataTable negates them for descending. */
export function compareAdminPostsByTitle(a: AdminPost, b: AdminPost): number {
  return a.title.localeCompare(b.title);
}

/** @see compareAdminPostsByTitle — same contract, compared on `slug` instead of `title`. */
export function compareAdminPostsBySlug(a: AdminPost, b: AdminPost): number {
  return a.slug.localeCompare(b.slug);
}

/** @see compareAdminPostsByTitle — same contract, compared on `status` instead of `title`. */
export function compareAdminPostsByStatus(a: AdminPost, b: AdminPost): number {
  return a.status.localeCompare(b.status);
}

/**
 * Ascending is oldest first; DataTable negates this for descending, and Updated's first click
 * starts newest first, unlike the other columns' natural A-to-Z first read.
 * The server's `listPosts` has no `ORDER BY` today (PostSqliteRepo.list scans the table), so this
 * comparator actually produces most-recent-first order. Date.parse is necessary because the
 * ISO-8601 text may have a non-Z UTC offset that string-sorts incorrectly against Z-form values.
 */
export function compareAdminPostsByUpdated(a: AdminPost, b: AdminPost): number {
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
}

/**
 * Accessible lexicographic-sort label: says the current state and next action instead of relying on
 * the aria-hidden caret. Direction is null when a different column is active; DataTable resolves it.
 * The caller supplies the translated column name and translator. A browser sweep on 2026-09-22
 * found Posts returning an untranslated template while Pages translated it; both now share this rule.
 * Historically Pages used fixed English labels regardless of admin locale.
 * @complexity Time/space: O(1).
 */
export function columnSortLabel({ t, columnName, direction }: { t: Translate; columnName: string; direction: DataTableSortDirection | null }, _optional: Record<string, never> = {}): string {
  if (direction === null) return t("Not sorted by {columnName}. Activate to sort ascending.").replace("{columnName}", () => columnName);
  return direction === "asc"
    ? t("Sorted by {columnName}, ascending. Activate to sort descending.").replace("{columnName}", () => columnName)
    : t("Sorted by {columnName}, descending. Activate to sort ascending.").replace("{columnName}", () => columnName);
}

/** Same contract as {@link columnSortLabel}, using Updated's newest/oldest vocabulary. */
export function updatedColumnSortLabel({ t, direction }: { t: Translate; direction: DataTableSortDirection | null }, _optional: Record<string, never> = {}): string {
  if (direction === null) return t("Not sorted by updated date. Activate to sort newest first.");
  return direction === "desc"
    ? t("Sorted by updated date, newest first. Activate to sort oldest first.")
    : t("Sorted by updated date, oldest first. Activate to sort newest first.");
}
