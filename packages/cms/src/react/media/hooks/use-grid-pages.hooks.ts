import { useCallback, useState } from "react";

import type { AdminMedia, MediaGridOrder, MediaGridPage, MediaGridTab } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { useFetchQuery as UseFetchQuery } from "@jini-ai/ui/fetch-query";

/**
 * @file The Media grid's server-paged read: page one through the shared query cache, further pages
 * and the exact deep-link lookup through the same port. Why-comment — sorting or filtering one fetched
 * page cannot reproduce a globally ordered, filtered list, so the tab, the order and the counts are
 * always the server's answer and this hook never re-sorts, re-filters or re-counts what it holds.
 */

/** Rows asked per page; the route bounds this to 1..100. */
export const GRID_PAGE_SIZE = 50;

/** The one view of the grid a request is for. */
export interface MediaGridView { tab: MediaGridTab; orderBy: MediaGridOrder }

/** One request's paging: a page size, the previous page's opaque cursor, or one exact asset. */
export interface MediaGridPageRequest { limit?: number; cursor?: string; itemId?: string }

/** The admin route a grid page is read from. */
export interface MediaGridPort {
  listMediaGrid: (view: MediaGridView, page?: MediaGridPageRequest) => Promise<MediaGridPage>;
}

/** What {@link useGridPages} needs; the query hook is injected like every other hook. */
export interface GridPagesDeps extends MediaGridView {
  port: MediaGridPort;
  listKey: readonly (string | number)[];
  useFetchQuery: typeof UseFetchQuery;
}

/** Everything the screen reads from the grid. */
export interface GridPages {
  /** Loaded rows in the server's order, or `null` until the first page one ever settles; while a new
   *  tab or order loads, the previous view's rows stay here. */
  items: AdminMedia[] | null;
  /** The deep-link asset fetched by exact lookup when it is not among the loaded rows. */
  exactItem: AdminMedia | null;
  /** Workspace-wide counts per tab from the server, never counted from loaded rows. */
  counts: MediaGridPage["counts"] | null;
  hasUntypedActive: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: Error | null;
  loadMore: () => Promise<void>;
  retryLoadMore: () => Promise<void>;
}

/** Pages after page one, valid only for the page-one answer (`base`) they were read after. */
interface MorePages { base: MediaGridPage | undefined; rows: AdminMedia[]; cursor: string | null; loading: boolean; error: Error | null }

const NO_MORE: MorePages = { base: undefined, rows: [], cursor: null, loading: false, error: null };

/** Page one plus the pages read after that same answer, each asset once. @complexity O(n) in loaded rows. */
function mergeRows({ first, more }: { first: MediaGridPage; more: MorePages | null }, _optional: Record<string, never> = {}): AdminMedia[] {
  const seen = new Set<string>();
  return [...first.media, ...(more?.rows ?? [])].filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

/** The more-pages state, only while it belongs to the page-one answer on screen. @complexity O(1). */
function currentMore({ data, state }: { data: MediaGridPage | undefined; state: MorePages }, _optional: Record<string, never> = {}): MorePages | null {
  // The one stale guard: rows and the cursor are shown only for the page-one answer they were read after,
  // so a response that lands after a tab, sort or refresh change is stored under a base nobody renders.
  return state.base === data && data !== undefined ? state : null;
}

/** Rows, cursor and deep-link presence for one render. @complexity O(n) in loaded rows. */
function deriveGridView({ data, settled, state, itemId }: { data: MediaGridPage | undefined; settled: MediaGridPage | undefined; state: MorePages; itemId: string | null }, _optional: Record<string, never> = {}) {
  // Why-comment — a new tab or order is a new cache key with no page one yet. Dropping to `null` there
  // made the screen swap to its loading state and unmount the toolbar mid-change: the Order-by select
  // the operator was using vanished, focus was lost, and a second change landed on a detached control
  // and never re-ordered anything. The last settled page stays on screen until the new one lands; it
  // never pages, since its cursor belongs to the view it was read for.
  const shown = data ?? settled;
  const more = currentMore({ data, state });
  const items = shown ? mergeRows({ first: shown, more }) : null;
  return { shown, more, items, cursor: nextCursor({ data, more }), loaded: isLoaded({ items, itemId }) };
}

/** The cursor for the next page: the more-pages cursor, else page one's own. @complexity O(1). */
function nextCursor({ data, more }: { data: MediaGridPage | undefined; more: MorePages | null }, _optional: Record<string, never> = {}): string | null {
  if (more) return more.cursor;
  return data?.nextCursor ?? null;
}

/** Whether a deep-linked asset is among the loaded rows. @complexity O(n) in loaded rows. */
function isLoaded({ items, itemId }: { items: AdminMedia[] | null; itemId: string | null }, _optional: Record<string, never> = {}): boolean {
  if (itemId === null || items === null) return false;
  return items.some((item) => item.id === itemId);
}

/** The exact lookup's asset, only for a deep link that is not among the loaded rows. @complexity O(1). */
function exactItemFor({ loaded, exactPage }: { loaded: boolean; exactPage: MediaGridPage | undefined }, _optional: Record<string, never> = {}): AdminMedia | null {
  return loaded ? null : exactPage?.media[0] ?? null;
}

/** The server-answered fields the screen reads, never counted from loaded rows. @complexity O(1). */
function summarizeGrid({ shown, more, cursor }: { shown: MediaGridPage | undefined; more: MorePages | null; cursor: string | null }, _optional: Record<string, never> = {}) {
  const pending = more ?? NO_MORE;
  return { ...pageSummary({ shown }), hasMore: cursor !== null, loadingMore: pending.loading, loadMoreError: pending.error };
}

/** Page one's server counts and untyped-MIME flag; none before page one lands. @complexity O(1). */
function pageSummary({ shown }: { shown: MediaGridPage | undefined }, _optional: Record<string, never> = {}) {
  if (!shown) return { counts: null, hasUntypedActive: false };
  return { counts: shown.counts ?? null, hasUntypedActive: shown.hasUntypedActive ?? false };
}

/**
 * Reads the grid for one tab and order: page one from the cache, `loadMore` for the next page. A page
 * that returns after the tab, the order or page one itself changed (a sort, a tab switch, a mutation
 * refresh) belongs to a view nobody is looking at and is dropped, never appended.
 * @complexity O(n) in loaded rows per render; one request per page.
 */
export function useGridPages(required: GridPagesDeps, optional: { itemId?: string | null | undefined } = {}): GridPages {
  const { port, tab, orderBy, useFetchQuery, listKey } = required;
  const itemId = optional.itemId ?? null;
  const first = useFetchQuery({ key: [...listKey, "grid", tab, orderBy], fetch: () => port.listMediaGrid({ tab, orderBy }, { limit: GRID_PAGE_SIZE }) });
  const [state, setState] = useState<MorePages>(NO_MORE);
  const [settled, setSettled] = useState<MediaGridPage | undefined>(undefined);
  if (first.data !== undefined && first.data !== settled) setSettled(first.data);
  const { shown, more, items, cursor, loaded } = deriveGridView({ data: first.data, settled, state, itemId });
  const exact = useFetchQuery(
    { key: [...listKey, "grid-item", tab, itemId ?? ""], fetch: () => port.listMediaGrid({ tab, orderBy }, { itemId: itemId ?? "" }) },
    { enabled: itemId !== null && first.data !== undefined && !loaded },
  );

  const loadMore = useCallback(async (): Promise<void> => {
    const base = first.data;
    if (!base || cursor === null || more?.loading) return;
    const rows = more?.rows ?? [];
    setState({ base, rows, cursor, loading: true, error: null });
    try {
      const page = await port.listMediaGrid({ tab, orderBy }, { limit: GRID_PAGE_SIZE, cursor });
      setState({ base, rows: [...rows, ...page.media], cursor: page.nextCursor, loading: false, error: null });
    } catch (failure) {
      setState({ base, rows, cursor, loading: false, error: failure instanceof Error ? failure : new Error("more media could not be loaded") });
    }
  }, [first.data, cursor, more, port, tab, orderBy]);

  return {
    items,
    exactItem: exactItemFor({ loaded, exactPage: exact.data }),
    ...summarizeGrid({ shown, more, cursor }),
    error: first.error,
    loadMore,
    retryLoadMore: loadMore,
  };
}
