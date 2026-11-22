import { useCallback, useEffect, useRef, useState } from 'react';
import { pruneMissingSelection, rangeSelection, selectAllIds, toggleSelection } from '../../rules.js';
import type { AssetGridItem } from '../../types.js';

export interface UseAssetGridSelectionResult {
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleOne: (id: string, index: number) => void;
  rangeTo: (index: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

/** Id-based selection state: toggle/shift-range/select-all/clear, plus the shift-range anchor. */
export function useAssetGridSelection<TAsset extends AssetGridItem>(
  items: readonly TAsset[],
): UseAssetGridSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<number | null>(null);

  // Drop selected ids that no longer exist after a reload/delete.
  useEffect(() => {
    setSelectedIds((prev) => pruneMissingSelection({ prev, items }));
  }, [items]);

  const toggleOne = useCallback((id: string, index: number) => {
    setSelectedIds((prev) => toggleSelection({ prev, id }));
    anchorRef.current = index;
  }, []);

  const rangeTo = useCallback(
    (index: number) => {
      const anchor = anchorRef.current ?? index;
      setSelectedIds((prev) => rangeSelection({ prev, items, anchorIndex: anchor, targetIndex: index }));
    },
    [items],
  );

  const selectAll = useCallback(() => setSelectedIds(selectAllIds({ items })), [items]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, setSelectedIds, toggleOne, rangeTo, selectAll, clearSelection };
}
