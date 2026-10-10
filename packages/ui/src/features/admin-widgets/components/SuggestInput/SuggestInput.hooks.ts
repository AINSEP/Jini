import { useEffect, useState, type RefObject } from 'react';

/**
 * State for {@link SuggestInput}: which suggestions match what is typed, whether the list is open, and
 * which row the arrow keys have highlighted. Pure state, no DOM, so the component renders against it.
 */
export interface SuggestInputController {
  open: boolean;
  /** Suggestions containing the typed text (case-insensitive): all of them unless the caller passed
   *  `limit`. The host styles the list with a max-height so a long list scrolls inside it. */
  matches: readonly string[];
  /** Index into `matches`, or -1 when nothing is highlighted. */
  highlighted: number;
  setHighlighted: (index: number) => void;
  /** The row an arrow key just moved to, as a fresh object per key press so the component's effect
   *  re-runs even when the index repeats. Null until a key moves; mouse hover never sets it, so
   *  hovering a half-visible row while wheel-scrolling doesn't yank the list. */
  scrollTarget: { index: number } | null;
  openList: () => void;
  closeList: () => void;
  /** Handles the list's own keys. Returns true when it consumed the key, so the caller's own
   *  handler (e.g. "Enter adds what was typed") must not also run. */
  handleKey: (key: string) => { consumed: boolean; picked?: string | undefined };
}

/** Suggestions containing `typed` (case-insensitive), in their given order; capped at `limit` only when one is given. */
export function matchSuggestions({ typed, suggestions }: { typed: string; suggestions: readonly string[] }, { limit }: { limit?: number | undefined } = {}): string[] {
  const needle = typed.trim().toLowerCase();
  const hits = needle ? suggestions.filter((s) => s.toLowerCase().includes(needle)) : [...suggestions];
  return limit === undefined ? hits : hits.slice(0, limit);
}

/** @complexity O(n) over `suggestions` per render. */
export function useSuggestInput({ value, suggestions }: { value: string; suggestions: readonly string[] }, { limit }: { limit?: number | undefined } = {}): SuggestInputController {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [scrollTarget, setScrollTarget] = useState<{ index: number } | null>(null);
  const matches = matchSuggestions({ typed: value, suggestions }, { limit });
  const visible = open && matches.length > 0;
  const current = highlighted < matches.length ? highlighted : -1;
  return {
    open: visible,
    matches,
    highlighted: current,
    setHighlighted,
    scrollTarget,
    openList: () => setOpen(true),
    closeList: () => { setOpen(false); setHighlighted(-1); },
    handleKey: (key) => {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (matches.length === 0) return { consumed: false };
        setOpen(true);
        const step = key === 'ArrowDown' ? 1 : -1;
        const next = (current + step + matches.length + (current === -1 && step === -1 ? 1 : 0)) % matches.length;
        setHighlighted(next);
        setScrollTarget({ index: next });
        return { consumed: true };
      }
      if (key === 'Escape' && visible) { setOpen(false); setHighlighted(-1); return { consumed: true }; }
      const picked = current >= 0 ? matches[current] : undefined;
      if (key === 'Enter' && visible && picked !== undefined) {
        setOpen(false); setHighlighted(-1);
        return { consumed: true, picked };
      }
      return { consumed: false };
    },
  };
}

/** Default scroller: `block: 'nearest'` moves the list only as far as needed. Optional call because
 *  non-browser DOMs (jsdom in host test suites) don't implement `scrollIntoView`. */
export function scrollOptionIntoView(option: Element): void {
  option.scrollIntoView?.({ block: 'nearest' });
}

/**
 * Keeps the arrow-key row visible in a scrolling list: when `scrollTarget` changes, scrolls the
 * list's child at that index into view. `scrollIntoView` is injectable for tests.
 */
export function useScrollHighlightedIntoView({ listRef, scrollTarget }: { listRef: RefObject<HTMLElement | null>; scrollTarget: { index: number } | null }, { scrollIntoView = scrollOptionIntoView }: { scrollIntoView?: ((option: Element) => void) | undefined } = {}): void {
  useEffect(() => {
    const option = scrollTarget ? listRef.current?.children.item(scrollTarget.index) : null;
    if (option) scrollIntoView(option);
  }, [scrollTarget, listRef, scrollIntoView]);
}
