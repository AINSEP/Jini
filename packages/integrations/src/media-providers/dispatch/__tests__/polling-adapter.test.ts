import { describe, expect, it } from 'vitest';
import { createBearerSigner, withUnsignedRequestInit } from '../polling-adapter.js';
import type { ProviderCredentials } from '../types.js';

const unsigned = { url: 'https://vendor.test/jobs', init: { method: 'POST', headers: { 'content-type': 'application/json' } }, meta: undefined };

describe('createBearerSigner', () => {
  it('re-resolves the key per call and adds it as a bearer header without dropping existing headers', async () => {
    const keys = ['first-key', 'rotated-key'];
    let i = 0;
    const signer = createBearerSigner({ resolve: () => ({ apiKey: keys[i++] ?? 'exhausted' }), missingCredentialMessage: 'no key' });
    expect(await signer({ request: unsigned })).toEqual({
      url: 'https://vendor.test/jobs',
      init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer first-key' } },
    });
    expect((await signer({ request: unsigned })).init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer rotated-key' });
  });

  it('fails at signing time with the caller message when the resolver yields no key', async () => {
    for (const credentials of [{}, { apiKey: '' }] satisfies ProviderCredentials[]) {
      const signer = createBearerSigner({ resolve: async () => credentials, missingCredentialMessage: 'video vendor key is not configured' });
      await expect(signer({ request: unsigned })).rejects.toThrow('video vendor key is not configured');
    }
  });
});

describe('withUnsignedRequestInit', () => {
  it('carries a caller dispatcher onto the request init', () => {
    // Opaque marker: only identity matters here, no real undici Dispatcher is needed.
    const dispatcher = {} as NonNullable<RequestInit['dispatcher']>;
    expect(withUnsignedRequestInit({ ctx: { requestInit: { dispatcher } }, init: { method: 'GET' } })).toEqual({ method: 'GET', dispatcher });
  });

  it('adds nothing when the caller supplied no dispatcher', () => {
    expect(withUnsignedRequestInit({ ctx: { requestInit: {} }, init: { method: 'GET' } })).toEqual({ method: 'GET' });
  });
});
