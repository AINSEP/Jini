// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildAssetGridQuery,
  buildFacetLabelMap,
  cardIdsInBand,
  dayHeading,
  dayHeadingResult,
  dayKeyFromTimestamp,
  defaultMatchesKindFilter,
  filterByKind,
  groupByDay,
  isTypingTarget,
  localDayKey,
  mergeIngestedAssets,
  parseLiveUpdateAssetId,
  pruneMissingSelection,
  rangeSelection,
  resolveCheckboxClickAction,
  resolveFacetLabel,
  resolvePreviewClickAction,
  selectAllIds,
  snapshotCardRects,
  toggleSelection,
} from '../rules.js';
import { ASSET_ID_ATTR } from '../constants.js';

interface TestAsset {
  id: string;
  kind: string;
  capturedAt: number;
}

function asset(id: string, kind = 'image', capturedAt = 0): TestAsset {
  return { id, kind, capturedAt };
}

describe('localDayKey / dayKeyFromTimestamp', () => {
  it('formats a local YYYY-MM-DD', () => {
    expect(localDayKey({ date: new Date(2026, 0, 5) })).toBe('2026-01-05');
    expect(localDayKey({ date: new Date(2026, 10, 21) })).toBe('2026-11-21');
  });

  it('derives the same key from an epoch timestamp', () => {
    const d = new Date(2026, 6, 4, 12, 30);
    expect(dayKeyFromTimestamp({ timestampMs: d.getTime() })).toBe(localDayKey({ date: d }));
  });
});

describe('dayHeading', () => {
  const reference = new Date(2026, 6, 17); // 2026-07-17

  it('labels today and yesterday', () => {
    expect(dayHeading({ key: '2026-07-17' }, { referenceDate: reference })).toBe('Today');
    expect(dayHeading({ key: '2026-07-16' }, { referenceDate: reference })).toBe('Yesterday');
  });

  it('formats an older date', () => {
    expect(dayHeading({ key: '2026-07-01' }, { referenceDate: reference })).toBe(
      new Date(2026, 6, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
  });

  it('falls back to the raw key for a malformed bucket', () => {
    expect(dayHeading({ key: 'not-a-date' }, { referenceDate: reference })).toBe('not-a-date');
  });
});

describe('dayHeadingResult', () => {
  const reference = new Date(2026, 6, 17);

  it('marks Today/Yesterday as translatable', () => {
    expect(dayHeadingResult({ key: '2026-07-17' }, { referenceDate: reference })).toEqual({ label: 'Today', translatable: true });
    expect(dayHeadingResult({ key: '2026-07-16' }, { referenceDate: reference })).toEqual({ label: 'Yesterday', translatable: true });
  });

  it('marks a formatted date as not translatable', () => {
    expect(dayHeadingResult({ key: '2026-07-01' }, { referenceDate: reference }).translatable).toBe(false);
  });

  it('marks a malformed key as not translatable', () => {
    expect(dayHeadingResult({ key: 'nope' }, { referenceDate: reference })).toEqual({ label: 'nope', translatable: false });
  });
});

describe('groupByDay', () => {
  it('buckets by day, newest day first, preserving flat index', () => {
    const items = [asset('a', 'image', 3), asset('b', 'image', 1), asset('c', 'image', 2)];
    const getDayKey = (a: TestAsset) => String(a.capturedAt);
    const groups = groupByDay({ items, getDayKey });
    expect(groups.map((g) => g.key)).toEqual(['3', '2', '1']);
    expect(groups[0]!.items).toEqual([{ asset: items[0], index: 0 }]);
    expect(groups[2]!.items).toEqual([{ asset: items[1], index: 1 }]);
  });

  it('collapses non-contiguous same-day items into one bucket', () => {
    const items = [asset('a', 'image', 1), asset('b', 'image', 2), asset('c', 'image', 1)];
    const groups = groupByDay({ items, getDayKey: (a) => String(a.capturedAt) });
    expect(groups.find((g) => g.key === '1')?.items.map((i) => i.asset.id)).toEqual(['a', 'c']);
  });
});

describe('snapshotCardRects', () => {
  it('returns an empty array for a null container', () => {
    expect(snapshotCardRects({ container: null })).toEqual([]);
  });

  it('reads id + bounds off every tagged descendant', () => {
    const container = document.createElement('div');
    const card = document.createElement('div');
    card.setAttribute(ASSET_ID_ATTR, 'card-1');
    card.getBoundingClientRect = () => ({ left: 10, top: 20, right: 110, bottom: 120 }) as DOMRect;
    container.appendChild(card);
    const untagged = document.createElement('div');
    container.appendChild(untagged);

    expect(snapshotCardRects({ container })).toEqual([{ id: 'card-1', left: 10, top: 20, right: 110, bottom: 120 }]);
  });

  it('skips a tagged element whose id attribute is present but empty', () => {
    const container = document.createElement('div');
    const blank = document.createElement('div');
    // The selector `[data-asset-grid-id]` matches on attribute *presence*,
    // so an empty value is a real, reachable case distinct from "untagged".
    blank.setAttribute(ASSET_ID_ATTR, '');
    blank.getBoundingClientRect = () => ({ left: 0, top: 0, right: 5, bottom: 5 }) as DOMRect;
    container.appendChild(blank);

    expect(snapshotCardRects({ container })).toEqual([]);
  });
});

describe('cardIdsInBand', () => {
  const rects = [
    { id: 'a', left: 0, top: 0, right: 10, bottom: 10 },
    { id: 'b', left: 20, top: 20, right: 30, bottom: 30 },
    { id: 'c', left: 100, top: 100, right: 110, bottom: 110 },
  ];

  it('returns ids whose rect intersects the band', () => {
    expect(cardIdsInBand({ rects, band: { x: 0, y: 0, w: 25, h: 25 } }).sort()).toEqual(['a', 'b']);
  });

  it('excludes ids outside the band', () => {
    expect(cardIdsInBand({ rects, band: { x: 0, y: 0, w: 5, h: 5 } })).toEqual(['a']);
  });

  it('returns nothing for an empty band far from every rect', () => {
    expect(cardIdsInBand({ rects, band: { x: 500, y: 500, w: 10, h: 10 } })).toEqual([]);
  });
});

describe('selection helpers', () => {
  it('toggleSelection adds and removes', () => {
    let s = toggleSelection({ prev: new Set(), id: 'a' });
    expect([...s]).toEqual(['a']);
    s = toggleSelection({ prev: s, id: 'a' });
    expect([...s]).toEqual([]);
  });

  it('rangeSelection selects an inclusive range regardless of direction', () => {
    const items = [asset('a'), asset('b'), asset('c'), asset('d')];
    expect([...rangeSelection({ prev: new Set(), items, anchorIndex: 1, targetIndex: 3 })].sort()).toEqual(['b', 'c', 'd']);
    expect([...rangeSelection({ prev: new Set(), items, anchorIndex: 3, targetIndex: 1 })].sort()).toEqual(['b', 'c', 'd']);
  });

  it('rangeSelection preserves prior selections outside the range', () => {
    const items = [asset('a'), asset('b'), asset('c')];
    const prev = new Set(['a']);
    expect([...rangeSelection({ prev, items, anchorIndex: 1, targetIndex: 2 })].sort()).toEqual(['a', 'b', 'c']);
  });

  it('selectAllIds selects every item', () => {
    const items = [asset('a'), asset('b')];
    expect([...selectAllIds({ items })].sort()).toEqual(['a', 'b']);
  });

  it('pruneMissingSelection drops ids no longer present', () => {
    const items = [asset('a'), asset('c')];
    const next = pruneMissingSelection({ prev: new Set(['a', 'b', 'c']), items });
    expect([...next].sort()).toEqual(['a', 'c']);
  });

  it('pruneMissingSelection returns the exact same Set reference when nothing changes (setState bail-out)', () => {
    const items = [asset('a')];
    const prev = new Set(['a']);
    const next = pruneMissingSelection({ prev, items });
    expect(next).toBe(prev);
    expect([...next]).toEqual(['a']);
  });

  it('pruneMissingSelection returns the exact same Set reference when prev is already empty', () => {
    const items = [asset('a')];
    const prev = new Set<string>();
    const next = pruneMissingSelection({ prev, items });
    expect(next).toBe(prev);
  });
});

describe('mergeIngestedAssets', () => {
  it('returns the previous list unchanged (same array reference) when nothing was fetched', () => {
    const prev = [asset('a')];
    const merged = mergeIngestedAssets({ prev, fetched: [] });
    expect(merged).toBe(prev);
  });

  it('prepends new assets latest-first without reordering existing ones', () => {
    const prev = [asset('a'), asset('b')];
    const fetched = [asset('c'), asset('d')];
    expect(mergeIngestedAssets({ prev, fetched }).map((a) => a.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('refreshes an already-present asset in place without reordering', () => {
    const prev = [asset('a', 'image'), asset('b', 'image')];
    const fetched = [asset('a', 'video')];
    const merged = mergeIngestedAssets({ prev, fetched });
    expect(merged.map((a) => a.id)).toEqual(['a', 'b']);
    expect(merged[0]!.kind).toBe('video');
  });
});

describe('parseLiveUpdateAssetId', () => {
  it('parses the configured id field', () => {
    expect(parseLiveUpdateAssetId({ data: '{"id":"x1"}' })).toBe('x1');
    expect(parseLiveUpdateAssetId({ data: '{"assetId":"x2"}' }, { idField: 'assetId' })).toBe('x2');
  });

  it('returns null for non-string data, malformed JSON, or a missing field', () => {
    expect(parseLiveUpdateAssetId({ data: 42 })).toBeNull();
    expect(parseLiveUpdateAssetId({ data: 'not json' })).toBeNull();
    expect(parseLiveUpdateAssetId({ data: '{}' })).toBeNull();
  });
});

describe('buildAssetGridQuery', () => {
  it('omits empty facets and trims search', () => {
    expect(buildAssetGridQuery({ kind: '', source: '', search: '  ' })).toEqual({});
    expect(buildAssetGridQuery({ kind: 'image', source: 'clipper', search: '  cat  ' })).toEqual({
      kind: 'image',
      source: 'clipper',
      search: 'cat',
    });
  });

  it('applies a kind-to-query mapping when supplied', () => {
    const mapKindToQuery = (kind: string) => (kind === 'element' ? 'image' : kind);
    expect(buildAssetGridQuery({ kind: 'element', source: '', search: '' }, { mapKindToQuery })).toEqual({ kind: 'image' });
  });

  it('omits kind entirely when the mapping returns nothing', () => {
    expect(buildAssetGridQuery({ kind: 'element', source: '', search: '' }, { mapKindToQuery: () => undefined })).toEqual({});
  });
});

describe('defaultMatchesKindFilter / filterByKind', () => {
  const getKind = (a: TestAsset) => a.kind;

  it('matches every asset for an empty filter', () => {
    expect(defaultMatchesKindFilter({ asset: asset('a', 'video'), filterValue: '', getKind })).toBe(true);
  });

  it('matches by exact kind equality', () => {
    expect(defaultMatchesKindFilter({ asset: asset('a', 'video'), filterValue: 'video', getKind })).toBe(true);
    expect(defaultMatchesKindFilter({ asset: asset('a', 'video'), filterValue: 'image', getKind })).toBe(false);
  });

  it('filterByKind narrows using the supplied matcher', () => {
    const items = [asset('a', 'image'), asset('b', 'video')];
    expect(filterByKind({ items, filterValue: 'video', matches: (a, v) => a.kind === v }).map((a) => a.id)).toEqual(['b']);
    expect(filterByKind({ items, filterValue: '', matches: (a, v) => a.kind === v })).toEqual(items);
  });
});

describe('resolvePreviewClickAction', () => {
  it('meta or ctrl click toggles selection', () => {
    expect(resolvePreviewClickAction({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe('toggle');
    expect(resolvePreviewClickAction({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe('toggle');
  });

  it('shift click (without meta/ctrl) range-selects', () => {
    expect(resolvePreviewClickAction({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe('range');
  });

  it('a plain click previews', () => {
    expect(resolvePreviewClickAction({ metaKey: false, ctrlKey: false, shiftKey: false })).toBe('preview');
  });

  it('meta/ctrl takes precedence over shift', () => {
    expect(resolvePreviewClickAction({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe('toggle');
  });
});

describe('resolveCheckboxClickAction', () => {
  it('shift click range-selects, a plain click toggles', () => {
    expect(resolveCheckboxClickAction({ shiftKey: true })).toBe('range');
    expect(resolveCheckboxClickAction({ shiftKey: false })).toBe('toggle');
  });
});

describe('buildFacetLabelMap / resolveFacetLabel', () => {
  it('builds a value -> label map from facet options', () => {
    const map = buildFacetLabelMap({ facets: [
      { value: 'image', label: 'Images' },
      { value: 'video', label: 'Video' },
    ] });
    expect(map.get('image')).toBe('Images');
    expect(map.get('video')).toBe('Video');
  });

  it('resolveFacetLabel falls back to the raw value when no facet matches', () => {
    const map = buildFacetLabelMap({ facets: [{ value: 'image', label: 'Images' }] });
    expect(resolveFacetLabel({ value: 'image', labelsByValue: map })).toBe('Images');
    expect(resolveFacetLabel({ value: 'unknown-kind', labelsByValue: map })).toBe('unknown-kind');
  });
});

describe('isTypingTarget', () => {
  it('flags input/textarea/select and contenteditable elements', () => {
    expect(isTypingTarget({ el: document.createElement('input') })).toBe(true);
    expect(isTypingTarget({ el: document.createElement('textarea') })).toBe(true);
    expect(isTypingTarget({ el: document.createElement('select') })).toBe(true);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isTypingTarget({ el: editable })).toBe(true);
  });

  it('does not flag a plain element or null', () => {
    expect(isTypingTarget({ el: document.createElement('button') })).toBe(false);
    expect(isTypingTarget({ el: null })).toBe(false);
  });
});
