import { describe, expect, it } from 'vitest';
import { ShellError } from '../shell.js';

describe('ShellError', () => {
  it('is a named Error subclass', () => {
    const error = new ShellError({ message: 'boom' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ShellError');
    expect(error.message).toBe('boom');
  });
});
