import type { LookupFunction } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createNodeReachabilityPorts } from '../node.js';

const state = vi.hoisted(() => { const lookups: LookupFunction[] = []; return { lookups }; });
vi.mock('undici', () => ({ Agent: class {
  constructor({ connect }: { connect: { lookup: LookupFunction } }) { state.lookups.push(connect.lookup); }
} }));
vi.mock('@jini-ai/platform', () => ({
  assertSafePublicUrl: (raw: string) => new URL(raw),
  createValidatingLookup: () => (_host: string, _options: unknown, callback: (error: Error | null, address?: unknown) => void) => callback(null, undefined),
}));

// REGRESSION: fails if createDispatcher forwards untyped invalid addresses directly to the socket callback.
it('refuses a malformed resolver result at the Node connection boundary', async () => {
  const fetch: typeof globalThis.fetch = async () => new Response();
  await createNodeReachabilityPorts({}, { fetch }).fetch({ url: 'https://example.test' });
  const callback = vi.fn();
  state.lookups[0]?.('example.test', {}, callback);
  expect(callback).toHaveBeenCalledWith(new Error('DNS lookup returned an invalid address'), '');
});
