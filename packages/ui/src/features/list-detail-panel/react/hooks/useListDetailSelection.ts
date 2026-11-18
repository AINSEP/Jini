import { useCallback, useEffect, useState } from 'react';
import { resolveListDetailSelection } from '../../rules.js';
import type { ListDetailItem } from '../../types.js';

export interface UseListDetailSelectionResult {
  selectedId: string | null;
  select: (id: string | null) => void;
}

/**
 * Owns the master-detail selection state: which row is currently previewed.
 * Runs the `resolveListDetailSelection` rule whenever `items` changes so the
 * selection stays valid (kept if still present, else the first item, else
 * `null` for an empty list) without the host having to re-derive it.
 *
 * `ListDetailPanel` itself is fully controlled (`selectedId`/`onSelect`
 * props) — this hook is the opt-in convenience wirer a host uses instead of
 * hand-rolling the same sync effect `DesignSystemsTab.tsx` had inline.
 */
export function useListDetailSelection<TItem extends ListDetailItem>(
  items: readonly TItem[],
  initialSelectedId: string | null = null,
): UseListDetailSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    resolveListDetailSelection({ items, currentId: initialSelectedId }),
  );

  useEffect(() => {
    setSelectedId((current) => resolveListDetailSelection({ items, currentId: current }));
  }, [items]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  return { selectedId, select };
}
