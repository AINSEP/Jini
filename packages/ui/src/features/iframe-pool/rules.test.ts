import { describe, expect, it } from 'vitest';
import { selectLruEvictions, selectMatchingEvictions } from './rules.js';
import type { IframeKeepAlivePoolEntry } from './types.js';

function entry(key: string, lastUsedAt: number): IframeKeepAlivePoolEntry<string> {
  return { key, lastUsedAt, element: {} as HTMLIFrameElement };
}

describe('selectLruEvictions', () => {
  it('evicts nothing when under the limit', () => {
    const entries = [entry('a', 1), entry('b', 2)];
    expect(selectLruEvictions({ entries, activeKeys: new Set(), maxMounted: 5 })).toEqual([]);
  });

  it('evicts the least-recently-used inactive entries first', () => {
    const entries = [entry('a', 3), entry('b', 1), entry('c', 2)];
    expect(selectLruEvictions({ entries, activeKeys: new Set(), maxMounted: 2 })).toEqual(['b']);
  });

  it('never evicts an active entry, even if it is the oldest', () => {
    const entries = [entry('a', 1), entry('b', 2), entry('c', 3)];
    // 'a' is active and must stay; getting the total down to the limit of 1
    // requires evicting both other (inactive) entries, not just the oldest.
    expect(selectLruEvictions({ entries, activeKeys: new Set(['a']), maxMounted: 1 })).toEqual(['b', 'c']);
  });

  it('stays over the limit when there are not enough inactive entries to evict', () => {
    const entries = [entry('a', 1), entry('b', 2)];
    expect(selectLruEvictions({ entries, activeKeys: new Set(['a', 'b']), maxMounted: 0 })).toEqual([]);
  });

  it('evicts multiple entries in ascending lastUsedAt order until at the limit', () => {
    const entries = [entry('a', 4), entry('b', 1), entry('c', 3), entry('d', 2)];
    expect(selectLruEvictions({ entries, activeKeys: new Set(), maxMounted: 1 })).toEqual(['b', 'd', 'c']);
  });

  it('handles an empty entry list', () => {
    expect(selectLruEvictions({ entries: [], activeKeys: new Set(), maxMounted: 5 })).toEqual([]);
  });
});

describe('selectMatchingEvictions', () => {
  it('selects only inactive entries matching the predicate by default', () => {
    const entries = [entry('a', 1), entry('b', 2), entry('c', 3)];
    const result = selectMatchingEvictions(
      { entries,
      activeKeys: new Set(['a']),
      predicate: (e) => e.key !== 'c',
      includeActive: false,
     });
    expect(result).toEqual(['b']);
  });

  it('includes active entries when includeActive is true', () => {
    const entries = [entry('a', 1), entry('b', 2)];
    const result = selectMatchingEvictions({ entries, activeKeys: new Set(['a']), predicate: () => true, includeActive: true });
    expect(result).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing matches', () => {
    const entries = [entry('a', 1)];
    expect(selectMatchingEvictions({ entries, activeKeys: new Set(), predicate: () => false, includeActive: true })).toEqual([]);
  });
});
