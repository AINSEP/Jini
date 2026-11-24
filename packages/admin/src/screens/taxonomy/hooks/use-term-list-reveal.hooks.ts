import { useState } from "react";
import type { AdminTerm } from "../api/taxonomy-api.types.js";
import { termListView, type TermListView } from "../rules.js";

/**
 * @file One taxonomy row's "See more" / "Show less" and search state in the editors' Categories &
 * Tags box (`TermPicker.tsx`; owner, 2026-10-22). View state only — no reads or writes; what the row
 * shows is `rules.ts`'s `termListView`. Kept apart from `use-term-picker.hooks.ts` because each row
 * expands on its own and the box's ticks/save do not care what is on screen.
 */

export interface TermListReveal extends TermListView {
  expanded: boolean;
  /** Flip "See more" / "Show less". Re-takes the ticked snapshot, so ticked terms lead again. */
  toggleExpanded: () => void;
  query: string;
  setQuery: (query: string) => void;
}

export function useTermListReveal(required: {
  terms: readonly AdminTerm[];
  selected: ReadonlySet<string>;
  /** The content's own terms are still loading — the ticked snapshot waits for them. */
  loading: boolean;
}, _optional: Record<string, never> = {}): TermListReveal {
  const { terms, selected, loading } = required;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<ReadonlySet<string> | null>(null);
  // Snapshot the ticked ids once they have loaded — React's "adjust state while rendering" pattern,
  // so the first painted list already leads with them instead of reshuffling a frame later.
  if (pinned === null && !loading) setPinned(new Set(selected));
  const view = termListView({ terms, pinned: pinned ?? selected, selected, expanded, query });
  return {
    ...view,
    expanded,
    toggleExpanded: () => {
      setPinned(new Set(selected));
      setExpanded(!expanded);
    },
    query,
    setQuery,
  };
}
