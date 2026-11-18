import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAssetGridQuery, defaultMatchesKindFilter, filterByKind } from '../../rules.js';
import { createFakeAssetGridDependencies } from '../../dependencies.js';
import type { AssetGridDataPort, AssetGridDependencies } from '../../ports.js';
import type { AssetGridItem, AssetGridQuery } from '../../types.js';

export interface UseAssetGridDataParams<TAsset extends AssetGridItem> {
  active: boolean;
  data: AssetGridDataPort<TAsset>;
  kind: string;
  source: string;
  debouncedSearch: string;
  getKind: (asset: TAsset) => string;
  matchesKindFilter?: ((asset: TAsset, filterValue: string) => boolean) | undefined;
  mapKindToQuery?: ((kind: string) => string | undefined) | undefined;
}

export interface UseAssetGridDataResult<TAsset> {
  assets: TAsset[];
  setAssets: React.Dispatch<React.SetStateAction<TAsset[]>>;
  loading: boolean;
  query: AssetGridQuery;
  reload: () => Promise<void>;
}

/** Fetches assets when `active` or the derived query changes, applying an optional client-side kind narrowing pass after each fetch. */
export function useAssetGridData<TAsset extends AssetGridItem>(
  params: UseAssetGridDataParams<TAsset>,
): UseAssetGridDataResult<TAsset> {
  const { active, data, kind, source, debouncedSearch, getKind, matchesKindFilter, mapKindToQuery } = params;
  const [assets, setAssets] = useState<TAsset[]>([]);
  const [loading, setLoading] = useState(false);

  // Selector functions are host-supplied and not guaranteed to be
  // referentially stable across renders (e.g. an inline arrow in JSX). Ref
  // them so `reload`'s identity depends only on primitives — otherwise an
  // unstable selector would recreate `reload` every render, which would
  // retrigger the fetch effect below on every render in turn.
  const getKindRef = useRef(getKind);
  useEffect(() => {
    getKindRef.current = getKind;
  }, [getKind]);
  const matchesKindFilterRef = useRef(matchesKindFilter);
  useEffect(() => {
    matchesKindFilterRef.current = matchesKindFilter;
  }, [matchesKindFilter]);
  const mapKindToQueryRef = useRef(mapKindToQuery);
  useEffect(() => {
    mapKindToQueryRef.current = mapKindToQuery;
  }, [mapKindToQuery]);

  const query = useMemo(
    () => buildAssetGridQuery({ kind, source, search: debouncedSearch }, { mapKindToQuery }),
    [kind, source, debouncedSearch, mapKindToQuery],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const liveQuery = buildAssetGridQuery({ kind, source, search: debouncedSearch }, { mapKindToQuery: mapKindToQueryRef.current });
    const fetched = await data.fetchAssets(liveQuery);
    const matches =
      matchesKindFilterRef.current ??
      ((asset: TAsset, filterValue: string) => defaultMatchesKindFilter({ asset, filterValue, getKind: getKindRef.current }));
    setAssets(filterByKind({ items: fetched, filterValue: kind, matches }));
    setLoading(false);
  }, [data, kind, source, debouncedSearch]);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  return { assets, setAssets, loading, query, reload };
}

export type UseWiredAssetGridDataParams<TAsset extends AssetGridItem> = Omit<
  UseAssetGridDataParams<TAsset>,
  'data'
> & {
  /**
   * Optional host-supplied dependencies (only the `data` port is read here).
   * Omit to fall back to the package's in-memory fake — the same default
   * `AssetGrid` itself uses.
   */
  dependencies?: AssetGridDependencies<TAsset> | undefined;
};

/**
 * Wirer: binds `data` from `dependencies.ts` (a host-supplied port via
 * `dependencies`, or the package's in-memory fake) so production callers
 * don't need to import `dependencies.ts` themselves. `useAssetGridData`
 * itself stays fake-able in tests — this is the only export in the file
 * that touches a concrete adapter.
 */
export function useWiredAssetGridData<TAsset extends AssetGridItem>(
  params: UseWiredAssetGridDataParams<TAsset>,
): UseAssetGridDataResult<TAsset> {
  const { dependencies, ...rest } = params;
  const deps = useMemo(() => dependencies ?? createFakeAssetGridDependencies<TAsset>(), [dependencies]);
  return useAssetGridData({ ...rest, data: deps.data });
}
