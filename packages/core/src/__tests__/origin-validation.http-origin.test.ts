import { describe, expect, it } from 'vitest';
import { httpOriginOf } from '../origin-validation.js';

describe('httpOriginOf', () => {
  it('returns the protocol://host[:port] origin of an absolute http(s) URL', () => {
    expect(httpOriginOf({ value: 'https://Example.com/admin/x?y=1' })).toBe('https://example.com');
    expect(httpOriginOf({ value: 'http://localhost:8080/' })).toBe('http://localhost:8080');
  });
  it('degrades to undefined for another scheme or an unparseable value, never throwing', () => {
    expect(httpOriginOf({ value: 'ftp://example.com' })).toBeUndefined();
    expect(httpOriginOf({ value: 'javascript:alert(1)' })).toBeUndefined();
    expect(httpOriginOf({ value: 'not a url' })).toBeUndefined();
    expect(httpOriginOf({ value: '' })).toBeUndefined();
  });
});
