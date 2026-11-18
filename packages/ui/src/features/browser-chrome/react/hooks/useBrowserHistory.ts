import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserHistoryEntry } from '../../types.js';
import { HISTORY_SAVE_DEBOUNCE_MS } from '../../constants.js';
import { mergeHistoryEntry, type MergeHistoryEntryMeta, type MergeHistoryEntryOptions } from '../../rules.js';
import type { BrowserHistoryStoragePort } from '../../ports.js';
import { createBrowserHistoryStorage } from '../../dependencies.js';

export interface UseBrowserHistoryOptions {
  debounceMs?: number;
}

export interface BrowserHistoryController {
  history: BrowserHistoryEntry[];
  commitVisit: (url: string, meta?: MergeHistoryEntryMeta, options?: MergeHistoryEntryOptions) => void;
  clearHistory: () => void;
}

/**
 * Loads a scope's browsing history on mount and debounce-persists it on every
 * change (mirroring the origin's 140ms-debounced save-on-change effect).
 */
export function useBrowserHistory(
  scopeKey: string,
  dependencies: { historyStorage: BrowserHistoryStoragePort },
  options: UseBrowserHistoryOptions = {},
): BrowserHistoryController {
  const debounceMs = options.debounceMs ?? HISTORY_SAVE_DEBOUNCE_MS;
  const [history, setHistory] = useState<BrowserHistoryEntry[]>(() => dependencies.historyStorage.loadHistory(scopeKey));
  const storageRef = useRef(dependencies.historyStorage);
  storageRef.current = dependencies.historyStorage;

  useEffect(() => {
    setHistory(storageRef.current.loadHistory(scopeKey));
    // Re-hydrating on scope change only; the storage port is read via a ref
    // above so a fresh `dependencies` object each render doesn't re-trigger this.
  }, [scopeKey]);

  useEffect(() => {
    const timer = setTimeout(() => storageRef.current.saveHistory(scopeKey, history), debounceMs);
    return () => clearTimeout(timer);
  }, [history, scopeKey, debounceMs]);

  const commitVisit = useCallback((url: string, meta?: MergeHistoryEntryMeta, mergeOptions?: MergeHistoryEntryOptions) => {
    setHistory((current) => mergeHistoryEntry({ history: current, url }, { meta: meta ?? {}, options: mergeOptions ?? {} }));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    storageRef.current.saveHistory(scopeKey, []);
  }, [scopeKey]);

  return { history, commitVisit, clearHistory };
}

// Module-level singleton: `createBrowserHistoryStorage()` is stateless
// (closures over namespace/limit only), so one shared instance is enough —
// avoids reallocating a fresh port object on every `useWiredBrowserHistory`
// render for no benefit.
const defaultHistoryStorage: BrowserHistoryStoragePort = createBrowserHistoryStorage();

/**
 * Production wiring for `useBrowserHistory`: binds the real, SSR-guarded
 * `localStorage`-backed history port from `dependencies.ts` under the
 * default namespace/limit. A host that needs a non-default namespace/limit,
 * or a swappable/test port, should call `useBrowserHistory` directly with
 * its own `{ historyStorage }` instead of this zero-arg wirer.
 */
export function useWiredBrowserHistory(scopeKey: string, options?: UseBrowserHistoryOptions): BrowserHistoryController {
  return useBrowserHistory(scopeKey, { historyStorage: defaultHistoryStorage }, options);
}
