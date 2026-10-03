import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as oauth from '../src/index.js';
import * as policy from '../src/discovery-policy.js';
import * as transport from '../src/dns-pinned-transport.js';
import * as pkce from '../src/pkce.js';
import * as authorization from '../src/authorization-code.js';
import * as pending from '../src/pending-authorizations.js';
import * as redact from '../src/redact.js';
import { createOAuthDispatcherStub } from './dispatcher-stub.js';

const entries = {
  '.': 'index',
  './testing': 'testing/index',
  './discovery-policy': 'discovery-policy',
  './dns-pinned-transport': 'dns-pinned-transport',
} as const;

describe('merged package entries', () => {
  it('publishes each source entry with matching Node runtime metadata', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(entries).sort());
    expect(Object.keys(manifest.jini.entries).sort()).toEqual(Object.keys(entries).sort());
    for (const [name, target] of Object.entries(entries)) {
      expect(manifest.jini.entries[name], name).toBe('node');
      expect(manifest.exports[name], name).toEqual({
        types: `./dist/${target}.d.ts`,
        import: `./dist/${target}.js`,
        default: `./dist/${target}.js`,
      });
    }
    expect(manifest.files).toContain('README.md');
    expect(manifest.files).not.toContain('API.md');
  });

  it('shares implementations between the root barrel and the new direct entries', () => {
    expect(oauth.createIssuerBoundDiscoveryPolicy).toBe(policy.createIssuerBoundDiscoveryPolicy);
    expect(oauth.createDnsPinnedOAuthTransport).toBe(transport.createDnsPinnedOAuthTransport);
    expect(oauth.createPkcePair).toBe(pkce.createPkcePair);
    expect(oauth.generateOAuthState).toBe(pkce.generateOAuthState);
    expect(oauth.buildOAuthAuthorizationUrl).toBe(authorization.buildOAuthAuthorizationUrl);
    expect(oauth.exchangeOAuthAuthorizationCode).toBe(authorization.exchangeOAuthAuthorizationCode);
    expect(oauth.createPendingAuthorizationStore).toBe(pending.createPendingAuthorizationStore);
    expect(oauth.redactOAuthUrls).toBe(redact.redactOAuthUrls);
  });
});

it('terminates discovery on rejected issuer metadata without trying another advertised issuer', async () => {
  const issuer = 'https://auth.example.com/tenant';
  const fetchFn = vi.fn<oauth.OAuthFetch>(async ({ url }) => {
    if (String(url).includes('oauth-protected-resource'))
      return Response.json({ authorization_servers: [issuer, 'https://fallback.example.com'] });
    return Response.json({ issuer: 'https://substitute.example.com', token_endpoint: 'https://auth.example.com/token' });
  });
  const guard = oauth.createOAuthUrlGuard({ assertAllowed: () => {} });
  await expect(oauth.discoverAuthorizationServer({
    resourceUrl: 'https://resource.example.com/api', guard, fetchFn,
  }, { metadataPolicy: policy.createIssuerBoundDiscoveryPolicy({}) }))
    .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
  expect(fetchFn.mock.calls.map(([args]) => String(args.url))).toEqual([
    'https://resource.example.com/.well-known/oauth-protected-resource/api',
    'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
  ]);
});

describe('DNS-pinned fetch retains the HTTP port contract', () => {
  function fixture() {
    const dispatcher = createOAuthDispatcherStub({});
    const fetchFn = vi.fn<oauth.OAuthFetch>(async () => new Response('{}'));
    const guard = oauth.createOAuthUrlGuard({ assertAllowed: () => {} });
    const pinned = oauth.createDnsPinnedOAuthTransport({
      guard, fetchFn,
      dns: { resolve: async () => [{ address: '203.0.113.1', family: 4 }] },
      addressPolicy: { assertAllowed: () => {} },
      dispatcherFactory: { create: () => ({ dispatcher, close: async () => {} }) },
    });
    return { pinned, fetchFn, dispatcher };
  }

  it('preserves a Request method, headers, body and abort signal', async () => {
    const { pinned, fetchFn, dispatcher } = fixture();
    const controller = new AbortController();
    const request = new Request('https://auth.example.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=private', signal: controller.signal,
    });
    await pinned.fetchFn({ url: request });
    const [required, optional] = fetchFn.mock.calls[0]!;
    expect(required.url).toBeInstanceOf(Request);
    const forwarded = required.url as Request;
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(await forwarded.text()).toBe('grant_type=refresh_token&refresh_token=private');
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
    expect(optional).toEqual({ redirect: 'error', dispatcher });
  });

  it('retains explicit init overrides while refusing a caller-supplied redirect or dispatcher', async () => {
    const { pinned, fetchFn, dispatcher } = fixture();
    const init: RequestInit = {
      method: 'PUT', body: 'override', redirect: 'follow', dispatcher: createOAuthDispatcherStub({}),
    };
    await pinned.fetchFn({ url: new Request('https://auth.example.com/token') }, init);
    expect(fetchFn.mock.calls[0]![1]).toEqual({
      method: 'PUT', body: 'override', redirect: 'error', dispatcher,
    });
  });

  it('checks the Request URL before invoking HTTP', async () => {
    const { pinned, fetchFn } = fixture();
    await expect(pinned.fetchFn({ url: new Request('http://auth.example.com/token') }))
      .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
