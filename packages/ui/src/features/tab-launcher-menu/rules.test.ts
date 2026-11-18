import { describe, expect, it } from 'vitest';
import {
  clampAnchoredPosition,
  clampSelection,
  filterFiles,
  filterTabs,
  nextSelected,
  presentKinds,
  resolveSelection,
} from './rules.js';
import type { TabLauncherResultItem } from './types.js';

function item(overrides: Partial<TabLauncherResultItem> & { id: string; name: string; kind: string }): TabLauncherResultItem {
  return overrides;
}

describe('clampAnchoredPosition', () => {
  it('hangs the menu below the anchor, right-aligned to it', () => {
    const pos = clampAnchoredPosition({ anchorRect: { top: 10, bottom: 30, right: 400 }, viewportWidth: 1000 });
    expect(pos.top).toBe(36); // bottom + default offset (6)
    expect(pos.left).toBe(60); // right - default width (340)
  });

  it('clamps to the left margin when the anchor is near the left edge', () => {
    const pos = clampAnchoredPosition({ anchorRect: { top: 0, bottom: 20, right: 100 }, viewportWidth: 1000 });
    expect(pos.left).toBe(12); // default margin
  });

  it('clamps to the right margin when the anchor is near the right edge of a narrow viewport', () => {
    const pos = clampAnchoredPosition({ anchorRect: { top: 0, bottom: 20, right: 995 }, viewportWidth: 1000 });
    expect(pos.left).toBe(1000 - 340 - 12);
  });

  it('honors custom width/margin/offset overrides', () => {
    const pos = clampAnchoredPosition({ anchorRect: { top: 0, bottom: 50, right: 500 }, viewportWidth: 800 }, { menuWidth: 200, margin: 4, offset: 10 });
    expect(pos.top).toBe(60);
    expect(pos.left).toBe(300);
  });
});

describe('presentKinds', () => {
  it('returns distinct kinds in first-seen order', () => {
    const files = [
      item({ id: '1', name: 'a', kind: 'image' }),
      item({ id: '2', name: 'b', kind: 'code' }),
      item({ id: '3', name: 'c', kind: 'image' }),
    ];
    expect(presentKinds(files)).toEqual(['image', 'code']);
  });

  it('returns an empty array for an empty list', () => {
    expect(presentKinds([])).toEqual([]);
  });
});

describe('filterFiles', () => {
  const files = [
    item({ id: '1', name: 'apple.png', kind: 'image' }),
    item({ id: '2', name: 'index.html', kind: 'code' }),
    item({ id: '3', name: 'banana.png', kind: 'image' }),
  ];

  it('returns everything for an empty query and "all" filter', () => {
    expect(filterFiles({ files, query: '', kindFilter: 'all' })).toHaveLength(3);
  });

  it('filters by kind', () => {
    expect(filterFiles({ files, query: '', kindFilter: 'image' }).map((f) => f.id)).toEqual(['1', '3']);
  });

  it('filters by a case-insensitive name substring', () => {
    expect(filterFiles({ files, query: 'APPLE', kindFilter: 'all' }).map((f) => f.id)).toEqual(['1']);
  });

  it('combines a kind filter and a query', () => {
    expect(filterFiles({ files, query: 'banana', kindFilter: 'image' }).map((f) => f.id)).toEqual(['3']);
  });

  it('returns no matches when the query matches nothing', () => {
    expect(filterFiles({ files, query: 'zzz', kindFilter: 'all' })).toEqual([]);
  });
});

describe('filterTabs', () => {
  const tabs = [
    item({ id: 't1', name: 'Design system', kind: 'design-system', meta: 'brand-kit' }),
    item({ id: 't2', name: 'Terminal', kind: 'terminal' }),
  ];

  it('returns [] entirely once a kind filter is active (tabs are file-only-filterable)', () => {
    expect(filterTabs({ tabs, query: '', kindFilter: 'image' })).toEqual([]);
  });

  it('returns everything for an empty query under "all"', () => {
    expect(filterTabs({ tabs, query: '', kindFilter: 'all' })).toHaveLength(2);
  });

  it('matches against name, kind, and meta', () => {
    expect(filterTabs({ tabs, query: 'brand-kit', kindFilter: 'all' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTabs({ tabs, query: 'terminal', kindFilter: 'all' }).map((t) => t.id)).toEqual(['t2']);
  });

  it('caps at maxResults', () => {
    const many = Array.from({ length: 5 }, (_, i) => item({ id: `t${i}`, name: `tab ${i}`, kind: 'file' }));
    expect(filterTabs({ tabs: many, query: '', kindFilter: 'all' }, { maxResults: 2 })).toHaveLength(2);
  });
});

describe('clampSelection', () => {
  it('collapses to 0 once the result set is empty', () => {
    expect(clampSelection({ current: 3, count: 0 })).toBe(0);
  });

  it('leaves an in-range selection unchanged', () => {
    expect(clampSelection({ current: 1, count: 5 })).toBe(1);
  });

  it('clamps down when the result set shrinks past the current selection', () => {
    expect(clampSelection({ current: 4, count: 2 })).toBe(1);
  });
});

describe('nextSelected', () => {
  it('advances forward and wraps at the end', () => {
    expect(nextSelected({ current: 0, count: 3, direction: 1 })).toBe(1);
    expect(nextSelected({ current: 2, count: 3, direction: 1 })).toBe(0);
  });

  it('advances backward and wraps at the start', () => {
    expect(nextSelected({ current: 1, count: 3, direction: -1 })).toBe(0);
    expect(nextSelected({ current: 0, count: 3, direction: -1 })).toBe(2);
  });

  it('returns 0 for an empty result set', () => {
    expect(nextSelected({ current: 0, count: 0, direction: 1 })).toBe(0);
    expect(nextSelected({ current: 0, count: 0, direction: -1 })).toBe(0);
  });
});

describe('resolveSelection', () => {
  it('resolves an index within the file range', () => {
    expect(resolveSelection({ selected: 1, filesCount: 3 })).toEqual({ zone: 'file', index: 1 });
  });

  it('resolves an index past the file range into the tab range', () => {
    expect(resolveSelection({ selected: 3, filesCount: 3 })).toEqual({ zone: 'tab', index: 0 });
    expect(resolveSelection({ selected: 4, filesCount: 3 })).toEqual({ zone: 'tab', index: 1 });
  });

  it('resolves into the tab range when there are no files at all', () => {
    expect(resolveSelection({ selected: 0, filesCount: 0 })).toEqual({ zone: 'tab', index: 0 });
  });
});
