import { describe, expect, it } from 'vitest';
import { createFileSystemReadError, isFileSystemReadError } from '../file-system-errors.js';

describe('createFileSystemReadError / isFileSystemReadError', () => {
  it('wraps an Error cause with the action prefix and a FileSystemReadError name', () => {
    const cause = new Error('permission denied');
    const wrapped = createFileSystemReadError({ action: 'reading dropped folder', error: cause });

    expect(wrapped.name).toBe('FileSystemReadError');
    expect(wrapped.message).toBe('reading dropped folder: Error: permission denied');
    expect(wrapped.cause).toBe(cause);
  });

  it('summarizes a non-Error cause (string) safely', () => {
    const wrapped = createFileSystemReadError({ action: 'reading file', error: 'boom' });
    expect(wrapped.message).toBe('reading file: boom');
  });

  it('summarizes a plain object with name/message fields', () => {
    const wrapped = createFileSystemReadError({ action: 'reading file', error: { name: 'AbortError', message: 'cancelled' } });
    expect(wrapped.message).toBe('reading file: AbortError: cancelled');
  });

  it('falls back to a generic "Error" name for an object without one', () => {
    const wrapped = createFileSystemReadError({ action: 'reading file', error: { message: 'oops' } });
    expect(wrapped.message).toBe('reading file: Error: oops');
  });

  it('falls back to a stringified summary when the object message is not a string', () => {
    const cause = { name: 'AbortError', message: 42 };
    const wrapped = createFileSystemReadError({ action: 'reading file', error: cause });
    expect(wrapped.message).toBe(`reading file: AbortError: ${String(cause)}`);
  });

  it('falls back to a stringified summary for an Error with a blank name and message', () => {
    const cause = new Error('');
    cause.name = '';
    const wrapped = createFileSystemReadError({ action: 'reading file', error: cause });
    expect(wrapped.message).toBe(`reading file: Error: ${String(cause)}`);
  });

  it('isFileSystemReadError distinguishes wrapped errors from ordinary ones', () => {
    const wrapped = createFileSystemReadError({ action: 'reading file', error: new Error('x') });
    expect(isFileSystemReadError(wrapped)).toBe(true);
    expect(isFileSystemReadError(new Error('plain'))).toBe(false);
    expect(isFileSystemReadError('not an error')).toBe(false);
    expect(isFileSystemReadError(null)).toBe(false);
  });
});
