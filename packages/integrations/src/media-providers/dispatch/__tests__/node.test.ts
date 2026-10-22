import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeMediaHttpClient } from '../node.js';
import { fetchMediaOutbound } from '../outbound.js';
import { testPinnedRequests } from './outbound-fixtures.js';

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('./outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});

afterEach(() => { vi.unstubAllGlobals(); testPinnedRequests.length = 0; });

describe('explicit Node media client', () => {
  const url = 'https://cdn.example/asset';

  it('retains the former default policy and refuses mixed DNS answers before transport', async () => {
    const httpClient = createNodeMediaHttpClient({}, { dns: { resolve: async () => ['93.184.216.34', '10.0.0.5'] } });
    await expect(fetchMediaOutbound({ url, timeoutMs: 500 }, { httpClient })).rejects.toThrow(/rejected/);
    expect(testPinnedRequests).toHaveLength(0);
  });

  it('retains 96 MiB buffering and the original total deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes')));
    const httpClient = createNodeMediaHttpClient({});
    expect(await (await fetchMediaOutbound({ url, timeoutMs: 500 }, { httpClient })).text()).toBe('bytes');
    expect(testPinnedRequests[0]).toMatchObject({ maxResponseBytes: 96 * 1024 * 1024, totalDeadlineMs: 500 });
  });

  it('requires explicit private-network opt-in and still refuses redirects', async () => {
    const url = 'http://127.0.0.1/asset';
    const raw = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/other' } }));
    vi.stubGlobal('fetch', raw);
    await expect(fetchMediaOutbound({ url, timeoutMs: 500 }, { httpClient: createNodeMediaHttpClient({}) }))
      .rejects.toThrow(/rejected/);
    expect(raw).not.toHaveBeenCalled();
    await expect(fetchMediaOutbound({ url, timeoutMs: 500 }, {
      httpClient: createNodeMediaHttpClient({}, { allowPrivateNetwork: true }), init: { redirect: 'follow' },
    })).rejects.toThrow(/redirect/);
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
