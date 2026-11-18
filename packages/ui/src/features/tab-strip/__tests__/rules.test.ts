import { describe, expect, it } from 'vitest';
import {
  arraysEqual,
  coercePinnedDropTarget,
  dragTargetKey,
  dropEdgeFromPointerX,
  findNearestDropTarget,
  isTabClosable,
  isTabDraggable,
  pinnedTabIdSet,
  reorderTabIds,
} from '../rules.js';
import type { TabStripTab } from '../types.js';

function tab(overrides: Partial<TabStripTab> & { id: string }): TabStripTab {
  return { content: null, ...overrides };
}

describe('dropEdgeFromPointerX', () => {
  it('returns before when the pointer is in the left half', () => {
    expect(dropEdgeFromPointerX({ pointerX: 10, rect: { left: 0, width: 100 } })).toBe('before');
  });

  it('returns before when the pointer is exactly at the midpoint (strictly-greater-than check)', () => {
    expect(dropEdgeFromPointerX({ pointerX: 50, rect: { left: 0, width: 100 } })).toBe('before');
  });

  it('returns after when the pointer is in the right half', () => {
    expect(dropEdgeFromPointerX({ pointerX: 90, rect: { left: 0, width: 100 } })).toBe('after');
  });

  it('accounts for a non-zero left offset', () => {
    // Same pointerX (140), different width -> different midpoint -> different edge.
    expect(dropEdgeFromPointerX({ pointerX: 140, rect: { left: 100, width: 100 } })).toBe('before'); // midpoint 150
    expect(dropEdgeFromPointerX({ pointerX: 140, rect: { left: 100, width: 40 } })).toBe('after'); // midpoint 120
  });
});

describe('coercePinnedDropTarget', () => {
  it('coerces a before-edge drop onto a pinned tab to after', () => {
    const result = coercePinnedDropTarget({ target: { tabId: 'entry', edge: 'before' }, pinnedTabIds: new Set(['entry']) });
    expect(result).toEqual({ tabId: 'entry', edge: 'after' });
  });

  it('leaves an after-edge drop onto a pinned tab unchanged', () => {
    const result = coercePinnedDropTarget({ target: { tabId: 'entry', edge: 'after' }, pinnedTabIds: new Set(['entry']) });
    expect(result).toEqual({ tabId: 'entry', edge: 'after' });
  });

  it('leaves any-edge drop onto a non-pinned tab unchanged', () => {
    const before = coercePinnedDropTarget({ target: { tabId: 'b', edge: 'before' }, pinnedTabIds: new Set(['entry']) });
    expect(before).toEqual({ tabId: 'b', edge: 'before' });
  });
});

describe('reorderTabIds', () => {
  it('moves a tab before its target', () => {
    expect(reorderTabIds({ tabIds: ['a', 'b', 'c'], sourceId: 'c', targetId: 'a', edge: 'before' })).toEqual(['c', 'a', 'b']);
  });

  it('moves a tab after its target', () => {
    expect(reorderTabIds({ tabIds: ['a', 'b', 'c'], sourceId: 'a', targetId: 'c', edge: 'after' })).toEqual(['b', 'c', 'a']);
  });

  it('returns the same array reference when source equals target', () => {
    const original = ['a', 'b', 'c'];
    expect(reorderTabIds({ tabIds: original, sourceId: 'a', targetId: 'a', edge: 'after' })).toBe(original);
  });

  it('returns the same array reference when the source id is unknown', () => {
    const original = ['a', 'b', 'c'];
    expect(reorderTabIds({ tabIds: original, sourceId: 'ghost', targetId: 'a', edge: 'before' })).toBe(original);
  });

  it('returns the same array reference when the target id is unknown', () => {
    const original = ['a', 'b', 'c'];
    expect(reorderTabIds({ tabIds: original, sourceId: 'a', targetId: 'ghost', edge: 'before' })).toBe(original);
  });

  it('returns the same array reference when the resulting order is unchanged', () => {
    const original = ['a', 'b', 'c'];
    // Moving 'a' to before 'b' is a no-op — it's already immediately before 'b'.
    expect(reorderTabIds({ tabIds: original, sourceId: 'a', targetId: 'b', edge: 'before' })).toBe(original);
  });

  it('preserves the relative order of untouched tabs', () => {
    expect(reorderTabIds({ tabIds: ['a', 'b', 'c', 'd'], sourceId: 'd', targetId: 'b', edge: 'before' })).toEqual(['a', 'd', 'b', 'c']);
  });
});

describe('arraysEqual', () => {
  it('is true for identical-content arrays', () => {
    expect(arraysEqual({ a: ['a', 'b'], b: ['a', 'b'] })).toBe(true);
  });

  it('is false for different lengths', () => {
    expect(arraysEqual({ a: ['a'], b: ['a', 'b'] })).toBe(false);
  });

  it('is false for same-length but different-order arrays', () => {
    expect(arraysEqual({ a: ['a', 'b'], b: ['b', 'a'] })).toBe(false);
  });

  it('is true for two empty arrays', () => {
    expect(arraysEqual({ a: [], b: [] })).toBe(true);
  });
});

describe('dragTargetKey', () => {
  it('combines id and edge into a stable string', () => {
    expect(dragTargetKey({ tabId: 'x', edge: 'before' })).toBe('x:before');
    expect(dragTargetKey({ tabId: 'x', edge: 'after' })).toBe('x:after');
  });
});

describe('findNearestDropTarget', () => {
  const elements = [
    { id: 'a', rect: { left: 0, right: 100, width: 100 } },
    { id: 'b', rect: { left: 100, right: 200, width: 100 } },
    { id: 'c', rect: { left: 200, right: 300, width: 100 } },
  ];

  it('returns before the first candidate whose left half the pointer is within', () => {
    expect(findNearestDropTarget({ pointerX: 10, elements, sourceId: 'source' })).toEqual({ tabId: 'a', edge: 'before' });
  });

  it('returns after a candidate when the pointer is in its right half', () => {
    expect(findNearestDropTarget({ pointerX: 70, elements, sourceId: 'source' })).toEqual({ tabId: 'a', edge: 'after' });
  });

  it('skips the source element itself', () => {
    expect(findNearestDropTarget({ pointerX: 10, elements, sourceId: 'a' })).toEqual({ tabId: 'b', edge: 'before' });
  });

  it('falls back to after the last candidate when the pointer is past everything', () => {
    expect(findNearestDropTarget({ pointerX: 1000, elements, sourceId: 'source' })).toEqual({ tabId: 'c', edge: 'after' });
  });

  it('returns null for an empty element list', () => {
    expect(findNearestDropTarget({ pointerX: 10, elements: [], sourceId: 'source' })).toBeNull();
  });

  it('returns null when the only candidate is the source itself', () => {
    expect(findNearestDropTarget({ pointerX: 10, elements: [elements[0]!], sourceId: 'a' })).toBeNull();
  });
});

describe('pinnedTabIdSet', () => {
  it('collects only pinned tab ids', () => {
    const tabs = [tab({ id: 'a', pinned: true }), tab({ id: 'b' }), tab({ id: 'c', pinned: true })];
    expect(pinnedTabIdSet(tabs)).toEqual(new Set(['a', 'c']));
  });

  it('is empty when no tab is pinned', () => {
    expect(pinnedTabIdSet([tab({ id: 'a' })])).toEqual(new Set());
  });
});

describe('isTabDraggable', () => {
  it('is false when there is only one tab, even if unpinned', () => {
    const tabs = [tab({ id: 'a' })];
    expect(isTabDraggable({ tab: tabs[0]!, tabs })).toBe(false);
  });

  it('is true for an unpinned tab among several tabs by default', () => {
    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    expect(isTabDraggable({ tab: tabs[0]!, tabs })).toBe(true);
  });

  it('is false for a pinned tab by default, even among several tabs', () => {
    const tabs = [tab({ id: 'a', pinned: true }), tab({ id: 'b' })];
    expect(isTabDraggable({ tab: tabs[0]!, tabs })).toBe(false);
  });

  it('honors an explicit draggable: false override on an unpinned tab', () => {
    const tabs = [tab({ id: 'a', draggable: false }), tab({ id: 'b' })];
    expect(isTabDraggable({ tab: tabs[0]!, tabs })).toBe(false);
  });

  it('honors an explicit draggable: true override on a pinned tab', () => {
    const tabs = [tab({ id: 'a', pinned: true, draggable: true }), tab({ id: 'b' })];
    expect(isTabDraggable({ tab: tabs[0]!, tabs })).toBe(true);
  });
});

describe('isTabClosable', () => {
  it('is false without a close handler', () => {
    expect(isTabClosable({ tab: tab({ id: 'a' }), hasCloseHandler: false })).toBe(false);
  });

  it('is true by default with a close handler', () => {
    expect(isTabClosable({ tab: tab({ id: 'a' }), hasCloseHandler: true })).toBe(true);
  });

  it('honors an explicit closable: false', () => {
    expect(isTabClosable({ tab: tab({ id: 'a', closable: false }), hasCloseHandler: true })).toBe(false);
  });

  it('is always false for a pinned tab, even with closable: true', () => {
    expect(isTabClosable({ tab: tab({ id: 'a', pinned: true, closable: true }), hasCloseHandler: true })).toBe(false);
  });
});
