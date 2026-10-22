import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { CommandPaletteItem, CommandPaletteResult } from '../../types.js';
import { DEFAULT_SCOPE_KEY } from '../../constants.js';
import { nextCursor, rankItems } from '../../rules.js';
import type { CommandPaletteRecentsPort } from '../../ports.js';
import { createLocalStorageRecents } from '../../dependencies.js';

export interface UseCommandPaletteOptions {
  items: readonly CommandPaletteItem[];
  onSelect: (item: CommandPaletteItem) => void;
  onClose: () => void;
  /** Recents are tracked per scope (e.g. per project/workspace). Defaults to one shared scope. */
  scopeKey?: string | undefined;
}

export interface CommandPaletteController {
  query: string;
  setQuery: (query: string) => void;
  cursor: number;
  results: CommandPaletteResult[];
  /** Selects `result.item` at hover/click, tracking it as a recent and closing the palette. */
  selectResult: (result: CommandPaletteResult) => void;
  setCursorTo: (index: number) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Owns query/cursor state, result ranking, recents tracking, and keyboard
 * navigation (arrow-key cursor with wraparound, Enter to select, Escape to
 * close) for a command palette. IME-composition-aware: navigation/commit
 * keys are ignored while a CJK candidate picker is active, so `keydown`
 * doesn't steal the keys a user needs to pick/commit an IME candidate.
 */
export function useCommandPalette(
  options: UseCommandPaletteOptions,
  dependencies: { recents: CommandPaletteRecentsPort },
): CommandPaletteController {
  const { items, onSelect, onClose } = options;
  const scopeKey = options.scopeKey ?? DEFAULT_SCOPE_KEY;
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const results = useMemo(
    () => rankItems(items, query, dependencies.recents.read(scopeKey)),
    [items, query, scopeKey, dependencies.recents],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const selectResult = useCallback((result: CommandPaletteResult) => {
    dependencies.recents.push(scopeKey, result.item.id);
    onSelect(result.item);
    onClose();
  }, [dependencies.recents, scopeKey, onSelect, onClose]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((current) => nextCursor(current, results.length, direction));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[cursor];
      if (hit) selectResult(hit);
    }
  }, [results, cursor, onClose, selectResult]);

  return { query, setQuery, cursor, results, selectResult, setCursorTo: setCursor, handleKeyDown };
}

// Module-level singleton: `createLocalStorageRecents()` is stateless
// (closures over namespace/limit only), so one shared instance is enough —
// avoids reallocating a fresh port object on every `useWiredCommandPalette`
// render for no benefit.
const defaultRecents: CommandPaletteRecentsPort = createLocalStorageRecents();

/**
 * Production wiring for `useCommandPalette`: binds the real, SSR-guarded
 * `localStorage`-backed recents port under the default namespace/limit. A
 * host that needs a non-default namespace/limit, or a swappable/test port,
 * should call `useCommandPalette` directly with its own `{ recents }` instead.
 */
export function useWiredCommandPalette(options: UseCommandPaletteOptions): CommandPaletteController {
  return useCommandPalette(options, { recents: defaultRecents });
}
