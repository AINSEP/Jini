/**
 * @file EXTRACT-S4 Main F3: only the credential read is caught as "unreadable". The saved
 * credential's allowed origins are projected after the read resolves, so a malformed saved base URL
 * rejects with the host's raw error (as before S3) instead of becoming an "unreadable" refusal.
 */
import { expect, it } from 'vitest';
import { ApiConnectionError, parseApiConnectionDescriptor, resolveByoClient, type ApiConnectionByoCredentials, type DeclaredApiConnection } from '../index.js';

function declaration(): DeclaredApiConnection {
  return { pluginId: 'relay', descriptor: parseApiConnectionDescriptor({ value: { pluginId: 'relay', connectionId: 'account', label: 'Relay account',
    authorizationEndpoint: 'https://auth.relay.test/authorize', tokenEndpoint: 'https://auth.relay.test/token', authorizationParams: { public: {}, confidential: {} }, forceConsentParams: {}, startParams: [], callbackFields: [] } }),
    clients: {}, budgets: [], scopeSets: [], apiOrigins: ['https://api.relay.test'], byoClient: true,
    module: { createHooks: () => ({ resolveScopes: async () => [], readAccount: async () => ({ accountId: 'a', displayName: 'Account' }), revoke: async () => {} }) } };
}

it('a malformed saved origin escapes raw with its own identity, never as an unreadable refusal', async () => {
  const raw = new TypeError('Invalid URL');
  const refusals: string[] = [];
  const byoCredentials: ApiConnectionByoCredentials = {
    read: async () => ({ connection: { username: 'client', token: 'human-secret' }, allowedOrigins: () => { throw raw; } }),
    refuse: input => { refusals.push(input.problem); return new ApiConnectionError({ code: 'descriptor-invalid', message: 'refused' }); },
  };
  await expect(resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials })).rejects.toBe(raw);
  expect(refusals).toEqual([]);
});

it('a true read failure is the unreadable refusal and projects no origins', async () => {
  const marker = new ApiConnectionError({ code: 'descriptor-invalid', message: 'Studio client unavailable.' });
  const refusals: string[] = [];
  const byoCredentials: ApiConnectionByoCredentials = {
    read: async () => { throw new Error('private read failure'); },
    refuse: input => { refusals.push(input.problem); return marker; },
  };
  expect(await resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials })).toBe(marker);
  expect(refusals).toEqual(['unreadable']);
});

it('origins are projected once, only after the read has resolved', async () => {
  const order: string[] = [];
  const byoCredentials: ApiConnectionByoCredentials = {
    read: async () => { order.push('read'); return { connection: { username: 'client', token: 'human-secret' }, allowedOrigins: () => { order.push('origins'); return ['https://auth.relay.test']; } }; },
    refuse: () => { throw new Error('unexpected refusal'); },
  };
  expect(await resolveByoClient({ connection: declaration(), workspaceId: 'studio', byoCredentials })).toEqual({ clientId: 'client', clientSecret: 'human-secret' });
  expect(order).toEqual(['read', 'origins']);
});
