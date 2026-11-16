/** @file Shared OAuth consumption for a connection whose issuing identity declares none of the optional audience fields and no account. */
import { describe, expect, it } from 'vitest';
import { createSharedOAuthConsumer, type SharedOAuthConnection, type SharedOAuthConsumerDeps, type SharedOAuthConsumerTarget } from '../shared.js';

const minimal = { pluginId: 'calendar', connectionId: 'account', tokenEndpoint: 'https://issuer.test/token', clientId: 'issuing-client' };
const target: SharedOAuthConsumerTarget = { siteId: 'site-a', consumerId: 'local/calendar', identity: minimal, requiredScopes: [] };

function build(connection: SharedOAuthConnection | null) {
  const requests: unknown[] = [];
  const deps: SharedOAuthConsumerDeps = {
    bindings: { read: async () => ({ credentialId: 'saved' }) },
    grants: { isGranted: async () => true },
    connections: { read: async () => connection, getAccessToken: async (input) => { requests.push(input); return 'tok'; } },
  };
  return { consumer: createSharedOAuthConsumer(deps), requests };
}
const connection = (over: Partial<SharedOAuthConnection> = {}): SharedOAuthConnection => ({
  credentialId: 'saved', identity: minimal, generation: 3, status: 'connected', account: null, grantedScopes: [], ...over,
});

describe('shared OAuth consumption with a minimal identity', () => {
  it('projects only the declared identity fields and a null account', async () => {
    const { consumer } = build(connection());
    const status = await consumer.getStatus(target);
    expect(status).toEqual({ credentialId: 'saved', generation: 3, status: 'connected', account: null, grantedScopes: [], identity: minimal });
    expect(Object.keys(status!.identity).sort()).toEqual(['clientId', 'connectionId', 'pluginId', 'tokenEndpoint']);
  });

  it('keeps issuer, authorization endpoint, resource and account details when present, copying scopes', async () => {
    const full = { ...minimal, issuer: 'https://issuer.test', authorizationEndpoint: 'https://issuer.test/authorize', resource: 'https://api.test' };
    const scopes = ['a'];
    const { consumer } = build(connection({ identity: full, account: { accountId: 'u1', displayName: 'User', extra: 'dropped' } as never, grantedScopes: scopes }));
    const status = await consumer.getStatus({ ...target, identity: full });
    expect(status!.identity).toEqual(full);
    expect(status!.account).toEqual({ accountId: 'u1', displayName: 'User' });
    expect(status!.grantedScopes).toEqual(['a']);
    expect(status!.grantedScopes).not.toBe(scopes);
  });

  it('requests a token without an expected account when the connection has none', async () => {
    const { consumer, requests } = build(connection());
    expect(await consumer.getAccessToken(target)).toBe('tok');
    expect(requests).toEqual([{ credentialId: 'saved', expectedGeneration: 3 }]);
  });

  it('refuses a token when the owner record is missing or not connected', async () => {
    await expect(build(null).consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'connection-not-found' });
    await expect(build(connection({ status: 'disconnected' as never })).consumer.getAccessToken(target)).rejects.toBeInstanceOf(Error);
  });

  it('asserts authorization only for a connected, compatible connection', async () => {
    await expect(build(connection()).consumer.assertAuthorized(target)).resolves.toBeUndefined();
    await expect(build(connection({ credentialId: 'other' })).consumer.assertAuthorized(target)).rejects.toMatchObject({ code: 'connection-not-found' });
  });

  it('treats a site with no binding as unauthorized for token use', async () => {
    const consumer = createSharedOAuthConsumer({
      bindings: { read: async () => null }, grants: { isGranted: async () => true },
      connections: { read: async () => connection(), getAccessToken: async () => 'tok' },
    });
    expect(await consumer.getStatus(target)).toBeNull();
    await expect(consumer.assertAuthorized(target)).rejects.toMatchObject({ code: 'access-denied' });
    await expect(consumer.getAccessToken(target)).rejects.toMatchObject({ code: 'access-denied' });
  });
});
