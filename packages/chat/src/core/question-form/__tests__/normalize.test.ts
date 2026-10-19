import { describe, expect, it } from 'vitest';
import { asRecord, stringOrUndefined } from '../normalize.js';

describe('asRecord', () => {
  it('returns an object unchanged', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns null for null and for primitives', () => {
    for (const raw of [null, undefined, 0, 'x', true]) expect(asRecord(raw)).toBeNull();
  });
});

describe('stringOrUndefined', () => {
  it('returns a string unchanged, including an empty one', () => {
    expect(stringOrUndefined('')).toBe('');
    expect(stringOrUndefined('x')).toBe('x');
  });

  it('returns undefined for a non-string', () => {
    expect(stringOrUndefined(1)).toBeUndefined();
  });
});
