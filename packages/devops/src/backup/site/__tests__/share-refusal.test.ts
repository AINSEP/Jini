import { describe, expect, it } from 'vitest';
import { archiveRefusalName, SiteShareRefusal } from '../share-refusal.js';

describe('SiteShareRefusal', () => {
  it('carries code, message, name and cause and is an Error', () => {
    const cause = new Error('inner');
    const refusal = new SiteShareRefusal({ code: 'LIMIT_EXCEEDED', message: 'too big' }, { cause });
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toBeInstanceOf(SiteShareRefusal);
    expect(refusal.code).toBe('LIMIT_EXCEEDED');
    expect(refusal.message).toBe('too big');
    expect(refusal.name).toBe('SiteShareRefusal');
    expect(refusal.cause).toBe(cause);
  });

  it('has no cause when none is given', () => {
    expect(new SiteShareRefusal({ code: 'X', message: 'm' }).cause).toBeUndefined();
  });
});

describe('archiveRefusalName', () => {
  it('strips control and format characters', () => {
    expect(archiveRefusalName({ name: 'a\u0000b‮c​d' })).toBe('abcd');
  });
  it('keeps a name of exactly 120 units', () => {
    const name = 'a'.repeat(120);
    expect(archiveRefusalName({ name })).toBe(name);
  });
  it('truncates longer names to 119 units plus an ellipsis', () => {
    expect(archiveRefusalName({ name: 'a'.repeat(121) })).toBe('a'.repeat(119) + '…');
  });
  it('does not split an astral character at the boundary', () => {
    const name = 'a'.repeat(119) + '😀' + 'b';
    expect(archiveRefusalName({ name })).toBe('a'.repeat(119) + '…');
  });
});
