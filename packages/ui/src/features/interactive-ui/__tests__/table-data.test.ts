import { describe, expect, it } from 'vitest';
import { getNumericColumnKeys, sortTableRows } from '../table-data.js';

describe('shared table data', () => {
  it('recognizes finite numeric values and strings but excludes mixed, empty and nonfinite columns', () => {
    const columns = ['amount', 'mixed', 'empty', 'infinite', 'hex', 'bool'].map((key) => ({ key }));
    const rows = [
      { amount: 0, mixed: 2, empty: null, infinite: Infinity, hex: '0xff', bool: true },
      { amount: ' -1.5e2 ', mixed: 'unknown', empty: '', infinite: '1e999' },
      { amount: null },
    ];
    expect([...getNumericColumnKeys({ columns, rows })]).toEqual(['amount']);
    expect([...getNumericColumnKeys({ columns, rows: [] })]).toEqual([]);
  });

  it('preserves equal-value order and keeps every empty value last in both directions', () => {
    const rows = [{ amount: null }, { amount: 2 }, { amount: '' }, { amount: 2 }, {}, { amount: 1 }];
    const numericKeys = new Set(['amount']);
    const ascending = sortTableRows({ rows, numericKeys, sort: { key: 'amount', direction: 'ascending' } });
    const descending = sortTableRows({ rows, numericKeys, sort: { key: 'amount', direction: 'descending' } });
    expect(ascending.map(({ index }) => index)).toEqual([5, 1, 3, 0, 2, 4]);
    expect(descending.map(({ index }) => index)).toEqual([1, 3, 5, 0, 2, 4]);
    expect(ascending[1]!.row).toBe(rows[1]);
    expect(sortTableRows({ rows, numericKeys, sort: null }).map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
