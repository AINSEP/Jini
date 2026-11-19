import { useEffect, useMemo, useRef, useState } from 'react';
import type { IframeKeepAlivePoolEntry, IframeKeepAlivePoolValue } from '../../types.js';
import { selectLruEvictions, selectMatchingEvictions } from '../../rules.js';
import { parkIframeElement, unparkIframeElement } from '../dom-sync.js';

/** Manage the bounded pool, including parking, eviction, and unmount cleanup. */
export function useIframeKeepAliveProvider({ maxMounted }: { maxMounted: number }, _options = {}) {
  const parkedHostRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<Map<string, IframeKeepAlivePoolEntry>>(new Map());
  const activeKeysRef = useRef<Set<string>>(new Set());
  const [poolRevision, bumpPoolRevision] = useState(0);

  const removeEntry = (key: string): boolean => {
    const entry = entriesRef.current.get(key);
    if (!entry) return false;
    const wasActive = activeKeysRef.current.has(key);
    entry.element.remove();
    entriesRef.current.delete(key);
    activeKeysRef.current.delete(key);
    return wasActive;
  };

  const enforceLimit = () => {
    const entries = Array.from(entriesRef.current.values());
    const evictions = selectLruEvictions({ entries, activeKeys: activeKeysRef.current, maxMounted });
    for (const key of evictions) removeEntry(key);
  };

  const pool = useMemo<IframeKeepAlivePoolValue>(() => ({
    attach(key, host, create) {
      let entry = entriesRef.current.get(key);
      if (entry && !activeKeysRef.current.has(key)) {
        // Reattaching a parked entry — undo the hidden/inert markers
        // `release()` set, or the reused iframe would stay invisible.
        unparkIframeElement(entry.element);
      }
      if (!entry) {
        entry = { key, element: create(), lastUsedAt: Date.now() };
        entriesRef.current.set(key, entry);
      }
      entry.lastUsedAt = Date.now();
      activeKeysRef.current.add(key);
      host.appendChild(entry.element);
      return entry.element;
    },
    release(key) {
      const entry = entriesRef.current.get(key);
      activeKeysRef.current.delete(key);
      if (entry) {
        // `parkedHostRef` is populated by the time any consumer can call
        // `release` — it attaches to the same unconditionally-rendered `<div>`
        // during the commit that mounts this provider, before any consumer
        // downstream could have received the pool value used to call this.
        parkIframeElement(entry.element);
        parkedHostRef.current!.appendChild(entry.element);
      }
      enforceLimit();
    },
    evict(key) {
      if (removeEntry(key)) bumpPoolRevision((value) => value + 1);
    },
    evictMatching(predicate, options) {
      const entries = Array.from(entriesRef.current.values());
      const keys = selectMatchingEvictions(
        { entries,
        activeKeys: activeKeysRef.current,
        predicate,
        includeActive: options?.includeActive ?? false,
       });
      let removedActive = false;
      for (const key of keys) removedActive = removeEntry(key) || removedActive;
      if (removedActive) bumpPoolRevision((value) => value + 1);
    },
  }), [maxMounted, poolRevision]);

  useEffect(() => () => {
    for (const key of Array.from(entriesRef.current.keys())) removeEntry(key);
  }, []);

  return { parkedHostRef, pool };
}
