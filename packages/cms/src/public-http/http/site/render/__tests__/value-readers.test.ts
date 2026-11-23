import { describe, expect, it } from 'vitest';
import { arr, isObject, obj, str } from '../value-readers.js';

describe('template value readers', () => {
  it('reads strings, falling back for every non-string value', () => {
    expect(str({ value: 'title' })).toBe('title');
    expect(str({ value: 3 })).toBe('');
    expect(str({ value: undefined }, { fallback: 'Untitled' })).toBe('Untitled');
    expect(str({ value: null }, { fallback: 'Untitled' })).toBe('Untitled');
  });

  it('reads arrays and plain objects defensively', () => {
    expect(arr({ value: [1, 'a'] })).toEqual([1, 'a']);
    expect(arr({ value: { 0: 1 } })).toEqual([]);
    expect(obj({ value: { a: 1 } })).toEqual({ a: 1 });
    expect(obj({ value: [1] })).toBeUndefined();
    expect(obj({ value: null })).toBeUndefined();
    expect([isObject({}), isObject([]), isObject(null), isObject('x')]).toEqual([true, false, false, false]);
  });
});
