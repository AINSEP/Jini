/** @file Shared OAuth consumption checks live site grants and immutable issuing identity. */
import { describe, expect, it } from 'vitest';
import { createSharedOAuthConsumer, type SharedOAuthConnection, type SharedOAuthConsumerDeps, type SharedOAuthConsumerTarget } from '../shared.js';

const identity = { pluginId: 'calendar', connectionId: 'account', tokenEndpoint: 'https://issuer.test/token',
  authorizationEndpoint: 'https://issuer.test/authorize',
  issuer: 'https://issuer.test', resource: 'https://calendar.test', clientId: 'issuing-client' };
const target: SharedOAuthConsumerTarget = { siteId: 'site-a-uuid', consumerId: 'workspace-local/calendar', identity,
  requiredScopes: ['calendar.read'] };

function fixture() {
  let connection: SharedOAuthConnection | null = { credentialId: 'saved-account', identity, generation: 1,
    status: 'connected', account: { accountId: 'alice', displayName: 'Alice' }, grantedScopes: ['calendar.read'] };
  const bindings = new Map([['site-a-uuid', 'saved-account'], ['site-b-uuid', 'saved-account']]);
  const grants = new Set(['site-a-uuid', 'site-b-uuid']);
  let tokenCalls = 0;
  let onToken: () => void = () => {};
  const tokenRequests: Parameters<SharedOAuthConsumerDeps['connections']['getAccessToken']>[0][] = [];
  const deps: SharedOAuthConsumerDeps = {
    bindings: { read: async ({ siteId }) => {
      const credentialId = bindings.get(siteId);
      return credentialId ? { credentialId } : null;
    } },
    grants: { isGranted: async ({ siteId, credentialId }) => grants.has(siteId) && credentialId === 'saved-account' },
    connections: {
      read: async () => connection,
      getAccessToken: async (input) => { tokenCalls++; tokenRequests.push(input); onToken(); return 'owner-access-token'; },
    },
  };
  return { consumer: createSharedOAuthConsumer(deps), bindings, grants, tokenRequests,
    calls: () => tokenCalls, change: (next: SharedOAuthConnection | null) => { connection = next; },
    current: () => connection!, duringToken: (effect: () => void) => { onToken = effect; } };
}

describe('shared OAuth consumption', () => {
  it('serves two independently granted sites with the same workspace-local consumer', async () => {
    const f = fixture();
    expect(await f.consumer.getAccessToken(target)).toBe('owner-access-token');
    expect(await f.consumer.getAccessToken({ ...target, siteId: 'site-b-uuid' })).toBe('owner-access-token');
    expect(f.tokenRequests).toEqual([
      { credentialId: 'saved-account', expectedGeneration: 1, expectedAccountId: 'alice' },
      { credentialId: 'saved-account', expectedGeneration: 1, expectedAccountId: 'alice' },
    ]);
  });

  it('keeps an absent binding distinct from a denied or stale selection', async () => {
    const f = fixture();
    expect(await f.consumer.getStatus({ ...target, siteId: 'site-c-uuid' })).toBeNull();
    f.bindings.set('site-c-uuid', 'saved-account');
    await expect(f.consumer.getAccessToken({ ...target, siteId: 'site-c-uuid' })).rejects.toMatchObject({ code: 'access-denied' });
    expect(f.calls()).toBe(0);
  });

  it('refuses a guessed owner credential without opening its token', async () => {
    const f = fixture(); f.bindings.set('site-a-uuid', 'guessed-account');
    await expect(f.consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'access-denied' });
    expect(f.calls()).toBe(0);
  });

  it.each(['pluginId', 'connectionId', 'issuer', 'resource', 'tokenEndpoint', 'authorizationEndpoint', 'clientId'] as const)(
    'refuses a different issuing %s', async (field) => {
      const f = fixture();
      await expect(f.consumer.getAccessToken({ ...target, identity: { ...identity, [field]: 'different' } }))
        .rejects.toMatchObject({ code: 'connection-not-found' });
      expect(f.calls()).toBe(0);
    });

  it('allows consumption without replacing the saved client with the consuming site client', async () => {
    const f = fixture();
    const { clientId: _clientId, ...expectedIdentity } = identity;
    expect(await f.consumer.getAccessToken({ ...target, identity: expectedIdentity })).toBe('owner-access-token');
    expect((await f.consumer.getStatus(target))?.identity.clientId).toBe('issuing-client');
  });

  it('refuses missing scopes before token acquisition', async () => {
    const f = fixture();
    await expect(f.consumer.getAccessToken({ ...target, requiredScopes: ['calendar.write'] }))
      .rejects.toMatchObject({ code: 'scope-not-granted' });
    expect(f.calls()).toBe(0);
  });

  it('refuses an explicitly frozen account that changed', async () => {
    const f = fixture();
    await expect(f.consumer.getAccessToken({ ...target, expectedAccountId: 'bob' }))
      .rejects.toMatchObject({ code: 'account-changed' });
    expect(f.calls()).toBe(0);
  });

  it('does not cache a grant between token requests or call gates', async () => {
    const f = fixture();
    expect(await f.consumer.getAccessToken(target)).toBe('owner-access-token');
    f.grants.delete(target.siteId);
    await expect(f.consumer.assertAuthorized(target)).rejects.toMatchObject({ code: 'access-denied' });
    await expect(f.consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'access-denied' });
    expect(f.calls()).toBe(1);
  });

  it('withholds a token when the site grant is removed during refresh', async () => {
    const f = fixture(); f.duringToken(() => f.grants.delete(target.siteId));
    await expect(f.consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'access-denied' });
    expect(f.calls()).toBe(1);
  });

  it('withholds a token when the selected binding changes during acquisition', async () => {
    const f = fixture(); f.duringToken(() => f.bindings.set(target.siteId, 'different-account'));
    await expect(f.consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'access-denied' });
  });

  it.each(['generation', 'client', 'account'] as const)('withholds a token when %s changes during acquisition', async (change) => {
    const f = fixture();
    const { clientId: _clientId, ...expectedIdentity } = identity;
    f.duringToken(() => {
      const current = f.current();
      if (change === 'generation') f.change({ ...current, generation: 2 });
      if (change === 'client') f.change({ ...current, identity: { ...identity, clientId: 'replacement' } });
      if (change === 'account') f.change({ ...current, account: { accountId: 'bob', displayName: 'Bob' } });
    });
    await expect(f.consumer.getAccessToken({ ...target, identity: expectedIdentity })).rejects.toMatchObject({ code: 'storage-conflict' });
  });

  it.each(['reconnect-required', 'revocation-pending', 'disconnected'] as const)('gates a %s connection', async (status) => {
    const f = fixture(); f.change({ ...f.current(), status });
    expect((await f.consumer.getStatus(target))?.status).toBe(status);
    await expect(f.consumer.assertAuthorized(target)).rejects.toMatchObject({ code: status === 'disconnected' ? 'not-connected' : status });
    expect(f.calls()).toBe(0);
  });

  it('withholds a token after global disconnect during acquisition', async () => {
    const f = fixture(); f.duringToken(() => f.change({ ...f.current(), status: 'revocation-pending', generation: 2 }));
    await expect(f.consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'revocation-pending' });
  });

  it('projects only public metadata even when the owner adapter returns extra secret fields', async () => {
    const f = fixture();
    f.change({ ...f.current(), refreshToken: 'owner-refresh-secret', clientSecret: 'owner-client-secret' } as SharedOAuthConnection);
    const status = await f.consumer.getStatus(target);
    expect(status).toEqual(f.current() && { credentialId: 'saved-account', identity, generation: 1,
      status: 'connected', account: { accountId: 'alice', displayName: 'Alice' }, grantedScopes: ['calendar.read'] });
    expect(JSON.stringify(status)).not.toContain('secret');
  });
});
