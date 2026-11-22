import { describe, expect, it } from 'vitest';
import { errorCodeOf, errorMessageOf } from '../errors.js';

describe('errorCodeOf', () => {
  it('returns string codes and stringifies numeric codes', () => {
    expect(errorCodeOf({ error: { code: 'ENOENT' } })).toBe('ENOENT');
    expect(errorCodeOf({ error: { code: 42 } })).toBe('42');
  });

  it('returns null for missing or nullish codes and non-objects', () => {
    expect(errorCodeOf({ error: {} })).toBeNull();
    expect(errorCodeOf({ error: { code: null } })).toBeNull();
    expect(errorCodeOf({ error: { code: undefined } })).toBeNull();
    expect(errorCodeOf({ error: null })).toBeNull();
    expect(errorCodeOf({ error: 'ENOENT' })).toBeNull();
  });
});

describe('errorMessageOf', () => {
  it('returns an Error message or stringifies a non-Error', () => {
    expect(errorMessageOf({ error: new Error('failed') })).toBe('failed');
    expect(errorMessageOf({ error: 42 })).toBe('42');
    expect(errorMessageOf({ error: null })).toBe('null');
  });
});
