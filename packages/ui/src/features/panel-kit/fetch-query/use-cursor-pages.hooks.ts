import { useEffect, useRef, useState } from "react";
import type { QueryKey } from "@jini-ai/core/fetch";
import { useFetchQuery } from "./binding.react.js";

/**
 * @file A list whose first page is one fetch-query keyed on the APPLIED filters, plus "Load more"
 * pages appended locally by cursor.
 *
 * The applied filters (not the draft a form edits) are the key, so typing into a filter input does not
 * reload; only `applyFilters` does, by changing the key. Load-more pages are not folded into the query
 * because a query binds one hook to one fixed key. The local pages get the same race guard the first
 * page gets for free: a load-more still in flight when new filters are applied must not append the old
 * filters' rows once it resolves, and applying new filters drops the pages of the previous set.
 */

export interface CursorPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

export interface CursorPagesRequired<Filters, Item> {
  key: (required: { filters: Filters }) => QueryKey;
  fetchPage: (required: { filters: Filters }, optional?: { cursor?: string | undefined }) => Promise<CursorPage<Item>>;
  initialFilters: Filters;
}

export interface CursorPages<Filters, Item> {
  /** `null` until the first page settles. */
  rows: Item[] | null;
  nextCursor: string | null;
  /** The first-page or load-more failure, raw; the host words it. `null` when none. */
  failure: { error: unknown } | null;
  appliedFilters: Filters;
  applyFilters: (filters: Filters) => void;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

/**
 * First page by key plus cursor-appended pages, with a stale-append guard.
 * @complexity O(rows) per render (concatenation).
 */
export function useCursorPages<Filters, Item>(
  { key, fetchPage, initialFilters }: CursorPagesRequired<Filters, Item>,
  _optional: Record<string, never> = {},
): CursorPages<Filters, Item> {
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const firstPage = useFetchQuery({ key: key({ filters: appliedFilters }), fetch: () => fetchPage({ filters: appliedFilters }) });
  const [morePages, setMorePages] = useState<Item[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [moreFailure, setMoreFailure] = useState<{ error: unknown } | null>(null);
  const filtersRef = useRef(appliedFilters);
  useEffect(() => {
    filtersRef.current = appliedFilters;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMorePages([]);
    setMoreFailure(null);
  }, [appliedFilters]);
  useEffect(() => {
    setMoreCursor(firstPage.data?.nextCursor ?? null);
  }, [firstPage.data]);

  async function loadMore() {
    if (!moreCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const filtersAtCall = appliedFilters;
    setLoadingMore(true);
    setMoreFailure(null);
    try {
      const page = await fetchPage({ filters: filtersAtCall }, { cursor: moreCursor });
      if (filtersAtCall !== filtersRef.current) return; // stale: filters changed while this was in flight
      setMorePages((prev) => [...prev, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch (error) {
      if (filtersAtCall !== filtersRef.current) return;
      setMoreFailure({ error });
    } finally {
      if (filtersAtCall === filtersRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  const rows = firstPage.data ? [...firstPage.data.items, ...morePages] : null;
  const failure = moreFailure ?? (firstPage.error ? { error: firstPage.error } : null);
  return { rows, nextCursor: moreCursor, failure, appliedFilters, applyFilters: setAppliedFilters, loadingMore, loadMore };
}
