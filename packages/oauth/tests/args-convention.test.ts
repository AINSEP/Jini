import { expect, test } from 'vitest';
import {
  OAuthError, createOAuthUrlGuard, createOAuthProviderRegistry, buildOperatorOAuthProvider,
  createOAuthClientRegistrar, createFileClientRegistrationCache, createTokenRefresher,
  beginAuthorizationCode, completeAuthorizationCode, invalidPendingAuthorizationState,
} from '../src/index.js';
import { createPendingAuthorizationStore, createMemoryClientRegistrationCache, createMemoryTokenStore } from '../src/testing/index.js';
import { createFetchDouble, createTestClock, TEST_PROVIDER, TEST_CLIENT } from './helpers.js';
import type { OAuthTokenSet, TokenRefreshPort, RegistrationCacheFilePort } from '../src/index.js';

const identity = { clientDisplayName: 'Example Client', softwareId: 'example.client', redirectUris: ['https://app.example.com/callback'] };
const entropyCalls: number[] = [];
const entropy = ({ byteLength }: { readonly byteLength: number }) => {
  entropyCalls.push(byteLength);
  return new Uint8Array(byteLength).fill(entropyCalls.length);
};
const guard = createOAuthUrlGuard({ assertAllowed({ url }) { expect(url.protocol).toBe('https:'); } });

test('OAuthError keeps required recovery guidance separate from optional provider metadata and cause', () => {
  const cause = new Error('transport');
  const error = new OAuthError({ code: 'OAUTH_SLOW_DOWN', message: 'slow down', operatorAction: 'wait' }, { providerErrorCode: 'slow_down', retryAfterSeconds: 9, cause });
  expect(error).toMatchObject({ code: 'OAUTH_SLOW_DOWN', operatorAction: 'wait', retryable: true, providerErrorCode: 'slow_down', retryAfterSeconds: 9, cause });
  expect(invalidPendingAuthorizationState({}).code).toBe('OAUTH_INVALID_STATE');
});

test('optional pending limits are argument two and owner-bound state remains single use', async () => {
  const clock = createTestClock();
  const store = createPendingAuthorizationStore({ clock, randomBytesFn: entropy }, { maxEntries: 1, ttlMs: 1000 });
  const input = { ownerKey: 'owner', providerId: 'example', codeVerifier: 'v'.repeat(43), redirectUri: identity.redirectUris[0]!, scopes: ['read'] };
  const first = await store.put(input, { resource: 'https://api.example.com/first' });
  const second = await store.put(input, { resource: ['https://api.example.com/second'] });
  await expect(store.take({ state: first.state, ownerKey: 'owner' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
  expect((await store.take({ state: second.state, ownerKey: 'owner' })).resource).toEqual(['https://api.example.com/second']);
  await expect(store.take({ state: second.state, ownerKey: 'owner' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
  expect(await store.size({})).toBe(0);
});

test('browser options stay separate while the pending record preserves resource binding for exchange', async () => {
  const clock = createTestClock();
  const pending = createPendingAuthorizationStore({ clock, randomBytesFn: entropy });
  const started = await beginAuthorizationCode({ provider: TEST_PROVIDER, pending, randomBytesFn: entropy, guard, options: identity, ownerKey: 'owner', client: TEST_CLIENT, redirectUri: identity.redirectUris[0]! }, { scopes: ['read'], resource: ['https://api.example.com/a', 'https://api.example.com/b'] });
  const http = createFetchDouble([{ json: { access_token: 'issued', refresh_token: 'rotated' } }]);
  const tokens = await completeAuthorizationCode({ provider: TEST_PROVIDER, pending, clock, fetchFn: http.fetchFn, guard, ownerKey: 'owner', client: TEST_CLIENT, params: { state: started.state, code: 'one-time' } }, { timeoutMs: 800 });
  expect(tokens.accessToken).toBe('issued');
  expect(http.requests).toHaveLength(1);
  expect(http.requests[0]!.body.getAll('resource')).toEqual(['https://api.example.com/a', 'https://api.example.com/b']);
  expect(http.requests[0]!.redirect).toBe('error');
});

test('provider registry methods and optional operator endpoints use objects', () => {
  const registry = createOAuthProviderRegistry({ guard });
  const descriptor = buildOperatorOAuthProvider({ providerId: 'example', label: 'Example', tokenEndpoint: 'https://auth.example.com/token', guard }, { authorizationEndpoint: 'https://auth.example.com/authorize', scopes: ['read'] });
  registry.register({ descriptor });
  expect(registry.get({ providerId: 'example' })).toEqual(descriptor);
  expect(registry.list({})).toEqual([descriptor]);
});

test('registrar options participate in cache identity and invalidate the matching registration only', async () => {
  const http = createFetchDouble([{ json: { client_id: 'read' } }, { json: { client_id: 'device' } }, { json: { client_id: 'replacement' } }]);
  const cache = createMemoryClientRegistrationCache({});
  const registrar = createOAuthClientRegistrar({ cache, clock: createTestClock(), fetchFn: http.fetchFn, guard, options: identity });
  const input = { issuer: 'https://auth.example.com', registrationEndpoint: 'https://auth.example.com/register', scopes: ['read'] };
  const deviceOptions = { grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'], responseTypes: [] };
  expect((await registrar.getOrRegister(input)).clientId).toBe('read');
  expect((await registrar.getOrRegister(input, deviceOptions)).clientId).toBe('device');
  await registrar.invalidate(input, deviceOptions);
  expect((await registrar.getOrRegister(input, deviceOptions)).clientId).toBe('replacement');
  expect((await registrar.getOrRegister(input)).clientId).toBe('read');
  expect(http.requests).toHaveLength(3);
});

test('file I/O and cache operations pass paths, keys and secrets by named fields', async () => {
  let content: string | null = null;
  const calls: unknown[] = [];
  const fileIO: RegistrationCacheFilePort = {
    async read(args) { calls.push(args); return content; },
    async writeAtomic(args) { calls.push(args); content = args.content; },
  };
  const cache = createFileClientRegistrationCache({ filePath: '/application/clients.json', fileIO });
  const client = { clientId: 'id', clientSecret: 'secret', tokenEndpointAuthMethod: 'none' as const, registrationClientUri: null, clientIdIssuedAt: null, clientSecretExpiresAt: null };
  await cache.set({ key: 'connection', client });
  expect(await cache.get({ key: 'connection' })).toEqual(client);
  await cache.delete({ key: 'connection' });
  expect(await cache.get({ key: 'connection' })).toBeNull();
  expect(calls).toContainEqual({ filePath: '/application/clients.json', content: JSON.stringify([['connection', client]]) });
});

test('refresh ports receive objects and persistence finishes before a rotated token is exposed', async () => {
  const clock = createTestClock('2030-01-01T00:00:00.000Z');
  const store = createMemoryTokenStore({});
  const old: OAuthTokenSet = { accessToken: 'old', refreshToken: 'old-refresh', scopes: [], tokenType: 'Bearer', expiresAt: '2030-01-01T00:00:01.000Z' };
  const rotated = { ...old, accessToken: 'fresh', refreshToken: 'fresh-refresh', expiresAt: '2030-01-01T01:00:00.000Z' };
  await store.persist({ key: 'connection', tokens: old });
  const refreshCalls: unknown[] = [];
  const port: TokenRefreshPort = { ...store, async refresh(args) { refreshCalls.push(args); return rotated; } };
  const refresher = createTokenRefresher({ clock, port, sleep: async ({ ms }) => { clock.advance(ms); } }, { refreshSkewMs: 2000 });
  expect(await Promise.all([refresher.getAccessToken({ key: 'connection' }), refresher.getAccessToken({ key: 'connection' })])).toEqual(['fresh', 'fresh']);
  expect(refreshCalls).toEqual([{ key: 'connection', refreshToken: 'old-refresh' }]);
  expect(await store.load({ key: 'connection' })).toEqual(rotated);
  expect(refresher.inFlightCount({})).toBe(0);
  expect(await store.tryAcquireRefreshLease!({ key: 'connection' })).toBe(true);
});
