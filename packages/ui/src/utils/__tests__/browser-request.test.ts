// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { requestWithTimeout } from '../browser-request.js';

// REGRESSION: fails if requestWithTimeout calls globalThis.fetch instead of the injected fetch.
it('uses the supplied fetch and composes cancellation with its deadline', async () => {
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    expect(init?.signal).not.toBe(controller.signal);
    controller.abort(new Error('cancelled by host'));
    expect(init?.signal?.aborted).toBe(true);
    expect(init?.signal?.reason).toBe(controller.signal.reason);
    return new Response('ok');
  });
  await requestWithTimeout({ url: '/api/example', timeoutMs: 15_000 }, { fetch, init: { signal: controller.signal } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

// PARITY
it('defaults to global fetch and supplies an abort signal', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
  try {
    await requestWithTimeout({ url: '/api/example', timeoutMs: 15_000 });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  } finally { fetch.mockRestore(); }
});

// REGRESSION: fails if requestWithTimeout wraps a timeout in platform FetchTimeoutError.
it('propagates the browser timeout reason', async () => {
  const timeoutSignal = AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
  try {
    const fetch: typeof globalThis.fetch = async (_url, init) => { throw init?.signal?.reason; };
    await expect(requestWithTimeout({ url: '/api/example', timeoutMs: 15_000 }, { fetch })).rejects.toBe(timeoutSignal.reason);
  } finally { timeout.mockRestore(); }
});
