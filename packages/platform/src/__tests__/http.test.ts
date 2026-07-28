import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForHttpOk } from '../http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('@injini/platform — http — waitForHttpOk', () => {
  it('stringifies a thrown non-Error value from fetch instead of reading .message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'network is down';
      }),
    );
    await expect(waitForHttpOk('http://127.0.0.1:1/', { timeoutMs: 50 })).rejects.toThrow(/network is down/);
  });

  it('omits the parenthesized last-error suffix when the timeout elapses before any attempt runs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(waitForHttpOk('http://127.0.0.1:1/', { timeoutMs: 0 })).rejects.toThrow(
      'timed out waiting for http://127.0.0.1:1/',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
