import { describe, expect, it } from 'vitest';
import { LISTING_AFTER_MAX, arrayListingSource, readListingBatch, type ListingSource } from '../batch.js';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** A source over `rows(total)` that records every page it was asked for. */
function recordingSource(total: number): { source: ListingSource<number>; pages: { offset: number; limit: number }[] } {
  const pages: { offset: number; limit: number }[] = [];
  const source: ListingSource<number> = async (page) => {
    pages.push(page);
    return rows(total).slice(page.offset, page.offset + page.limit);
  };
  return { source, pages };
}

describe('readListingBatch cursor bounds', () => {
  it('clamps a negative cursor to the first row', async () => {
    expect(await readListingBatch({ source: arrayListingSource({ rows: rows(5) }), after: -4, size: 2 })).toEqual({ items: [1, 2], hasMore: true, next: 2 });
  });

  it('floors a fractional cursor', async () => {
    expect(await readListingBatch({ source: arrayListingSource({ rows: rows(5) }), after: 1.9, size: 2 })).toEqual({ items: [2, 3], hasMore: true, next: 3 });
  });

  it('clamps a cursor past LISTING_AFTER_MAX to that ceiling before reading', async () => {
    const { source, pages } = recordingSource(0);
    expect(await readListingBatch({ source, after: LISTING_AFTER_MAX + 50, size: 2 })).toEqual({ items: [], hasMore: false, next: LISTING_AFTER_MAX });
    expect(pages).toEqual([{ offset: LISTING_AFTER_MAX, limit: 3 }]);
  });

  it('passes a NaN cursor through unclamped, so next comes back NaN (reported, not fixed)', async () => {
    expect(await readListingBatch({ source: arrayListingSource({ rows: rows(5) }), after: Number.NaN, size: 2 })).toEqual({ items: [], hasMore: false, next: Number.NaN });
  });
});

describe('readListingBatch source reads', () => {
  it('asks each round for size + 1 rows at the advancing cursor, until a short round ends the scan', async () => {
    const { source, pages } = recordingSource(4);
    expect(await readListingBatch({ source, after: 0, size: 3 }, { isVisible: (n) => n > 3 })).toEqual({ items: [4], hasMore: false, next: 4 });
    expect(pages).toEqual([{ offset: 0, limit: 4 }, { offset: 4, limit: 4 }]);
  });

  it('continues into a second round when the first round held hidden rows', async () => {
    const { source, pages } = recordingSource(10);
    expect(await readListingBatch({ source, after: 0, size: 2 }, { isVisible: (n) => n > 3 })).toEqual({ items: [4, 5], hasMore: true, next: 5 });
    expect(pages).toEqual([{ offset: 0, limit: 3 }, { offset: 3, limit: 3 }]);
  });

  it('leaves a visible row after a full batch unconsumed, even mid-round', async () => {
    const { source } = recordingSource(10);
    expect(await readListingBatch({ source, after: 0, size: 1 }, { isVisible: (n) => n !== 2 })).toEqual({ items: [1], hasMore: true, next: 2 });
  });

  it('reports more when the full batch ends a round exactly and the extra row is hidden but more rows follow', async () => {
    const { source, pages } = recordingSource(10);
    expect(await readListingBatch({ source, after: 0, size: 2 }, { isVisible: (n) => n !== 3 })).toEqual({ items: [1, 2], hasMore: true, next: 3 });
    expect(pages).toEqual([{ offset: 0, limit: 3 }, { offset: 3, limit: 3 }]);
  });
});

describe('arrayListingSource', () => {
  it('slices the requested page out of the array', async () => {
    expect(await arrayListingSource({ rows: rows(10) })({ offset: 7, limit: 5 })).toEqual([8, 9, 10]);
  });
});
