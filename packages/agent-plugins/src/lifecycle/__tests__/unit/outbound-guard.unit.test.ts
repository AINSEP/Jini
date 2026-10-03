import { test, expect } from 'vitest';
import { fetchAgentPluginArchive, AgentPluginFetchError } from '../../index.js';

test('guard refuses a redirect before the redirected destination is contacted', async () => {
  const fetched: string[] = [];
  const guarded: string[] = [];
  const action = fetchAgentPluginArchive({
    url: 'https://example.com/archive',
    outboundGuard: { assertAllowed: async ({ url }) => { guarded.push(url); if (url.includes('127.0.0.1')) throw new Error('private destination'); } },
    fetch: async ({ url }, init) => { fetched.push(String(url)); expect(init?.redirect).toBe('manual'); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/archive' } }); },
  });
  await expect(action).rejects.toBeInstanceOf(AgentPluginFetchError);
  await expect(action).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  expect(guarded).toEqual(['https://example.com/archive', 'http://127.0.0.1/archive']);
  expect(fetched).toEqual(['https://example.com/archive']);
});
test('relative redirects are guarded and preserve the final URL even for injected response objects', async () => {
  const guarded: string[] = [];
  let requests = 0;
  const result = await fetchAgentPluginArchive({
    url: 'https://example.com/archive',
    outboundGuard: { assertAllowed: async ({ url }) => { guarded.push(url); } },
    fetch: async () => ++requests === 1 ? new Response(null, { status: 302, headers: { location: '/actual.zip' } }) : new Response(new Uint8Array([1, 2, 3])),
  });
  expect(result.resolvedUrl).toBe('https://example.com/actual.zip');
  expect(guarded).toEqual(['https://example.com/archive', 'https://example.com/actual.zip']);
  expect(Array.from(result.archive)).toEqual([1, 2, 3]);
});
