import { describe, expect, it } from 'vitest';
import { bearerTokenFromHeader } from '../auth.js';

describe('bearerTokenFromHeader grammar', () => {
  it.each([
    ['Bearer abc', 'abc'], ['bearer abc', 'abc'], ['BEARER  abc  ', 'abc'], ['Bearer\tabc', 'abc'],
    ['xBearer abc', null], ['Bearer abc def', null], ['Bearer', null], ['Bearer ', null], ['Basic abc', null], ['', null], [undefined, null], ['Token Bearer abc', null],
  ])('%j → %j', (header, expected) => {
    expect(bearerTokenFromHeader({ header })).toBe(expected);
  });
});

describe('bearerTokenFromHeader', () => {
  it('extracts the token from a well-formed header, scheme case-insensitively', () => {
    expect(bearerTokenFromHeader({ header: 'Bearer abc123' })).toBe('abc123');
    expect(bearerTokenFromHeader({ header: 'bearer abc123' })).toBe('abc123');
    expect(bearerTokenFromHeader({ header: 'BEARER abc123' })).toBe('abc123');
  });
  it('tolerates extra surrounding whitespace', () => {
    expect(bearerTokenFromHeader({ header: 'Bearer   abc123  ' })).toBe('abc123');
  });
  it('returns null for an absent, empty, or non-bearer header', () => {
    for (const header of [undefined, '', 'Basic abc123', 'Bearer', 'Bearer ']) expect(bearerTokenFromHeader({ header })).toBeNull();
  });
});
