import { describe, expect, it } from 'vitest';

import { SandboxOperationError } from '../errors.js';

describe('SandboxOperationError', () => {
  it('is a real Error carrying a backend-neutral category', () => {
    const error = new SandboxOperationError('port-in-use', 'port 5173 is already in use');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SandboxOperationError');
    expect(error.category).toBe('port-in-use');
    expect(error.message).toBe('port 5173 is already in use');
  });

  it('exposes the backend-specific detail through the standard cause field, not a bespoke one', () => {
    const originalNodeError = new Error('ENOENT: no such file or directory');

    const error = new SandboxOperationError('not-found', 'file not found', {
      cause: originalNodeError,
    });

    expect(error.cause).toBe(originalNodeError);
  });

  it('has no cause when none is given, rather than a stray undefined-shaped property', () => {
    const error = new SandboxOperationError('unknown', 'something went wrong');

    expect('cause' in error).toBe(false);
  });
});
