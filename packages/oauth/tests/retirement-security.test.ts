import { describe, expect, it, vi } from 'vitest';
import type { LookupFunction } from 'node:net';
import type { OAuthFetch } from '../src/index.js';
import { createOAuthDispatcherStub } from './dispatcher-stub.js';
import {
  createDnsPinnedOAuthTransport, createIssuerBoundDiscoveryPolicy,
  createOAuthUrlGuard, fetchAuthorizationServerMetadata,
} from '../src/index.js';

const issuer = 'https://auth.example.com/tenant';
const metadata = {
  issuer, authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: 'https://auth.example.com/register',
};
const guard = createOAuthUrlGuard({ assertAllowed: () => {} });
const policy = createIssuerBoundDiscoveryPolicy({});

describe('issuer and endpoint policy retained from retired discovery', () => {
  it('accepts exact issuer and same-origin HTTPS endpoints', () => {
    expect(() => policy.assertMetadata({ issuer, document: metadata })).not.toThrow();
  });
  it.each([
    { issuer: `${issuer}/` },
    { issuer: 'https://other.example.com' },
    { authorization_endpoint: 'https://other.example.com/authorize' },
    { token_endpoint: 'http://auth.example.com/token' },
    { registration_endpoint: '/register' },
    { device_authorization_endpoint: 'https://other.example.com/device' },
  ])('rejects metadata %j', override => {
    expect(() => policy.assertMetadata({ issuer, document: { ...metadata, ...override } })).toThrow();
  });
  it('applies the injected policy during discovery before returning metadata', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ...metadata, issuer: 'https://other.example.com' }));
    await expect(fetchAuthorizationServerMetadata({ issuer, fetchFn, guard }, { metadataPolicy: policy }))
      .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('requires an explicit none policy to retain unbound discovery', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ...metadata, issuer: 'https://other.example.com' }));
    expect((await fetchAuthorizationServerMetadata({ issuer, fetchFn, guard }, { metadataPolicy: 'none' })).issuer).toBe('https://other.example.com');
  });
  it.each([
    { issuer: 'https://other.example.com' },
    { token_endpoint: 'https://other.example.com/token' },
  ])('binds issuer metadata by default and stops after the first hostile document: %j', async override => {
    const fetchFn = vi.fn(async () => Response.json({ ...metadata, ...override }));
    await expect(fetchAuthorizationServerMetadata({ issuer, fetchFn, guard }))
      .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('accepts bound metadata without an explicit policy', async () => {
    const fetchFn = vi.fn(async () => Response.json(metadata));
    expect(await fetchAuthorizationServerMetadata({ issuer, fetchFn, guard })).toMatchObject({ issuer, tokenEndpoint: metadata.token_endpoint });
  });
  it.each([undefined, 'none'] as const)('propagates default binding and explicit opt-out through the resource flow: %s', async metadataPolicy => {
    const { discoverAuthorizationServer } = await import('../src/index.js');
    const fetchFn = vi.fn(async ({ url }: { url: string | URL | Request }) =>
      String(url).includes('oauth-protected-resource')
        ? Response.json({ authorization_servers: [issuer, 'https://fallback.example.com'] })
        : Response.json({ ...metadata, issuer: 'https://other.example.com' }));
    const result = discoverAuthorizationServer({ resourceUrl: 'https://resource.example.com/api', fetchFn, guard },
      metadataPolicy === undefined ? {} : { metadataPolicy });
    if (metadataPolicy === 'none') expect((await result).server.issuer).toBe('https://other.example.com');
    else await expect(result).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('threads the policy through protected-resource discovery', async () => {
    const { discoverAuthorizationServer } = await import('../src/index.js');
    const fetchFn = vi.fn(async ({ url }: { url: string | URL | Request }) =>
      String(url).includes('oauth-protected-resource')
        ? Response.json({ authorization_servers: [issuer] })
        : Response.json({ ...metadata, registration_endpoint: 'https://other.example.com/register' }));
    await expect(discoverAuthorizationServer({ resourceUrl: 'https://resource.example.com/api', fetchFn, guard }, { metadataPolicy: policy }))
      .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
  });
});

describe('connection-time DNS validation through a dispatcher port', () => {
  function fixture(addresses = [{ address: '203.0.113.1', family: 4 }]) {
    let lookup!: LookupFunction;
    const dispatcher = createOAuthDispatcherStub({});
    const close = vi.fn(async () => {});
    const resolve = vi.fn(async () => addresses);
    const fetchFn = vi.fn<OAuthFetch>(async () => new Response('{}'));
    const assertAllowed = vi.fn(({ address }: { hostname: string; address: string; family: number }) => {
      if (address === '127.0.0.1' || address === '::1' || address === '169.254.169.254' || address === 'fe80::1') throw new Error('private address');
    });
    const transport = createDnsPinnedOAuthTransport({
      guard, fetchFn, dns: { resolve },
      addressPolicy: { assertAllowed },
      dispatcherFactory: { create: args => { lookup = args.lookup; return { dispatcher, close }; } },
    });
    const connect = (all = false) => new Promise<unknown>((resolve, reject) => {
      // Node/Undici owns this positional callback ABI.
      (lookup as unknown as Function)('auth.example.com', { all }, (error: Error | null, address: unknown, family: number) =>
        error ? reject(error) : resolve(all ? address : { address, family }));
    });
    return { transport, connect, fetchFn, resolve, dispatcher, close, assertAllowed };
  }
  it.each(['https://169.254.169.254/token', 'https://127.0.0.1/token', 'https://[::1]/token', 'https://[fe80::1]/token'])
    ('rejects a denied IP literal before dispatch, without relying on DNS: %s', async url => {
      const f = fixture();
      await expect(f.transport.fetchFn({ url })).rejects.toThrow('private address');
      expect(f.fetchFn).not.toHaveBeenCalled();
      expect(f.resolve).not.toHaveBeenCalled();
      const address = new URL(url).hostname.replace(/^\[|\]$/g, '');
      expect(f.assertAllowed).toHaveBeenCalledWith({ hostname: address, address, family: address.includes(':') ? 6 : 4 });
    });
  it.each(['https://203.0.113.1/token', 'https://[2001:db8::1]/token'])
    ('allows a permitted IP literal after policy validation: %s', async url => {
      const f = fixture();
      await expect(f.transport.fetchFn({ url })).resolves.toBeInstanceOf(Response);
      expect(f.fetchFn).toHaveBeenCalledTimes(1);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.assertAllowed).toHaveBeenCalledTimes(1);
    });
  it('checks IP-literal Request objects before forwarding their body or credentials', async () => {
    const f = fixture();
    const request = new Request('https://[::1]/token', { method: 'POST', body: 'secret', headers: { authorization: 'Bearer secret' } });
    await expect(f.transport.fetchFn({ url: request })).rejects.toThrow('private address');
    expect(f.fetchFn).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });
  it('returns only the address just validated at connection time and revalidates subsequent resolutions', async () => {
    const f = fixture();
    expect(await f.connect()).toEqual({ address: '203.0.113.1', family: 4 });
    f.resolve.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(f.connect()).rejects.toThrow('private address');
    expect(f.resolve).toHaveBeenCalledTimes(2);
  });
  it('rejects a mixed public/private all-address response without returning any addresses', async () => {
    const f = fixture([{ address: '203.0.113.1', family: 4 }, { address: '::1', family: 6 }]);
    await expect(f.connect(true)).rejects.toThrow('private address');
  });
  it('supports all-address lookups without discarding a validated IPv6 address', async () => {
    const addresses = [{ address: '203.0.113.1', family: 4 }, { address: '2001:db8::1', family: 6 }];
    expect(await fixture(addresses).connect(true)).toEqual(addresses);
  });
  it('rejects an empty DNS answer', async () => {
    await expect(fixture([]).connect()).rejects.toThrow('OAuth DNS lookup returned no addresses');
  });
  it('attaches the same dispatcher, refuses redirects and closes through its lifecycle port', async () => {
    const f = fixture();
    await f.transport.fetchFn({ url: 'https://auth.example.com/token' }, { method: 'POST', body: 'secret' });
    expect(f.fetchFn.mock.calls[0]).toEqual([
      { url: 'https://auth.example.com/token' },
      expect.objectContaining({ dispatcher: f.dispatcher, redirect: 'error', method: 'POST', body: 'secret' }),
    ]);
    await f.transport.close({});
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('also rejects redirect responses from a nonconforming fetch port', async () => {
    const f = fixture();
    f.fetchFn.mockResolvedValueOnce(new Response('', { status: 302 }));
    await expect(f.transport.fetchFn({ url: 'https://auth.example.com/token' })).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
  });
});
