import { useEffect, useMemo, useRef } from 'react';
import { DEFAULT_LIVE_UPDATE_COALESCE_MS } from '../../constants.js';
import { mergeIngestedAssets } from '../../rules.js';
import { createFakeAssetGridDependencies } from '../../dependencies.js';
import type { AssetGridDependencies, AssetGridLiveUpdatesPort } from '../../ports.js';
import type { AssetGridItem } from '../../types.js';

export interface UseAssetGridLiveUpdatesParams<TAsset extends AssetGridItem> {
  active: boolean;
  liveUpdates: AssetGridLiveUpdatesPort | undefined;
  /** When true, incremental membership can't be predicted client-side (an active kind/source/search filter) — every event falls back to a full reload. */
  filtersActive: boolean;
  fetchAssetById?: ((id: string) => Promise<TAsset | null>) | undefined;
  setAssets: React.Dispatch<React.SetStateAction<TAsset[]>>;
  reload: () => Promise<void>;
  coalesceMs?: number | undefined;
}

/**
 * Subscribes to a live-update transport and reconciles incremental
 * ingest/delete events into the current asset list. Events are coalesced
 * over a short window and applied as one targeted merge (fetch the new/
 * changed ids, drop the deleted ids) instead of one full reload per event.
 * A burst of many events, a filtered view, or an event with no resolvable
 * id all fall back to a single full reload for that window — see
 * `packages/ui/source-map.md` for why (the original OD comment: "a filtered
 * view can't predict membership client-side").
 */
export function useAssetGridLiveUpdates<TAsset extends AssetGridItem>(
  params: UseAssetGridLiveUpdatesParams<TAsset>,
): void {
  const { active, liveUpdates, filtersActive, fetchAssetById, setAssets, reload, coalesceMs = DEFAULT_LIVE_UPDATE_COALESCE_MS } =
    params;

  // Refs so the long-lived subscription (set up once per active/liveUpdates
  // change) always reads the LATEST filtersActive/reload/fetchAssetById
  // without resubscribing — resubscribing would drop and recreate the
  // transport on every keystroke/filter change.
  const filtersActiveRef = useRef(filtersActive);
  useEffect(() => {
    filtersActiveRef.current = filtersActive;
  }, [filtersActive]);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  const fetchAssetByIdRef = useRef(fetchAssetById);
  useEffect(() => {
    fetchAssetByIdRef.current = fetchAssetById;
  }, [fetchAssetById]);

  useEffect(() => {
    if (!active || !liveUpdates) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pendingIngest = new Set<string>();
    const pendingDelete = new Set<string>();
    let pendingFull = false;

    const runFlushPass = async () => {
      // Deletes are free (no fetch); apply them first.
      if (pendingDelete.size) {
        const del = new Set(pendingDelete);
        pendingDelete.clear();
        for (const id of del) pendingIngest.delete(id);
        setAssets((prev) => prev.filter((a) => !del.has(a.id)));
      }
      if (pendingFull || filtersActiveRef.current) {
        pendingFull = false;
        pendingIngest.clear();
        await reloadRef.current();
        return;
      }
      if (pendingIngest.size) {
        const ids = [...pendingIngest];
        pendingIngest.clear();
        const fetchById = fetchAssetByIdRef.current;
        if (!fetchById) {
          await reloadRef.current();
          return;
        }
        const fetched = await Promise.all(ids.map((id) => fetchById(id)));
        // A missing fetch is ambiguous (filtered out? race?) — reload instead.
        if (fetched.some((a) => a === null)) {
          await reloadRef.current();
          return;
        }
        // `Promise.all` types its result through `Awaited<TAsset>`, which TS
        // cannot prove is identical to the generic `TAsset` itself — safe
        // here since the `some(a => a === null)` check above already
        // guarantees every element is non-null.
        const resolved = fetched as unknown as TAsset[];
        setAssets((prev) => mergeIngestedAssets(prev, resolved));
      }
    };

    /**
     * At most ONE pass runs at a time, and a pass requested during one is coalesced into a single
     * follow-up rather than started alongside it.
     *
     * `timer` alone did not provide that. `flush` nulled it on entry and then awaited, so a second
     * pass could start while the first was still inside `fetchById` — and by then the first had
     * already drained `pendingIngest`, so the second pass's delete found nothing there to cancel.
     * The first pass would then merge the asset the second had just removed, putting a deleted
     * asset back on screen. The `fetched.some(a => a === null)` guard does not cover it: the fetch
     * can legitimately have resolved WITH the asset, moments before it was deleted.
     *
     * Guarding the merge instead was tried and is not sufficient — `pendingDelete` is cleared by
     * whichever pass applies it, so by the time the fetching pass resumes there is nothing left to
     * re-check against. Serializing removes the precondition rather than the symptom, the same
     * reasoning `useMediaProvidersTab`'s `persist` uses for overlapping writes.
     *
     * Events arriving mid-pass are not lost: they accumulate in the same pending sets and the
     * `rerun` loop picks them up, one window later than they would have been applied before.
     */
    let flushing = false;
    let rerun = false;

    const flush = async () => {
      timer = null;
      if (flushing) {
        rerun = true;
        return;
      }
      flushing = true;
      try {
        do {
          rerun = false;
          await runFlushPass();
        } while (rerun);
      } finally {
        flushing = false;
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => void flush(), coalesceMs);
    };

    const unsubscribe = liveUpdates.subscribe({
      onIngest(id) {
        pendingIngest.add(id);
        schedule();
      },
      onDelete(id) {
        pendingDelete.add(id);
        schedule();
      },
      onFullReload() {
        pendingFull = true;
        schedule();
      },
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [active, liveUpdates, coalesceMs, setAssets]);
}

export type UseWiredAssetGridLiveUpdatesParams<TAsset extends AssetGridItem> = Omit<
  UseAssetGridLiveUpdatesParams<TAsset>,
  'liveUpdates' | 'fetchAssetById'
> & {
  /**
   * Optional host-supplied dependencies (`liveUpdates` and `data.fetchAssetById`
   * are read here). Omit to fall back to the package's in-memory fake, which
   * carries no `liveUpdates` port — matching `AssetGrid`'s own default of
   * disabling live-merge reconciliation when no dependencies are supplied.
   */
  dependencies?: AssetGridDependencies<TAsset> | undefined;
};

/**
 * Wirer: binds `liveUpdates` and `fetchAssetById` from `dependencies.ts` so
 * production callers don't need to import `dependencies.ts` themselves.
 * `useAssetGridLiveUpdates` itself stays fake-able in tests — this is the
 * only export in the file that touches a concrete adapter.
 */
export function useWiredAssetGridLiveUpdates<TAsset extends AssetGridItem>(
  params: UseWiredAssetGridLiveUpdatesParams<TAsset>,
): void {
  const { dependencies, ...rest } = params;
  const deps = useMemo(() => dependencies ?? createFakeAssetGridDependencies<TAsset>(), [dependencies]);
  useAssetGridLiveUpdates({
    ...rest,
    liveUpdates: deps.liveUpdates,
    fetchAssetById: deps.data.fetchAssetById?.bind(deps.data),
  });
}
