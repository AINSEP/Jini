// @vitest-environment node
//
// The SSR half of `host-message-source.ts`'s `typeof window` guard. A server render imports the
// module like any other; if it reached for `window.addEventListener` unconditionally it would throw
// at import time and take the whole render with it. Same file, different environment — which is
// also how this package covers `utils/dom-subscriptions` and `utils/zip`.
import { describe, expect, it, vi } from 'vitest';

describe('host-message-source under SSR', () => {
  it('imports without a window and still hands out a working (empty) buffer', async () => {
    expect(globalThis.window).toBeUndefined();
    const module = await import('../host-message-source.js');
    expect(module.viewMessageBacklogSize()).toBe(0);

    const handler = vi.fn();
    const unsubscribe = module.subscribeToViewMessages(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
