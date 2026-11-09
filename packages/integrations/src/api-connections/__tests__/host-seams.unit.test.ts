import { expect, it } from 'vitest';
import { ApiConnectionError, byoClientLabel, createConnectionHookHttp, parseApiConnectionDescriptor, resolveByoClient, type ApiConnectionByoCredentials, type DeclaredApiConnection } from '../index.js';

function declaration(): DeclaredApiConnection {
  return { pluginId: 'relay', descriptor: parseApiConnectionDescriptor({ value: { pluginId: 'relay', connectionId: 'account', label: 'Relay account',
    authorizationEndpoint: 'https://auth.relay.test/authorize', tokenEndpoint: 'https://auth.relay.test/token', authorizationParams: { public: {}, confidential: {} }, forceConsentParams: {}, startParams: [], callbackFields: [] } }),
    clients: {}, budgets: [], scopeSets: [], apiOrigins: ['https://api.relay.test'], byoClient: true,
    module: { createHooks: () => ({ resolveScopes: async () => [], readAccount: async () => ({ accountId: 'a', displayName: 'Account' }), revoke: async () => {} }) } };
}

it('A3 public BYO seam reads one projected credential and preserves the stable label', async () => {
  const reads: unknown[] = [];
  const byoCredentials: ApiConnectionByoCredentials = { read: async input => { reads.push(input); return { connection: { username: ' client ', token: 'human-secret' }, allowedOrigins: () => ['https://auth.relay.test'] }; }, refuse: () => { throw new Error('unexpected refusal'); } };
  expect(byoClientLabel({ pluginId: 'relay', connectionId: 'account' })).toBe('relay/account OAuth client');
  expect(await resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials })).toEqual({ clientId: 'client', clientSecret: 'human-secret' });
  expect(reads).toEqual([{ workspaceId: 'studio', label: 'relay/account OAuth client' }]);
});

it('A3 BYO unreadable/wrong-origin/missing-id refusals are the injected host error identity', async () => {
  const marker = new ApiConnectionError({ code: 'descriptor-invalid', message: 'Studio client unavailable; use studio settings.' });
  const problems: string[] = [];
  for (const read of [async () => { throw new Error('private read failure'); },
    async () => ({ connection: { token: 'secret', username: 'client' }, allowedOrigins: () => ['https://wrong.test'] }),
    async () => ({ connection: { token: 'secret' }, allowedOrigins: () => ['https://auth.relay.test'] })]) {
    expect(await resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials: { read, refuse: input => { problems.push(input.problem); return marker; } } })).toBe(marker);
  }
  expect(problems).toEqual(['unreadable', 'wrong-origin', 'missing-client-id']);
});

it('A3 BYO absent/disabled paths do not manufacture a credential or read a disabled declaration', async () => {
  let reads = 0;
  const byoCredentials: ApiConnectionByoCredentials = { read: async () => { reads++; return null; }, refuse: () => { throw new Error('unexpected refusal'); } };
  expect(await resolveByoClient({ connection: { ...declaration(), byoClient: false }, workspaceId: 'studio', byoCredentials })).toBeUndefined();
  expect(reads).toBe(0);
  expect(await resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials })).toBeUndefined();
  expect(reads).toBe(1);
});

it('A3 public hook seam forwards exact request options only to declared/token origins', async () => {
  const calls: unknown[] = [], response = new Response('ok');
  const http = createConnectionHookHttp({ connection: declaration(), http: { fetch: async (target, options) => { calls.push([target, options]); return response; } } });
  const options = { method: 'POST' as const, body: 'token', headers: { authorization: 'Bearer human-secret' } };
  expect(await http.fetch({ url: 'https://api.relay.test/items' }, options)).toBe(response);
  expect(await http.fetch({ url: 'https://auth.relay.test/revoke' }, options)).toBe(response);
  for (const url of ['https://api.relay.test.evil.test/items', 'http://api.relay.test/items', 'https://api.relay.test:8443/items', 'not-a-url']) await expect(http.fetch({ url }, options)).rejects.toThrow("A plugin's sign-in code may only call its connection's declared API addresses and its token endpoint.");
  expect(calls).toEqual([[{ url: 'https://api.relay.test/items' }, options], [{ url: 'https://auth.relay.test/revoke' }, options]]);
});
