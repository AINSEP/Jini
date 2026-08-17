import { afterEach, describe, expect, it, vi } from 'vitest';

import { FETCH_TIMEOUT_MS, FetchTimeoutError, fetchWithTimeout } from '../fetch-with-timeout.js';

/**
 * A `fetch` stand-in that mirrors real fetch/undici's abort contract: it never settles on its own
 * (simulating a remote that accepted the connection and then never responded — the exact failure
 * shape the audit this fixes is about), and rejects with whatever `signal.reason` reports the moment
 * the signal it was given aborts. Using this instead of an arbitrary resolve/reject means the tests
 * below exercise `fetchWithTimeout`'s real interaction with `AbortSignal.timeout`/`AbortSignal.any`,
 * not just its own error-wrapping logic in isolation.
 */
function stubHangingFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn((_url: string | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      });
    });
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  it('resolves normally when the real fetch settles before the timeout', async () => {
    const response = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(fetchWithTimeout('https://example.test/', {}, { timeoutMs: 5000 })).resolves.toBe(response);
  });

  it('rejects with FetchTimeoutError once the timeout elapses before a hung fetch ever settles', async () => {
    stubHangingFetch();

    const promise = fetchWithTimeout('https://example.test/slow', {}, { timeoutMs: 20 });
    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
    await expect(promise).rejects.toThrow('fetch timed out after 20ms: https://example.test/slow');
  });

  it('the thrown FetchTimeoutError carries the url and timeoutMs for a caller to log/branch on', async () => {
    stubHangingFetch();

    try {
      await fetchWithTimeout('https://example.test/slow', {}, { timeoutMs: 15 });
      expect.unreachable('expected fetchWithTimeout to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(FetchTimeoutError);
      const timeoutError = error as FetchTimeoutError;
      expect(timeoutError.url).toBe('https://example.test/slow');
      expect(timeoutError.timeoutMs).toBe(15);
    }
  });

  it('propagates the caller-supplied signal aborting UNWRAPPED — not as a FetchTimeoutError — when it fires before the timeout', async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const abortReason = new Error('user cancelled the upload');
    setTimeout(() => controller.abort(abortReason), 5);

    const promise = fetchWithTimeout('https://example.test/upload', { signal: controller.signal }, { timeoutMs: 5000 });
    await expect(promise).rejects.toBe(abortReason);
    await expect(promise).rejects.not.toBeInstanceOf(FetchTimeoutError);
  });

  it('still combines the timeout even when the caller also supplies their own signal — the timeout can fire fetch abort independently', async () => {
    stubHangingFetch();
    const controller = new AbortController();
    // The caller's own signal never fires in this test — only the (much shorter) timeout should.

    const promise = fetchWithTimeout('https://example.test/upload', { signal: controller.signal }, { timeoutMs: 20 });
    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('passes through a genuine (non-abort) fetch rejection unchanged, not wrapped', async () => {
    const networkError = new Error('ECONNREFUSED');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw networkError;
      }),
    );

    const promise = fetchWithTimeout('https://example.test/', {}, { timeoutMs: 5000 });
    await expect(promise).rejects.toBe(networkError);
    await expect(promise).rejects.not.toBeInstanceOf(FetchTimeoutError);
  });

  it('forwards every other init field to the real fetch unchanged', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchWithTimeout(
      'https://example.test/',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
      { timeoutMs: 5000 },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit] | undefined;
    if (!call) throw new Error('expected fetch to have been called');
    const [, receivedInit] = call;
    expect(receivedInit.method).toBe('POST');
    expect(receivedInit.headers).toEqual({ 'content-type': 'application/json' });
    expect(receivedInit.body).toBe('{"a":1}');
    expect(receivedInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a URL object, not just a string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    await expect(
      fetchWithTimeout(new URL('https://example.test/x'), {}, { timeoutMs: 5000 }),
    ).resolves.toBeInstanceOf(Response);
  });
});

describe('FETCH_TIMEOUT_MS', () => {
  it('defines QUICK, DEPLOY, and UPLOAD as positive, ascending timeouts', () => {
    expect(FETCH_TIMEOUT_MS.QUICK).toBeGreaterThan(0);
    expect(FETCH_TIMEOUT_MS.DEPLOY).toBeGreaterThan(FETCH_TIMEOUT_MS.QUICK);
    expect(FETCH_TIMEOUT_MS.UPLOAD).toBeGreaterThan(FETCH_TIMEOUT_MS.DEPLOY);
    expect(FETCH_TIMEOUT_MS.GENERATE).toBeGreaterThan(FETCH_TIMEOUT_MS.UPLOAD);
  });
});
