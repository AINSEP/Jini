import { describe, expect, it } from 'vitest';
import { DEFAULT_FILE_LOCK_MESSAGES, FileLockLostError, FileLockTimeoutError } from '../file-lock.js';

describe('file-lock errors', () => {
  it('uses the default messages', () => {
    const err = new FileLockTimeoutError({ lockPath: '/l', holder: undefined, waitedMs: 1500.4 });
    expect(err.message).toBe('exclusive file lock timed out after 1500ms');
    expect(err.message).toBe(DEFAULT_FILE_LOCK_MESSAGES.fileLockTimeout({ waitedMs: 1500.4 }));
    expect(new FileLockLostError({ lockPath: '/l' }).message).toBe(DEFAULT_FILE_LOCK_MESSAGES.fileLockLost());
  });
  it('prefers an explicit message and keeps name and fields', () => {
    const err = new FileLockTimeoutError({ lockPath: '/l', holder: undefined, waitedMs: 1 }, { message: 'custom' });
    expect([err.message, err.name, err.lockPath, err.waitedMs]).toEqual(['custom', 'FileLockTimeoutError', '/l', 1]);
    expect(err).toBeInstanceOf(Error);
  });
});
