import type { RowMenuItem } from "../react/components/RowMenu/RowMenu.js";

import { buildAgentListHandles } from "@jini-ai/core/agent-handles";

import { t as translate } from "./pages-i18n.js";
import type { PageListRow } from "./hooks/pages-port.hooks.js";

/**
 * @file Pure logic used ONLY by the Pages list screen (`Pages.tsx` + `hooks/use-pages.hooks.ts`) —
 * everything that computes a value rather than rendering one. Split out of the host's shared pages
 * `rules.ts`, which keeps every helper the page editor and the Theme Pages tab also read (the
 * slug-vs-id admin path, the public path, the content-refresh resource name); those reach this
 * package as injected values instead.
 *
 * Mirrors the Posts list's own rules exactly, since `Pages.tsx` is the Posts list's twin (same
 * `RowMenu`-building logic, same Publish/Unpublish status-flip rule) backed by the pages-filtered
 * endpoints.
 * The bar for landing here is "does it compute something", not "is it rendered" — `pageRowMenuItems`
 * was a closure inside a `DataTable` cell, reachable only by rendering a table and opening a
 * popover, which is how its `page.status` conditional ended up permanently untested.
 */

/** The callbacks a row menu needs. Passed in rather than imported so this module stays free of
 *  state and navigation, and so a test can assert exactly which one a given row wires up — same
 *  shape as `posts/rules.ts`'s `PostRowMenuHandlers`. */
export interface PageRowMenuHandlers<Row extends PageListRow = PageListRow> {
  onEdit: (required: { page: Row }) => void;
  onTogglePublish: (page: Row) => void;
  onDelete: (page: Row) => void;
}

/**
 * The row-action menu for one page.
 *
 * The branch is the reason this is exported: **the middle item's label and key flip with the row's
 * own status** — "Unpublish" for a published page, "Publish" for a draft — same deliberate rename
 * `posts/rules.ts`'s `postRowMenuItems` got (owner request, 2026-09-22), replacing the old rule
 * that omitted the item entirely for a draft rather than rendering it disabled. See that function's
 * own doc for the full "why" — a status-only payload sent by the old "Disable" item, always
 * missing `title`/`slug`, was rejected by `PUT /posts/:id` with "title is required" (owner
 * screenshot) before the row's status could ever change, and a draft page had no way to publish
 * from this list at all.
 *
 * Both branches call the SAME handler — `onTogglePublish` reads `page.status` itself to decide
 * which way to flip, so this menu builder does not need two callbacks for what is one reversible
 * toggle.
 *
 * "Delete" is marked `destructive` and only OPENS the confirmation; the delete itself is
 * `usePages().removePage`, gated on `ConfirmDialog`.
 *
 * @complexity Time/space: O(1) — exactly three entries, no iteration.
 * @overallScore 100
 */
export function pageRowMenuItems<Row extends PageListRow>({ page, handlers, locale }: { page: Row; handlers: PageRowMenuHandlers<Row>; locale: string }, _options = {}): RowMenuItem[] {
  const t = ({ key }: { key: string }, _options = {}): string => translate({ locale: locale, key: key });
  const items: RowMenuItem[] = [{ key: "edit", label: t({ key: "Edit" }), onSelect: () => handlers.onEdit({ page }) }];
  items.push(
    page.status === "published"
      ? { key: "unpublish", label: t({ key: "Unpublish" }), onSelect: () => handlers.onTogglePublish(page) }
      : { key: "publish", label: t({ key: "Publish" }), onSelect: () => handlers.onTogglePublish(page) }
  );
  items.push({ key: "delete", label: t({ key: "Delete" }), destructive: true, onSelect: () => handlers.onDelete(page) });
  return items;
}

/**
 * Row-menu agent handle for every page, keyed by page id. `Pages.tsx` looks a row's handle up BY
 * ID rather than by render position — mirrors `posts/rules.ts`'s `buildPostRowMenuHandleMap`
 * verbatim, for the reason that function's own doc gives and that this screen learned the hard way
 * (2026-09-07 audit claim #2): `DataTable` sorts `rows` internally and passes each `cell` callback
 * the index into that SORTED order, while the handle array is built from the unsorted `pages` prop,
 * so any row whose sort position differed from its array position published another page's handle.
 *
 * `null` (list not loaded yet) returns an empty map rather than throwing, so the caller can memoize
 * this unconditionally above its own loading-state early return.
 *
 * @complexity Time/space: O(n) in page count.
 */
export function buildPageRowMenuHandleMap({ pages }: { pages: readonly Pick<PageListRow, "id">[] | null }, _options = {}): Map<string, string> {
  if (!pages) return new Map();
  const handles = buildAgentListHandles({ prefix: "pages-row", ids: pages.map((page) => page.id) }
  );
  // `buildAgentListHandles` returns exactly one handle per id, in order, so `handles[index]` is
  // always present; the `!` only satisfies `noUncheckedIndexedAccess` (same as the comments queue).
  return new Map(pages.map((page, index) => [page.id, handles[index]!]));
}
