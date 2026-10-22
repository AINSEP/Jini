import { expect } from 'vitest';
export { describe, expect, it, vi } from 'vitest';

declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveBeenCalledExactlyOnceWith(...args: unknown[]): void;
  }
}

// The host uses Vitest 4; this package uses Vitest 2. Preserve the copied assertion by composing
// its two existing built-in matchers, without changing the shared runner/config or weakening it.
expect.extend({
  toHaveBeenCalledExactlyOnceWith(received: unknown, ...args: unknown[]) {
    try {
      expect(received).toHaveBeenCalledTimes(1);
      expect(received).toHaveBeenCalledWith(...args);
      return { pass: true, message: () => 'Expected the mock not to have exactly one call with these arguments' };
    } catch (error) {
      return { pass: false, message: () => error instanceof Error ? error.message : String(error) };
    }
  },
});
