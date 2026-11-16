import { describe, expect, it } from 'vitest';
import {
  decodeListCursor,
  DEFAULT_LIST_LIMIT,
  DEFAULT_MAX_LIST_LIMIT,
  encodeListCursor,
  listPageForModel,
  pageFromArray,
  pageFromOverfetch,
  parseListPageRequest,
} from '../list-page.js';
import { ToolInputError } from '../tool-input-errors.js';

type Row = { id: string; createdAt: string };
const row = (n: number): Row => ({ id: `id_${n}`, createdAt: `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z` });
const positionOf = (r: Row) => [r.createdAt, r.id] as const;

describe('list cursors', () => {
  it('round-trips a position, including non-ASCII text', () => {
    const cursor = encodeListCursor({ position: ['Zoë ✓', 42, 'id/+='] });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeListCursor({ cursor, shape: ['string', 'number', 'string'] })).toEqual(['Zoë ✓', 42, 'id/+=']);
  });

  it.each([['not-base64!'], [encodeListCursor({ position: ['a'] })], [btoa('{"a":1}')], [btoa('[null,"x"]')]])(
    'refuses a cursor it did not build for this list (%s) instead of restarting at page one',
    (cursor) => {
      expect(() => decodeListCursor({ cursor, shape: ['string', 'string'] })).toThrow(ToolInputError);
    },
  );

  it('refuses a string where the caller expects a number', () => {
    const cursor = encodeListCursor({ position: ['2026-01-01', 'id'] });
    expect(() => decodeListCursor({ cursor, shape: ['number', 'string'] })).toThrow(ToolInputError);
  });
});

describe('parseListPageRequest', () => {
  it('defaults the limit and reads no cursor', () => {
    expect(parseListPageRequest({ value: {} })).toEqual({ limit: DEFAULT_LIST_LIMIT, cursor: null });
  });

  it('reads a query-string limit and a cursor', () => {
    expect(parseListPageRequest({ value: { limit: '25', cursor: 'abc' } })).toEqual({ limit: 25, cursor: 'abc' });
  });

  it('clamps an over-large limit to the ceiling rather than refusing', () => {
    expect(parseListPageRequest({ value: { limit: 10_000 } }, { maxLimit: 100 })).toEqual({ limit: 100, cursor: null });
    expect(parseListPageRequest({ value: { limit: 10_000 } })).toEqual({ limit: DEFAULT_MAX_LIST_LIMIT, cursor: null });
  });

  it('keeps a default above the ceiling within the ceiling', () => {
    expect(parseListPageRequest({ value: {} }, { defaultLimit: 500, maxLimit: 100 }).limit).toBe(100);
  });

  it('treats a null cursor as no cursor', () => {
    expect(parseListPageRequest({ value: { cursor: null } }).cursor).toBeNull();
  });

  it.each([[0], [-1], [1.5], ['ten'], [true]])('refuses limit %p', (limit) => {
    expect(() => parseListPageRequest({ value: { limit } })).toThrow("'limit' must be a whole number of at least 1");
  });

  it.each([[''], [5]])('refuses cursor %p', (cursor) => {
    expect(() => parseListPageRequest({ value: { cursor } })).toThrow("'cursor' must be the nextCursor string");
  });
});

describe('pageFromOverfetch', () => {
  it('returns a cursor at the last kept row when the extra row proves more exist', () => {
    const page = pageFromOverfetch({ rows: [row(1), row(2), row(3)], limit: 2, positionOf });
    expect(page.items).toEqual([row(1), row(2)]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeListCursor({ cursor: page.nextCursor ?? '', shape: ['string', 'string'] })).toEqual(positionOf(row(2)));
  });

  it('returns no cursor on the last page', () => {
    expect(pageFromOverfetch({ rows: [row(1), row(2)], limit: 2, positionOf }).nextCursor).toBeNull();
    expect(pageFromOverfetch({ rows: [], limit: 2, positionOf })).toEqual({ items: [], nextCursor: null });
  });
});

describe('pageFromArray', () => {
  const rows = [row(3), row(1), row(5), row(2), row(4)];

  it('walks every row exactly once across pages, in order', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ReturnType<typeof pageFromArray<Row>> = pageFromArray({ rows, limit: 2, cursor, positionOf, shape: ['string', 'string'] });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(['id_1', 'id_2', 'id_3', 'id_4', 'id_5']);
  });

  it('resumes after a position whose row was deleted', () => {
    const first = pageFromArray({ rows, limit: 2, cursor: null, positionOf, shape: ['string', 'string'] });
    const withoutId2 = rows.filter((r) => r.id !== 'id_2');
    expect(pageFromArray({ rows: withoutId2, limit: 2, cursor: first.nextCursor, positionOf, shape: ['string', 'string'] }).items.map((r) => r.id)).toEqual(['id_3', 'id_4']);
  });

  it('orders numbers numerically', () => {
    const numbered = [{ n: 10 }, { n: 9 }];
    expect(pageFromArray({ rows: numbered, limit: 5, cursor: null, positionOf: (r) => [r.n], shape: ['number'] }).items).toEqual([{ n: 9 }, { n: 10 }]);
  });

  it('answers an empty list with an empty last page', () => {
    expect(pageFromArray({ rows: [], limit: 2, cursor: null, positionOf, shape: ['string', 'string'] })).toEqual({ items: [], nextCursor: null });
  });

  it('refuses a garbage cursor even when the list is empty', () => {
    expect(() => pageFromArray({ rows: [], limit: 5, cursor: 'garbage', positionOf: (r: { id: string }) => [r.id], shape: ['string'] })).toThrow(ToolInputError);
  });
});

describe('listPageForModel', () => {
  it('says plainly that the list is incomplete and how to continue', () => {
    const result = listPageForModel({ page: { items: [1, 2], nextCursor: 'c1' }, toolId: 'members_list' });
    expect(result).toEqual({
      items: [1, 2],
      nextCursor: 'c1',
      more:
        'This is NOT the full list: 2 shown and more exist. To see the rest, call members_list again with the same filters and cursor set to nextCursor. ' +
        'Do not tell the person this is everything.',
    });
  });

  it('adds nothing on the last page', () => {
    expect(listPageForModel({ page: { items: [1], nextCursor: null }, toolId: 'members_list' })).toEqual({ items: [1], nextCursor: null });
  });
});
