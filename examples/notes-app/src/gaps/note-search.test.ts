/** @file Text search over note rows: case, fields, whitespace, position of the match and the limit boundary. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterNotesByText } from './note-search.ts';

const row = (title: string, body = '') => ({ title, body });
const titles = (rows: readonly { title: string }[]) => rows.map((r) => r.title);

describe('filterNotesByText', () => {
  it('finds the matching row whether it is first, in the middle or last, and nothing else', () => {
    for (const hitAt of [0, 1, 2]) {
      const rows = [row('a'), row('b'), row('c')].map((r, i) => (i === hitAt ? row('needle') : r));
      assert.deepEqual(titles(filterNotesByText({ rows, text: 'needle' })), ['needle']);
    }
  });

  it('is case-insensitive, matches a substring and trims the query', () => {
    assert.deepEqual(titles(filterNotesByText({ rows: [row('Buy MILK')], text: '  milk ' })), ['Buy MILK']);
  });

  it('matches the body alone, and a row matching in both fields appears once', () => {
    const rows = [row('plain', 'has the needle inside'), row('needle', 'needle'), row('other')];
    assert.deepEqual(titles(filterNotesByText({ rows, text: 'needle' })), ['plain', 'needle']);
  });

  it('returns every row for an empty or whitespace-only query', () => {
    const rows = [row('a'), row('b')];
    assert.equal(filterNotesByText({ rows, text: '' }).length, 2);
    assert.equal(filterNotesByText({ rows, text: ' \t ' }).length, 2);
  });

  it('caps the result at limit: limit-1, limit and limit+1 matching rows', () => {
    const make = (count: number) => Array.from({ length: count }, (_, i) => row(`hit ${i}`));
    assert.equal(filterNotesByText({ rows: make(2), text: 'hit' }, { limit: 3 }).length, 2);
    assert.equal(filterNotesByText({ rows: make(3), text: 'hit' }, { limit: 3 }).length, 3);
    assert.equal(filterNotesByText({ rows: make(4), text: 'hit' }, { limit: 3 }).length, 3);
    assert.equal(filterNotesByText({ rows: make(4), text: '' }, { limit: 3 }).length, 3);
  });

  it('does not cap without a limit, and does not change its input', () => {
    const rows = Array.from({ length: 300 }, (_, i) => row(`n${i}`));
    assert.equal(filterNotesByText({ rows, text: '' }).length, 300);
    assert.equal(rows.length, 300);
  });
});
