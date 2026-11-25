import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AdminTrashItemDto } from "@jini-ai/core/contracts/site/cms-trash";
import { useFetchQuery, useInvalidate, useSettlementGeneration } from "../../../react/kit.js";
import { useContentRefreshSubscription } from "../../../shell/hooks/use-content-refresh-subscription.hooks.js";
import {
  allVisibleSelected,
  describePurgeReport,
  describeRestoreReport,
  KEYS,
  selectionAfterSelectAll,
  toggleSelection,
  TRASH_RESOURCE,
} from "../rules.js";
import type { TrashPort } from "./trash-port.hooks.js";
import type { Translate } from "@jini-ai/core/text";

/**
 * @file All of the Trash screen's state. `Trash.tsx` is markup only.
 *
 * Page 1 is one `useFetchQuery` keyed on `KEYS.list()`; "Load more" pages accumulate locally, for
 * the same reason `use-comment-queue.hooks.ts` and `use-form-submissions.hooks.ts` keep theirs
 * local (one hook, one FIXED key — a cursor-appended list is exactly the shape that convention
 * warns against faking).
 *
 * `useContentRefreshSubscription` is not optional here. Four agent tools and four admin delete
 * paths write trash rows, so without it an operator who asks the assistant to delete a post sees
 * this screen keep reporting an empty Trash. There is no draft state to protect — the only local
 * state is a checkbox selection, and the selection is reconciled against the refreshed rows rather
 * than cleared (see `visibleItems`'s effect below), so a background refresh cannot make a
 * "Delete permanently" click act on a row that is no longer on screen.
 *
 * Because a background refresh (not just this screen's own `reloadAfterAction`) can refetch page 1
 * at any time, a `loadMore` still in flight when that happens must not land its page on top of the
 * fresh page 1 — same race `use-comment-queue.hooks.ts` and `use-form-submissions.hooks.ts` guard
 * with `pageSettlement` (`useSettlementGeneration`, same primitive and shape here): `resetMorePages`
 * mints a fresh generation on every reset, superseding any older in-flight page fetch, and a
 * synchronous `loadingMoreRef` lock covers a same-tick double `loadMore` (2026-09-21).
 *
 * `actorUsernames` (2026-09-21) is a second, independent `useFetchQuery` (`port.listUsers()`) that
 * resolves `actorPrincipalId -> username` for `rules.ts`'s `actorLabel`, so a row from an older
 * server (one that predates the `actorUsername` field entirely) can still read a real name instead
 * of "Unknown" — the owner's own desktop-app server was exactly that case. Deliberately NOT wired
 * into `error`/`reloadAfterAction`: a workspace member without `user.manage`/`member.manage` gets a
 * 403 here, and that must degrade the actor column, never surface as a Trash-screen failure or block
 * the row list from loading.
 */

export interface TrashController {
  /** `null` until the first page settles. */
  items: AdminTrashItemDto[] | null;
  nextCursor: string | null;
  loadingMore: boolean;
  loadMore: () => void;
  error: string | null;
  /** One-line result of the last restore/purge. */
  notice: string | null;
  busy: boolean;

  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  allSelected: boolean;

  onRestoreSelected: () => Promise<void>;
  /** Open when the confirm modal is asking about the current selection. */
  purgeConfirmOpen: boolean;
  setPurgeConfirmOpen: Dispatch<SetStateAction<boolean>>;
  onPurgeConfirmed: () => Promise<void>;

  /** The Refresh button's gesture — an imperative re-read regardless of freshness. */
  refresh: () => void;
  /** True while a refresh (including the initial load) is in flight — drives "Refreshing…". */
  refreshing: boolean;

  /**
   * `actorPrincipalId -> username`, for `rules.ts`'s `actorLabel` to resolve a row whose
   * `actorUsername` the server omitted entirely (an older server build). Empty when the port carries
   * no `listUsers` method, the call is still in flight, or it failed (2026-09-21) — `actorLabel`
   * already degrades to "Unknown" for an id this map cannot explain, so an empty map here is a safe
   * default, not a special case `Trash.tsx` needs to branch on.
   */
  actorUsernames: ReadonlyMap<string, string>;

  locale: string;
  /** The host's Trash dictionary lookup — the screen renders every label through it. */
  t: TrashT;
}

/** The host's Trash dictionary lookup (host copy fallback included). */
export type TrashT = (required: { locale: string; key: string }, optional?: Record<string, never>) => string;

export interface TrashDependencies {
  port: TrashPort;
  locale: string;
  /** The host's Trash dictionary lookup. */
  t: TrashT;
  /** The load-failure sentence (a timeout gets its own copy that names the product, so the host owns it). */
  describeLoadError: (required: { error: unknown; locale: string }, optional?: Record<string, never>) => string;
  /** The host's request-error describer (its own error class is unknown to this package). */
  describeApiError: (required: { e: unknown; fallback: string }, optional?: Record<string, never>) => string;
}

export function useTrash(deps: TrashDependencies): TrashController {
  const { port, locale, t, describeLoadError, describeApiError } = deps;
  const translate: Translate = (key: string): string => t({ locale, key });
  const invalidate = useInvalidate();

  // Stable identity so the subscription effect does not resubscribe every render.
  const invalidateList = useCallback(() => invalidate({ key: KEYS.listRoot }), [invalidate]);
  useContentRefreshSubscription({ resource: TRASH_RESOURCE, onRefresh: invalidateList });

  // `staleTime: 0` + `refetchOnWindowFocus: true` (2026-09-21, forms plan §C): deletes can
  // originate from ANY admin screen, the assistant, or a second desktop instance, so there is no
  // single write path to invalidate this key from — always revalidating on mount/focus is cheaper
  // than being wrong. First per-query `staleTime` user in this app.
  const firstPage = useFetchQuery({
    key: KEYS.list(),
    fetch: () => port.listTrash({}),
  }, {
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Loaded once per Trash view, entirely independent of `firstPage` — its failure (missing
  // `user.manage`/`member.manage`) must never surface as a Trash-screen error, and its data must
  // never gate the row list. `enabled: false` when the port carries no `listUsers` at all, rather
  // than calling a method that might not exist.
  const usersQuery = useFetchQuery({
    key: KEYS.actorUsernames(),
    fetch: () => {
      if (!port.listUsers) throw new Error("trash user lookup is unavailable");
      return port.listUsers();
    },
  }, {
    enabled: Boolean(port.listUsers),
  });
  const actorUsernames = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of usersQuery.data?.users ?? []) map.set(user.principalId, user.username);
    return map;
  }, [usersQuery.data]);

  const [morePages, setMorePages] = useState<AdminTrashItemDto[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  // The "latest call wins" guard for accumulated pages — see the file header. `loadingMoreRef` is
  // the synchronous half (blocks a same-tick double `loadMore`); `pageSettlement` is the async half
  // (a superseded fetch's response must not land once a reset has moved on).
  const loadingMoreRef = useRef(false);
  const pageSettlement = useSettlementGeneration();

  // Supersedes any in-flight "Load more" fetch and clears the accumulated pages back to "just the
  // first page" — called wherever the previous code did a bare `setMorePages([])`, so there is one
  // reset path instead of several ad hoc ones. Does not touch `moreCursor` (set by the effect below,
  // right after this runs) or `actionError` (owned by the restore/purge actions, which already clear
  // it themselves before a successful `reloadAfterAction` gets here).
  const resetMorePages = useCallback(() => {
    pageSettlement.next();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMorePages([]);
  }, [pageSettlement]);

  // A refetched first page — from this screen's own `reloadAfterAction` OR a background
  // `useContentRefreshSubscription` refresh (an agent tool wrote a trash row) — must drop the
  // "more" pages it used to leave stale — they are always a continuation of the CURRENT first
  // page, not whichever first page was on screen when they were fetched. `resetMorePages()` also
  // supersedes any `loadMore` already in flight when the refetch lands, so its page can't append
  // afterward.
  useEffect(() => {
    resetMorePages();
    setMoreCursor(firstPage.data?.nextCursor ?? null);
  }, [firstPage.data, resetMorePages]);

  const items = firstPage.data ? [...firstPage.data.items, ...morePages] : null;

  // Reconcile the selection against what is actually on screen. A background refresh (an agent
  // restored something, the 60-day sweeper purged something) can remove a row mid-selection, and a
  // selection holding an id nobody can see any more would send it to the purge endpoint anyway.
  const visibleIds = items ? items.map((item) => item.id).join("\u0000") : null;
  useEffect(() => {
    if (visibleIds === null) return;
    const present = new Set(visibleIds.length > 0 ? visibleIds.split("\u0000") : []);
    setSelected((current) => {
      const kept = new Set([...current].filter((id) => present.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [visibleIds]);

  async function loadMore() {
    if (!moreCursor) return;
    if (loadingMoreRef.current) return; // a same-tick double click sends only one request
    loadingMoreRef.current = true;
    const generation = pageSettlement.next();
    setLoadingMore(true);
    try {
      const page = await port.listTrash({ cursor: moreCursor });
      if (!pageSettlement.isCurrent({ generation })) return; // superseded by a reload
      setMorePages((prev) => [...prev, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch (e) {
      if (!pageSettlement.isCurrent({ generation })) return;
      setActionError(describeLoadError({ error: e, locale }));
    } finally {
      // A superseded call's lock was already released by `resetMorePages`; only the still-current
      // call releases it here — otherwise a stale settlement could free the lock a NEWER, still
      // in-flight `loadMore` still owns.
      if (pageSettlement.isCurrent({ generation })) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  /** Drops the locally accumulated pages and refetches page 1 — the rows just moved. */
  function reloadAfterAction() {
    resetMorePages();
    invalidate({ key: KEYS.listRoot });
  }

  /**
   * The Refresh button: an explicit re-read regardless of freshness. Reuses `resetMorePages` so an
   * in-flight `loadMore` is superseded the same way a reload after restore/purge already supersedes
   * one (same `pageSettlement` generation guard). Does not touch `selected` — the existing
   * reconcile-selection effect (keyed on `items`) already prunes any id that drops off the
   * refreshed rows once they land.
   */
  function refresh() {
    resetMorePages();
    void firstPage.refetch();
  }

  /** The rows the current selection actually names, resolved from what is on screen. */
  function selectedItems(): AdminTrashItemDto[] {
    return (items ?? []).filter((item) => selected.has(item.id));
  }

  async function onRestoreSelected() {
    const chosen = selectedItems();
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const report = await port.restoreTrashItems({
        items: chosen.map((item) => ({ entityType: item.entityType, entityId: item.entityId })),
      });
      setNotice(describeRestoreReport({ translate: translate, report }));
      setSelected(new Set<string>());
      reloadAfterAction();
    } catch (e) {
      setActionError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to restore" }) }));
    } finally {
      setBusy(false);
    }
  }

  async function onPurgeConfirmed() {
    const chosen = selectedItems();
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const report = await port.purgeTrashItems({ ids: chosen.map((item) => item.id) });
      setNotice(describePurgeReport({ translate: translate, report }));
      setSelected(new Set<string>());
      setPurgeConfirmOpen(false);
      reloadAfterAction();
    } catch (e) {
      setActionError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to delete permanently" }) }));
    } finally {
      setBusy(false);
    }
  }

  return {
    items,
    nextCursor: moreCursor,
    loadingMore,
    loadMore,
    error: firstPage.error ? describeLoadError({ error: firstPage.error, locale }) : actionError,
    notice,
    busy,
    selected,
    toggle: (id) => setSelected((current) => toggleSelection({ current, id })),
    toggleAll: () =>
      setSelected((current) => selectionAfterSelectAll({ items: items ?? [], allSelected: allVisibleSelected({ items: items ?? [], selected: current }) })),
    allSelected: allVisibleSelected({ items: items ?? [], selected }),
    onRestoreSelected,
    purgeConfirmOpen,
    setPurgeConfirmOpen,
    onPurgeConfirmed,
    refresh,
    refreshing: firstPage.isFetching,
    actorUsernames,
    locale,
    t,
  };
}
