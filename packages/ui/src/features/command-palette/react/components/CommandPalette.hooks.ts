import { useCallback, useEffect, useRef } from 'react';

/** Focus the palette on mount and keep its active result visible. */
export function useCommandPaletteView({ cursor }: { cursor: number }, _options = {}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  return { listRef, setInputRef };
}
