import { useMemo, useState } from 'react';
import { useDebouncedValue } from '../../../../react/hooks/useDebouncedValue.js';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../constants.js';
import { buildFacetLabelMap } from '../../rules.js';
import type { AssetGridFacetOption } from '../../types.js';

/** Owns the editable filters and the debounced membership used by data/live updates. */
export function useAssetGridFilters(
  {
    kindFacets = [],
    sourceFacets = [],
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  }: {
    kindFacets: AssetGridFacetOption[] | undefined;
    sourceFacets: AssetGridFacetOption[] | undefined;
    searchDebounceMs: number | undefined;
  },
  _options: Record<string, never> = {},
) {
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue({ value: search, delayMs: searchDebounceMs });
  const filtersActive = !!(kind || source || debouncedSearch.trim());
  const kindFacetLabels = useMemo(() => buildFacetLabelMap(kindFacets), [kindFacets]);
  const sourceFacetLabels = useMemo(() => buildFacetLabelMap(sourceFacets), [sourceFacets]);

  return {
    kind, setKind, source, setSource, search, setSearch,
    debouncedSearch, filtersActive, kindFacets, sourceFacets, kindFacetLabels, sourceFacetLabels,
  };
}
