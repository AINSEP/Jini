import type { IframeKeepAlivePoolEntry } from './types.js';

/**
 * LRU eviction selection: given the pool's current entries and which keys
 * are currently active (mounted/in-use), returns the keys of the
 * least-recently-used *inactive* entries to remove so the total entry count
 * no longer exceeds `maxMounted`. Never selects an active entry — an
 * over-`maxMounted` pool with too few inactive entries simply stays over
 * the limit until something is released. Generic over `TKey` so the LRU
 * mechanics are independently testable and reusable outside this feature.
 */
export function selectLruEvictions<TKey>(
  { entries, activeKeys, maxMounted }: { entries: readonly IframeKeepAlivePoolEntry<TKey>[]; activeKeys: ReadonlySet<TKey>; maxMounted: number },
  _optional: Record<string, never> = {},
): TKey[] {
  const inactiveByLru = entries
    .filter((entry) => !activeKeys.has(entry.key))
    .slice()
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

  const evictions: TKey[] = [];
  let remaining = entries.length;
  for (const entry of inactiveByLru) {
    if (remaining <= maxMounted) break;
    evictions.push(entry.key);
    remaining--;
  }
  return evictions;
}

/**
 * Predicate-based eviction selection: every entry matching `predicate`,
 * restricted to inactive entries unless `includeActive` is set.
 */
export function selectMatchingEvictions<TKey>(
  { entries, activeKeys, predicate, includeActive }: { entries: readonly IframeKeepAlivePoolEntry<TKey>[]; activeKeys: ReadonlySet<TKey>; predicate: (entry: IframeKeepAlivePoolEntry<TKey>) => boolean; includeActive: boolean },
  _optional: Record<string, never> = {},
): TKey[] {
  return entries
    .filter((entry) => (includeActive || !activeKeys.has(entry.key)) && predicate(entry))
    .map((entry) => entry.key);
}
