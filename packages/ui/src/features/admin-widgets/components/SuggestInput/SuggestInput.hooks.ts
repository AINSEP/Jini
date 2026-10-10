import { useState } from 'react';

/**
 * State for {@link SuggestInput}: which suggestions match what is typed, whether the list is open, and
 * which row the arrow keys have highlighted. Pure state, no DOM, so the component renders against it.
 */
export interface SuggestInputController {
  open: boolean;
  /** Suggestions containing the typed text (case-insensitive), at most `limit` of them. */
  matches: readonly string[];
  /** Index into `matches`, or -1 when nothing is highlighted. */
  highlighted: number;
  setHighlighted: (index: number) => void;
  openList: () => void;
  closeList: () => void;
  /** Handles the list's own keys. Returns true when it consumed the key, so the caller's own
   *  handler (e.g. "Enter adds what was typed") must not also run. */
  handleKey: (key: string) => { consumed: boolean; picked?: string | undefined };
}

/** Suggestions containing `typed` (case-insensitive), in their given order, capped at `limit`. */
export function matchSuggestions({ typed, suggestions, limit }: { typed: string; suggestions: readonly string[]; limit: number }, _optional: Record<string, never> = {}): string[] {
  const needle = typed.trim().toLowerCase();
  const hits = needle ? suggestions.filter((s) => s.toLowerCase().includes(needle)) : [...suggestions];
  return hits.slice(0, limit);
}

/** @complexity O(n) over `suggestions` per render. */
export function useSuggestInput({ value, suggestions }: { value: string; suggestions: readonly string[] }, { limit = 8 }: { limit?: number } = {}): SuggestInputController {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const matches = matchSuggestions({ typed: value, suggestions, limit });
  const visible = open && matches.length > 0;
  const current = highlighted < matches.length ? highlighted : -1;
  return {
    open: visible,
    matches,
    highlighted: current,
    setHighlighted,
    openList: () => setOpen(true),
    closeList: () => { setOpen(false); setHighlighted(-1); },
    handleKey: (key) => {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        if (matches.length === 0) return { consumed: false };
        setOpen(true);
        const step = key === 'ArrowDown' ? 1 : -1;
        setHighlighted((current + step + matches.length + (current === -1 && step === -1 ? 1 : 0)) % matches.length);
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
