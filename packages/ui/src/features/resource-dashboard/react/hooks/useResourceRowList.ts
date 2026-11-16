import { useCallback, useEffect, useRef, useState } from 'react';
import { isActionPending, withoutPendingAction, withPendingAction } from '../../../../utils/pending-actions.js';
import type { ResourceRowListDependencies, ResourceRowListPort } from '../../ports.js';
import type { ResourceRowItem, ResourceRunHistoryItem } from '../../types.js';

const ROW_ACTION_KIND = 'row-action';
const LOAD_FAILED_MESSAGE = 'Failed to load items.';
const ROW_ACTION_FAILED_MESSAGE = 'Failed to complete action.';

export interface UseResourceRowListParams<TRow extends ResourceRowItem> {
  port: ResourceRowListPort<TRow>;
  /** Bumping this value re-fetches (same controlled-invalidation pattern as `useResourceBoard`). */
  refreshToken?: string | number;
}

export interface ResourceRowListController<TRow extends ResourceRowItem> {
  rows: TRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  isRowBusy: (id: string) => boolean;
  /**
   * Runs an arbitrary host-supplied action for `id` (TasksView's
   * run/edit/pause-resume/delete buttons dispatch through this — this
   * primitive never hardcodes their semantics, see `ports.ts`), tracking
   * busy state for the duration and, on success, reloading the row list and
   * — if `id` is the currently-expanded row — its run history too (mirrors
   * TasksView's own `runNow` bumping `historyTick` after a successful run).
   * A rejection from `run` propagates to the caller and does NOT reload.
   */
  dispatchRowAction: (id: string, run: () => Promise<void> | void) => Promise<void>;
  /**
   * Set when the most recent `dispatchRowAction` call's `run()` rejected —
   * a rejection still propagates to the caller (see `dispatchRowAction`'s
   * own doc comment), but a caller that fires-and-forgets it (as
   * `ResourceRowList.tsx`'s `onRowAction` does) needs a visible surface too,
   * matching real OD `TasksView.tsx`'s own shared `error` state set by every
   * one of `runNow`/`togglePaused`/`remove`'s catch clauses. Cleared at the
   * start of the next `dispatchRowAction` call.
   */
  actionError: string | null;
  /** Whether any row can expand at all — derived from `port.fetchRowHistory` being present. */
  canExpandHistory: boolean;
  expandedRowId: string | null;
  historyLoadingRowId: string | null;
  historyByRowId: Record<string, ResourceRunHistoryItem[] | undefined>;
  /** Expands `id` (fetching fresh history every time, matching TasksView's own re-fetch-on-every-expand behavior) or collapses it if already expanded. No-ops when the port has no `fetchRowHistory`. */
  toggleExpand: (id: string) => void;
}

/** Loads the row list; bumping `refreshToken` re-fetches. */
function useRowListLoader<TRow extends ResourceRowItem>(
  port: ResourceRowListPort<TRow>,
  refreshToken: string | number | undefined,
) {
  const [rows, setRows] = useState<TRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await port.fetchRows();
      setRows(fetched);
      setError(null);
    } catch {
      setError(LOAD_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [port]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  return { rows, loading, error, reload };
}

/** Per-row run-history fetching with stale-request protection. */
function useRowHistory<TRow extends ResourceRowItem>(port: ResourceRowListPort<TRow>) {
  const [historyLoadingRowId, setHistoryLoadingRowId] = useState<string | null>(null);
  const [historyByRowId, setHistoryByRowId] = useState<Record<string, ResourceRunHistoryItem[] | undefined>>({});
  // Per-row history request generation, so an older, slower fetch that
  // resolves AFTER a newer one for the SAME row (collapse then re-expand
  // before the first call settled) can detect it's stale and skip
  // committing its result/loading-flag update over the newer call's.
  const historyRequestSeqRef = useRef<Record<string, number>>({});

  const fetchHistoryFor = useCallback(
    async (id: string) => {
      // Non-null: every call site (`toggleExpand` below, and
      // `dispatchRowAction`'s post-action history refresh) only reaches this
      // function when `port.fetchRowHistory` is known to exist —
      // `toggleExpand` guards it directly before calling this, and
      // `dispatchRowAction` only calls this when `id === expandedRowId`,
      // which can only ever have been set by that same guarded `toggleExpand`.
      const seq = (historyRequestSeqRef.current[id] ?? 0) + 1;
      historyRequestSeqRef.current[id] = seq;
      const isStale = () => historyRequestSeqRef.current[id] !== seq;
      setHistoryLoadingRowId(id);
      try {
        const items = await port.fetchRowHistory!(id);
        // A newer request for this SAME row started (and possibly already
        // resolved) after this one — e.g. collapse then re-expand before
        // this call settled. Committing this stale result now would
        // overwrite the newer, already-committed history.
        if (isStale()) return;
        setHistoryByRowId((current) => ({ ...current, [id]: items }));
      } catch {
        // Real OD `TasksView.tsx`'s history fetch (line ~1044-1062) catches
        // a failure to an empty result rather than leaving `items`
        // `undefined` forever (which renders as permanent "Loading…" — see
        // `ResourceRunHistoryList.tsx`'s `items === undefined` check).
        if (isStale()) return;
        setHistoryByRowId((current) => ({ ...current, [id]: [] }));
      } finally {
        // A newer fetch for a DIFFERENT row (started after this one, e.g. the
        // user switched which row is expanded before this call resolved)
        // must not clobber that newer row's loading flag when this call
        // finally settles — only clear it if we're still the most recent one
        // for BOTH this row id and this specific request generation (an
        // older, still-in-flight request for the same row must not clear
        // the flag out from under a newer request that hasn't settled yet).
        setHistoryLoadingRowId((current) => (current === id && !isStale() ? null : current));
      }
    },
    [port],
  );

  return { historyLoadingRowId, historyByRowId, fetchHistoryFor };
}

interface RowActionDispatchParams {
  reload: () => Promise<void>;
  expandedRowId: string | null;
  fetchHistoryFor: (id: string) => Promise<void>;
}

/** Busy tracking + error surface for host-supplied row actions. */
function useRowActionDispatch({ reload, expandedRowId, fetchHistoryFor }: RowActionDispatchParams) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  const isRowBusy = useCallback((id: string) => isActionPending({ pendingKeys, id, kind: ROW_ACTION_KIND }), [pendingKeys]);

  const dispatchRowAction = useCallback(
    async (id: string, run: () => Promise<void> | void) => {
      setPendingKeys((current) => withPendingAction({ pendingKeys: current, id, kind: ROW_ACTION_KIND }));
      setActionError(null);
      try {
        await run();
        await reload();
        if (id === expandedRowId) await fetchHistoryFor(id);
      } catch (err) {
        // A rejection still propagates to the caller (documented contract,
        // see this controller's `dispatchRowAction` doc comment and its
        // dedicated regression test) — `ResourceRowList.tsx`'s orchestrator
        // used to fire this with `void`, which discards the return value
        // WITHOUT attaching a rejection handler, leaving both an unhandled
        // rejection and no visible error. Recording `actionError` here
        // gives a fire-and-forget caller a real surface to render, while
        // re-throwing preserves the "propagates and does not reload"
        // contract for a caller that awaits/catches it directly.
        setActionError(ROW_ACTION_FAILED_MESSAGE);
        throw err;
      } finally {
        setPendingKeys((current) => withoutPendingAction({ pendingKeys: current, id, kind: ROW_ACTION_KIND }));
      }
    },
    [reload, expandedRowId, fetchHistoryFor],
  );

  return { actionError, isRowBusy, dispatchRowAction };
}

export function useResourceRowList<TRow extends ResourceRowItem>(
  params: UseResourceRowListParams<TRow>,
): ResourceRowListController<TRow> {
  const { port, refreshToken } = params;
  const { rows, loading, error, reload } = useRowListLoader(port, refreshToken);
  const { historyLoadingRowId, historyByRowId, fetchHistoryFor } = useRowHistory(port);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const { actionError, isRowBusy, dispatchRowAction } = useRowActionDispatch({ reload, expandedRowId, fetchHistoryFor });

  const toggleExpand = useCallback(
    (id: string) => {
      if (!port.fetchRowHistory) return;
      setExpandedRowId((current) => {
        const next = current === id ? null : id;
        if (next) void fetchHistoryFor(id);
        return next;
      });
    },
    [port, fetchHistoryFor],
  );

  return {
    rows,
    loading,
    error,
    actionError,
    reload,
    isRowBusy,
    dispatchRowAction,
    canExpandHistory: Boolean(port.fetchRowHistory),
    expandedRowId,
    historyLoadingRowId,
    historyByRowId,
    toggleExpand,
  };
}

export type UseWiredResourceRowListParams<TRow extends ResourceRowItem> = {
  dependencies: ResourceRowListDependencies<TRow>;
} & Omit<UseResourceRowListParams<TRow>, 'port'>;

export function useWiredResourceRowList<TRow extends ResourceRowItem>(
  params: UseWiredResourceRowListParams<TRow>,
): ResourceRowListController<TRow> {
  const { dependencies, ...rest } = params;
  return useResourceRowList({ port: dependencies.port, ...rest });
}
