import { describe, expect, it } from 'vitest';

import {
  buildUpsertChangeEvent,
  containsPathSeparatorOrNul,
  hasInvalidSubdirLength,
  isMultiSegmentOrAbsoluteWin32Path,
  isReservedRelativeSegment,
  isValidUpsertInput,
  resolveUpsertEntryId,
  type NoteEntrySummary,
} from '../note-store.js';

describe('hasInvalidSubdirLength', () => {
  it('is true for a non-string, an empty string, or a string over 128 characters', () => {
    expect(hasInvalidSubdirLength(42)).toBe(true);
    expect(hasInvalidSubdirLength('')).toBe(true);
    expect(hasInvalidSubdirLength('x'.repeat(129))).toBe(true);
  });

  it('is false for a non-empty string of at most 128 characters, including the boundary', () => {
    expect(hasInvalidSubdirLength('notes')).toBe(false);
    expect(hasInvalidSubdirLength('x'.repeat(128))).toBe(false);
  });
});

describe('isReservedRelativeSegment', () => {
  it('is true only for "." and ".."', () => {
    expect(isReservedRelativeSegment('.')).toBe(true);
    expect(isReservedRelativeSegment('..')).toBe(true);
  });

  it('is false for any other segment, including one that merely contains dots', () => {
    expect(isReservedRelativeSegment('notes')).toBe(false);
    expect(isReservedRelativeSegment('...')).toBe(false);
  });
});

describe('containsPathSeparatorOrNul', () => {
  it('is true for a forward slash, a backslash, or an embedded NUL', () => {
    expect(containsPathSeparatorOrNul('a/b')).toBe(true);
    expect(containsPathSeparatorOrNul('a\\b')).toBe(true);
    expect(containsPathSeparatorOrNul('a\0b')).toBe(true);
  });

  it('is false for a plain segment', () => {
    expect(containsPathSeparatorOrNul('notes')).toBe(false);
  });
});

describe('isMultiSegmentOrAbsoluteWin32Path', () => {
  it('is true for a POSIX-absolute path', () => {
    expect(isMultiSegmentOrAbsoluteWin32Path('/etc')).toBe(true);
  });

  it('is true for a Windows drive-relative segment with no separator', () => {
    expect(isMultiSegmentOrAbsoluteWin32Path('C:foo')).toBe(true);
  });

  it('is false for a plain single-segment name', () => {
    expect(isMultiSegmentOrAbsoluteWin32Path('my-notes')).toBe(false);
  });
});

describe('isValidUpsertInput', () => {
  const isType = (type: unknown): boolean => type === 'user';

  it('is true when name is non-empty and type is recognized', () => {
    expect(isValidUpsertInput({ name: 'Role', type: 'user' }, { isType })).toBe(true);
  });

  it('is false when name is empty', () => {
    expect(isValidUpsertInput({ name: '', type: 'user' }, { isType })).toBe(false);
  });

  it('is false when type is not recognized', () => {
    expect(isValidUpsertInput({ name: 'Role', type: 'bogus' }, { isType })).toBe(false);
  });
});

describe('resolveUpsertEntryId', () => {
  const isId = (id: string): boolean => /^[a-z0-9_]+$/.test(id);
  const deriveId = (type: string, name: string): string => `${type}_${name.toLowerCase()}`;

  it('uses the caller-supplied id when it is present and well-formed', () => {
    expect(resolveUpsertEntryId({ id: 'user_custom', type: 'user', name: 'Custom' }, { isId, deriveId })).toBe('user_custom');
  });

  it('derives an id when no caller id was supplied', () => {
    expect(resolveUpsertEntryId({ type: 'user', name: 'Role' }, { isId, deriveId })).toBe('user_role');
  });

  it('derives an id when the caller-supplied id is malformed', () => {
    expect(resolveUpsertEntryId({ id: 'Not Valid!', type: 'user', name: 'Fallback' }, { isId, deriveId })).toBe('user_fallback');
  });

  it('derives an id when the caller-supplied id is an empty (falsy) string', () => {
    expect(resolveUpsertEntryId({ id: '', type: 'user', name: 'Role' }, { isId, deriveId })).toBe('user_role');
  });
});

describe('buildUpsertChangeEvent', () => {
  const entry: NoteEntrySummary = { id: 'user_a', name: 'A', description: 'desc', type: 'user', updatedAt: 0 };

  it('omits the source field entirely when none was supplied', () => {
    const event = buildUpsertChangeEvent({ entry });
    expect(event).toEqual({ kind: 'upsert', id: 'user_a', name: 'A', description: 'desc', type: 'user' });
    expect('source' in event).toBe(false);
  });

  it('omits the source field when explicitly supplied as undefined', () => {
    const event = buildUpsertChangeEvent({ entry }, { source: undefined });
    expect('source' in event).toBe(false);
  });

  it('includes the source field when one was supplied', () => {
    const event = buildUpsertChangeEvent({ entry }, { source: 'heuristic' });
    expect(event).toMatchObject({ source: 'heuristic' });
  });
});
