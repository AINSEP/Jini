import type { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createNodeReachabilityPorts, type ValidatingLookup } from '../node.js';

const state = vi.hoisted(() => { const lookups: LookupFunction[] = []; return { lookups }; });
vi.mock('undici', () => ({ Agent: class {
  constructor({ connect }: { connect: { lookup: LookupFunction } }) { state.lookups.push(connect.lookup); }
} }));

/** Platform's two functions as recording fakes: what the Node ports are handed is what they call. */
function recordingBindings(refusal?: Error) {
  const urls: string[] = [];
  const resolvers: Array<typeof lookup | undefined> = [];
  const validated: string[] = [];
  const validating: ValidatingLookup = (hostname, _options, callback) => {
    validated.push(hostname);
    if (refusal) callback(refusal); else callback(null, '93.184.216.34', 4);
  };
  return {
    urls, resolvers, validated,
    bindings: {
      assertSafeUrl: (raw: string) => { urls.push(raw); if (refusal) throw refusal; return new URL(raw); },
      createValidatingLookup: (lookupImpl?: typeof lookup) => { resolvers.push(lookupImpl); return validating; },
    },
  };
}

describe('createNodeReachabilityPorts with injected platform functions', () => {
  it('refuses a URL the injected guard refuses, and hands it the raw string', () => {
    const blocked = new Error('private address');
    const { bindings, urls } = recordingBindings(blocked);
    const { guard } = createNodeReachabilityPorts(bindings, {});
    expect(() => guard.assertSafeUrl({ raw: 'https://169.254.169.254/', label: 'deployment' })).toThrow(blocked);
    expect(urls).toEqual(['https://169.254.169.254/']);
  });

  it('returns the URL the injected guard parsed', () => {
    const { bindings } = recordingBindings();
    const url = createNodeReachabilityPorts(bindings, {}).guard.assertSafeUrl({ raw: 'https://example.test/path', label: 'deployment' });
    expect(url.href).toBe('https://example.test/path');
  });

  it('connects through the injected validating lookup, built from the caller\'s resolver', async () => {
    const resolver = (() => undefined) as unknown as typeof lookup;
    const { bindings, resolvers, validated } = recordingBindings();
    await createNodeReachabilityPorts(bindings, { fetch: async () => new Response(), lookupImpl: resolver }).fetch({ url: 'https://example.test/' });
    expect(resolvers).toEqual([resolver]);
    const callback = vi.fn();
    state.lookups.at(-1)?.('example.test', {}, callback);
    expect(validated).toEqual(['example.test']);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('a blocked address from the injected validating lookup is refused at the socket, never connected', async () => {
    const blocked = new Error('private address');
    const { bindings } = recordingBindings(blocked);
    await createNodeReachabilityPorts(bindings, { fetch: async () => new Response() }).fetch({ url: 'https://example.test/' });
    const callback = vi.fn();
    state.lookups.at(-1)?.('example.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(blocked, '');
  });
});
