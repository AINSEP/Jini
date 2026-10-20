/**
 * @file Phase-A security pins for API connections: attempt binding, single use, expiry, PKCE,
 * granted-scope check, callback/start field allowlists, generation fencing, token redaction,
 * account rules and revocation honesty. Each test pins one behaviour against the fake provider.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseApiConnectionDescriptor } from '../index.js';
import { startAcmeProvider, type AcmeProvider } from './fixtures/acme-provider.js';
import { buildHarness, CALLBACK, signIn, type Harness } from './fixtures/harness.js';

let provider: AcmeProvider;
let h: Harness;
beforeEach(async () => { provider = await startAcmeProvider(); h = buildHarness(provider); });
afterEach(async () => { await provider.close(); });

const complete = (callbackParams: Record<string, string>, over: Partial<{ workspaceId: string; actorId: string; redirectUri: string }> = {}) =>
  h.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, ...over });

async function connect(account = 'alice') {
  const { started, callbackParams } = await signIn(h, provider, { account });
  await complete(callbackParams);
  return started.connectionRef;
}

describe('attempt binding and lifetime', () => {
  it('refuses a callback redeemed by a different actor', async () => {
    const { callbackParams } = await signIn(h, provider);
    await expect(complete(callbackParams, { actorId: 'actor-2' })).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('refuses a callback redeemed in a different workspace', async () => {
    const { callbackParams } = await signIn(h, provider);
    await expect(complete(callbackParams, { workspaceId: 'ws-2' })).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('refuses a callback that arrived on a different callback URL', async () => {
    const { callbackParams } = await signIn(h, provider);
    await expect(complete(callbackParams, { redirectUri: 'http://127.0.0.1:47012/callback' })).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('burns the attempt on a mismatched redemption so the right owner cannot reuse it', async () => {
    const { callbackParams } = await signIn(h, provider);
    await complete(callbackParams, { actorId: 'actor-2' }).catch(() => undefined);
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('accepts each attempt once', async () => {
    const { callbackParams } = await signIn(h, provider);
    await complete(callbackParams);
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('refuses an attempt redeemed after its ten-minute lifetime', async () => {
    const { callbackParams } = await signIn(h, provider);
    h.clock.now += 10 * 60_000;
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('refuses an older attempt once a newer one for the same connection completed', async () => {
    const older = await signIn(h, provider);
    const newer = await signIn(h, provider);
    await complete(newer.callbackParams);
    await expect(complete(older.callbackParams)).rejects.toMatchObject({ code: 'attempt-superseded' });
  });
});

describe('PKCE', () => {
  it('sends an S256 challenge and redeems with the matching verifier', async () => {
    const { started, callbackParams } = await signIn(h, provider);
    await complete(callbackParams);
    const challenge = new URL(started.authorizationUrl).searchParams.get('code_challenge');
    const verifier = provider.tokenRequests[0]!.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
  });
});

describe('client kind', () => {
  it('sends the hosted extra parameters, not the installed-app ones, for a hosted client', async () => {
    h = buildHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' } });
    const { started } = await signIn(h, provider);
    const params = new URL(started.authorizationUrl).searchParams;
    expect([params.get('include_granted'), params.get('prompt')]).toEqual(['true', null]);
  });
});

describe('granted scopes', () => {
  it('stores nothing when the account granted fewer scopes than requested', async () => {
    const { started, callbackParams } = await signIn(h, provider, { grantScopes: ['acme.other'] });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'scope-not-granted' });
    expect([h.tokens.entries.size, (await h.service.getStatus({ connectionRef: started.connectionRef })).status]).toEqual([0, 'disconnected']);
  });
});

describe('field allowlists and limits', () => {
  it('refuses a declared callback field over its declared size', async () => {
    const { callbackParams } = await signIn(h, provider);
    await expect(complete({ ...callbackParams, picked: 'x'.repeat(65) })).rejects.toMatchObject({ code: 'request-invalid' });
  });
  it('refuses a callback with more than 64 fields', async () => {
    const { callbackParams } = await signIn(h, provider);
    const flood = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`f${index}`, 'x']));
    await expect(complete({ ...callbackParams, ...flood })).rejects.toMatchObject({ code: 'request-invalid' });
  });
  it('refuses a start parameter the plugin did not declare', async () => {
    await expect(h.service.start({ workspaceId: 'ws-1', actorId: 'actor-1', intent: 'connect', scopeSetIds: ['files'], redirectUri: CALLBACK },
      { startParams: { prompt: 'none' } })).rejects.toMatchObject({ code: 'request-invalid' });
  });
  it('refuses a descriptor that shadows a reserved OAuth parameter', () => {
    expect(() => parseApiConnectionDescriptor({ value: { pluginId: 'p', connectionId: 'c', label: 'L',
      authorizationEndpoint: 'https://a.example/auth', tokenEndpoint: 'https://a.example/token',
      authorizationParams: { public: { redirect_uri: 'https://evil.example' } } } })).toThrow(expect.objectContaining({ code: 'descriptor-invalid' }));
  });
  it('refuses a descriptor that declares a callback field named like an OAuth field', () => {
    expect(() => parseApiConnectionDescriptor({ value: { pluginId: 'p', connectionId: 'c', label: 'L',
      authorizationEndpoint: 'https://a.example/auth', tokenEndpoint: 'https://a.example/token',
      callbackFields: [{ name: 'code', maxLength: 10 }] } })).toThrow(expect.objectContaining({ code: 'descriptor-invalid' }));
  });
});

describe('token redaction', () => {
  it('keeps every token out of the status view', async () => {
    const ref = await connect();
    const status = JSON.stringify(await h.service.getStatus({ connectionRef: ref }));
    expect(status).not.toMatch(/acme-(at|rt)-|acme-code-/);
  });
  it('keeps every token out of a reconnect-required refusal and its causes', async () => {
    const ref = await connect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    h.clock.now += 3600_000;
    const error = await h.service.getAccessToken({ connectionRef: ref }).then((): Error => new Error('expected a refusal'), (caught: unknown) => caught as Error);
    const chain = [error, error.cause, (error.cause as Error | undefined)?.cause].map(item => (item as Error | undefined)?.message ?? '');
    expect([(error as { code?: string }).code, chain.join(' ')]).toEqual(['reconnect-required', expect.not.stringMatching(/acme-(at|rt)-/)]);
  });
});

describe('serving access tokens', () => {
  it('moves to reconnect-required and refuses when the provider rejects the refresh token', async () => {
    const ref = await connect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    h.clock.now += 3600_000;
    await expect(h.service.getAccessToken({ connectionRef: ref })).rejects.toMatchObject({ code: 'reconnect-required' });
    expect((await h.service.getStatus({ connectionRef: ref })).status).toBe('reconnect-required');
  });
  it('refuses a connectionRef that belongs to another plugin', async () => {
    const ref = await connect();
    const foreign = buildHarness(provider, { pluginId: 'other-plugin' });
    // Copy the record so only the plugin-ownership check stands in the way.
    await foreign.records.compareAndSet({ key: ref, expectedRevision: 0, record: (await h.records.read({ key: ref }))! });
    await expect(foreign.service.getAccessToken({ connectionRef: ref })).rejects.toMatchObject({ code: 'connection-not-found' });
  });
});

describe('account rules', () => {
  it('refuses a reconnect that signs in as a different account', async () => {
    await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob' });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'account-mismatch' });
  });
  it('keeps the stored refresh token when a hosted same-account exchange omits one', async () => {
    h = buildHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' } });
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', omitRefreshToken: true });
    await complete(callbackParams);
    expect((await h.tokens.load({ key: ref }))?.refreshToken).toBe('acme-rt-1');
  });
  it('replaces the whole token set when an installed-app same-account exchange omits a refresh token', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', omitRefreshToken: true });
    await complete(callbackParams);
    expect((await h.tokens.load({ key: ref }))?.refreshToken).toBeNull();
  });
  it('stages a switch without changing the live account until confirmed', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob', intent: 'switch-account' });
    expect((await complete(callbackParams)).outcome).toBe('staged');
    expect(await h.service.getAccessToken({ connectionRef: ref }, { expectedAccountId: 'alice' })).toBe('acme-at-1');
  });
  it('refuses a switch confirmation from a different actor', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await expect(h.service.confirmSwitchAccount({ connectionRef: ref, actorId: 'actor-2' })).rejects.toMatchObject({ code: 'switch-not-staged' });
  });
  it('refuses a frozen binding once the confirmed switch changed the account', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await h.service.confirmSwitchAccount({ connectionRef: ref, actorId: 'actor-1' });
    await expect(h.service.getAccessToken({ connectionRef: ref }, { expectedAccountId: 'alice' })).rejects.toMatchObject({ code: 'account-changed' });
  });
});

describe('revocation honesty', () => {
  it('stays revocation-pending, keeps the credential and serves nothing when remote revocation fails', async () => {
    const ref = await connect();
    provider.failRevocation = true;
    const result = await h.service.disconnect({ connectionRef: ref });
    expect([result.status, result.remoteRevocation, h.tokens.entries.has(ref)]).toEqual(['revocation-pending', 'pending', true]);
    await expect(h.service.getAccessToken({ connectionRef: ref })).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('clears the kept credential when a retried disconnect is confirmed', async () => {
    const ref = await connect();
    provider.failRevocation = true;
    await h.service.disconnect({ connectionRef: ref });
    provider.failRevocation = false;
    const retried = await h.service.disconnect({ connectionRef: ref });
    expect([retried.status, retried.remoteRevocation, h.tokens.entries.has(ref)]).toEqual(['disconnected', 'confirmed', false]);
  });
});
