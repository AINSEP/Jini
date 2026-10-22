import { lookup } from 'node:dns';
import { expect, it, vi } from 'vitest';
import { Agent } from 'undici';
import { createNodeReachabilityPorts } from '../node.js';

// REGRESSION: fails if the Node default transport stops attaching the validating dispatcher.
it('pairs the synchronous URL guard with a connection-time validating fetch transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response());
  const ports = createNodeReachabilityPorts({}, { fetch });
  expect(() => ports.guard.assertSafeUrl({ raw: 'https://127.0.0.1', label: 'deployment' })).toThrow('private address');
  const controller = new AbortController();
  await ports.fetch({ url: 'https://example.test/' }, { init: { method: 'HEAD', redirect: 'manual', signal: controller.signal } });
  expect(fetch).toHaveBeenCalledWith('https://example.test/', expect.objectContaining({
    dispatcher: expect.any(Agent), redirect: 'manual', signal: controller.signal,
  }));
});

// REGRESSION: fails if the custom-lookup branch recreates its dispatcher on each fetch.
it('reuses a custom lookup binding pool across requests', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response());
  const ports = createNodeReachabilityPorts({}, { fetch, lookupImpl: lookup });
  await ports.fetch({ url: 'https://example.test/' });
  await ports.fetch({ url: 'https://example.test/again' });
  const first = fetch.mock.calls[0]?.[1];
  const second = fetch.mock.calls[1]?.[1];
  if (!first || !('dispatcher' in first) || !second || !('dispatcher' in second)) throw new Error('dispatcher missing');
  expect(second.dispatcher).toBe(first.dispatcher);
});
