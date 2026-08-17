import { describe, expect, it } from 'vitest';

import { categorizeE2bError } from '../categorize-e2b-error.js';

/** A plain object shaped like the real SDK's error classes — carrying just the `.name` this
 *  function keys on, not importing the real classes (see the file's own doc for why). */
function errorNamed(name: string): Error {
  const error = new Error(`${name} happened`);
  error.name = name;
  return error;
}

describe('categorizeE2bError', () => {
  it('maps known E2B SDK error names to their category', () => {
    expect(categorizeE2bError(errorNamed('AuthenticationError'))).toBe('permission-denied');
    expect(categorizeE2bError(errorNamed('FileNotFoundError'))).toBe('not-found');
    expect(categorizeE2bError(errorNamed('NotFoundError'))).toBe('not-found');
    expect(categorizeE2bError(errorNamed('SandboxNotFoundError'))).toBe('not-found');
    expect(categorizeE2bError(errorNamed('TimeoutError'))).toBe('timeout');
    expect(categorizeE2bError(errorNamed('RateLimitError'))).toBe('unavailable');
    expect(categorizeE2bError(errorNamed('NotEnoughSpaceError'))).toBe('unavailable');
  });

  it('falls through to unknown for an Error whose name is not in the known set', () => {
    expect(categorizeE2bError(errorNamed('InvalidArgumentError'))).toBe('unknown');
    expect(categorizeE2bError(new Error('plain error, default name'))).toBe('unknown');
  });

  it('falls through to unknown for a thrown value that is not an Error at all', () => {
    expect(categorizeE2bError('a plain string throw')).toBe('unknown');
    expect(categorizeE2bError({ name: 'AuthenticationError' })).toBe('unknown');
    expect(categorizeE2bError(undefined)).toBe('unknown');
  });
});
