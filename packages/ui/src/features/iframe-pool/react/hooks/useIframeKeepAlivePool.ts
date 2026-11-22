import { useContext, useEffect, useMemo, useRef } from 'react';
import type { IframeKeepAlivePoolEntry, IframeKeepAlivePoolValue } from '../../types.js';
import { selectMatchingEvictions } from '../../rules.js';
import { IframeKeepAliveContext } from '../pool-context.js';

/**
 * Reads the nearest `IframeKeepAlivePoolProvider`'s pool. If none is
 * mounted, returns a self-contained single-entry fallback pool so a
 * `PooledIframe` still works standalone — it just gets no LRU/keep-alive
 * benefit (only ever holds the entries its own caller attaches, and never
 * enforces a mounted-count limit).
 */
export function useIframeKeepAlivePool(): IframeKeepAlivePoolValue {
  const pool = useContext(IframeKeepAliveContext);
  const fallbackEntriesRef = useRef<Map<string, IframeKeepAlivePoolEntry>>(new Map());
  const fallbackActiveKeysRef = useRef<Set<string>>(new Set());

  const fallbackPool = useMemo<IframeKeepAlivePoolValue>(() => {
    const removeFallbackEntry = (key: string) => {
      const entry = fallbackEntriesRef.current.get(key);
      if (!entry) return;
      entry.element.remove();
      fallbackEntriesRef.current.delete(key);
      fallbackActiveKeysRef.current.delete(key);
    };
    return {
      attach(key, host, create) {
        let entry = fallbackEntriesRef.current.get(key);
        if (!entry) {
          entry = { key, element: create(), lastUsedAt: Date.now() };
          fallbackEntriesRef.current.set(key, entry);
        }
        entry.lastUsedAt = Date.now();
        fallbackActiveKeysRef.current.add(key);
        host.appendChild(entry.element);
        return entry.element;
      },
      release(key) {
        removeFallbackEntry(key);
      },
      evict(key) {
        removeFallbackEntry(key);
      },
      evictMatching(predicate) {
        // The fallback pool only ever holds a single active entry and never
        // parks, so `includeActive` makes no practical difference here — a
        // matching entry is always removed regardless of that option.
        const entries = Array.from(fallbackEntriesRef.current.values());
        const keys = selectMatchingEvictions({ entries, activeKeys: fallbackActiveKeysRef.current, predicate, includeActive: true });
        for (const key of keys) removeFallbackEntry(key);
      },
    };
  }, []);

  useEffect(() => () => {
    for (const key of Array.from(fallbackEntriesRef.current.keys())) {
      const entry = fallbackEntriesRef.current.get(key);
      entry?.element.remove();
      fallbackEntriesRef.current.delete(key);
      fallbackActiveKeysRef.current.delete(key);
    }
  }, []);

  return pool ?? fallbackPool;
}
