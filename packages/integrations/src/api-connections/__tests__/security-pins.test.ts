/**
 * @file Phase-A security pins for API connections: attempt binding, single use, expiry, PKCE,
 * granted-scope check, callback/start field allowlists, generation fencing, token redaction,
 * account rules and revocation honesty. Each test pins one behaviour against the fake provider.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { OAuthClient } from '@jini-ai/oauth';
import { createApiConnectionService, parseApiConnectionDescriptor, type ApiConnectionServiceDeps, type VaultOAuthTokenStore } from '../index.js';
import { startAcmeProvider, type AcmeProvider } from './fixtures/acme-provider.js';
import { buildRecordMeta } from '../token-store/record.js';
import { buildHarness, buildVaultHarness, CALLBACK, signIn, VAULT_SCOPE, type Harness } from './fixtures/harness.js';

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

describe('attempt ids (host-only state vs the id plugin code may hold)', () => {
  it('returns the authorization URL\'s state to the host and a separate random attempt id', async () => {
    const { started } = await signIn(h, provider);
    const urlState = new URL(started.authorizationUrl).searchParams.get('state');
    expect([started.state === urlState, started.attemptId === urlState, /^[A-Za-z0-9_-]{22}$/.test(started.attemptId)]).toEqual([true, false, true]);
  });
  it('completes with the attempt id start returned', async () => {
    const { started, callbackParams } = await signIn(h, provider);
    expect((await complete(callbackParams)).attemptId).toBe(started.attemptId);
  });
  it('gives every attempt its own id', async () => {
    const [first, second] = [await signIn(h, provider), await signIn(h, provider)];
    expect(first.started.attemptId).not.toBe(second.started.attemptId);
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
    h = buildHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' }, clientKind: 'confidential' });
    const { started } = await signIn(h, provider);
    const params = new URL(started.authorizationUrl).searchParams;
    expect([params.get('include_granted'), params.get('prompt')]).toEqual(['true', null]);
  });
});

describe('installed-app client that sends a client secret', () => {
  // Built at runtime: some providers issue such non-confidential secrets to installed apps.
  const installedSecret = ['installed', 'app', 'secret', 'x'.repeat(24)].join('-');
  const installedClient: OAuthClient = { clientId: 'acme-desktop', clientSecret: installedSecret, authMethod: 'client_secret_post' };
  beforeEach(() => { h = buildHarness(provider, { client: installedClient, clientKind: 'public' }); });

  it('uses the installed-app parameters and PKCE while sending the secret the way its auth method says', async () => {
    const { started, callbackParams } = await signIn(h, provider);
    await complete(callbackParams);
    const params = new URL(started.authorizationUrl).searchParams;
    const exchange = provider.tokenRequests[0]!;
    expect([params.get('prompt'), params.get('include_granted'), exchange.get('client_secret'), exchange.has('code_verifier')])
      .toEqual(['consent', null, installedSecret, true]);
  });
  it('replaces the whole token set when a same-account exchange omits a refresh token', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', omitRefreshToken: true });
    await complete(callbackParams);
    expect((await h.tokens.load({ key: ref }))?.refreshToken).toBeNull();
  });
  it('keeps the secret out of the authorization URL, attempt, record, stored tokens, status and result', async () => {
    const { started, callbackParams } = await signIn(h, provider);
    const attempts = JSON.stringify([...h.records.attempts.values()]);
    const result = await complete(callbackParams);
    const stored = JSON.stringify([await h.records.read({ key: started.connectionRef }), [...h.tokens.entries.values()],
      await h.service.getStatus({ connectionRef: started.connectionRef }), result, started]);
    expect([attempts, stored].filter(text => text.includes(installedSecret))).toEqual([]);
  });
  it('keeps the secret out of a refused exchange and its causes', async () => {
    provider.expectedClientSecret = 'a-different-value';
    const { callbackParams } = await signIn(h, provider);
    const error = await complete(callbackParams).then((): Error => new Error('expected a refusal'), (caught: unknown) => caught as Error);
    const chain = [error, error.cause].map(item => `${(item as Error | undefined)?.message ?? ''} ${JSON.stringify(item ?? null)}`);
    expect([(error as { code?: string }).code, chain.join(' ').includes(installedSecret)]).toEqual(['authorization-failed', false]);
  });
  it('refuses a confidential client kind that does not authenticate at the token endpoint', () => {
    const deps = { clientKind: 'confidential', client: { clientId: 'acme-web', authMethod: 'none' } } as unknown as ApiConnectionServiceDeps; // malformed wiring on purpose
    expect(() => createApiConnectionService({ ...deps, descriptor: parseApiConnectionDescriptor({ value: { pluginId: 'p', connectionId: 'c',
      label: 'L', authorizationEndpoint: 'https://a.example/auth', tokenEndpoint: 'https://a.example/token' } }) }))
      .toThrow(expect.objectContaining({ code: 'configuration-invalid' }));
  });
});

describe('credential install into the vault token store (no host-held lease)', () => {
  it('connects and serves the new token', async () => {
    const v = buildVaultHarness(provider);
    const { started, callbackParams } = await signIn(v, provider);
    await v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams });
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef })).toBe('acme-at-1');
  });
  it('stages and confirms an account switch', async () => {
    const v = buildVaultHarness(provider);
    const finish = (callbackParams: Record<string, string>) =>
      v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams });
    const { started, callbackParams } = await signIn(v, provider, { account: 'alice' });
    await finish(callbackParams);
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await v.service.confirmSwitchAccount({ connectionRef: started.connectionRef, actorId: 'actor-1' });
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef }, { expectedAccountId: 'bob' })).toBe('acme-at-2');
  });
  it('keeps the stored refresh token on a hosted same-account reconnect right after a token was served', async () => {
    const v = buildVaultHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' },
      clientKind: 'confidential' });
    const finish = (callbackParams: Record<string, string>) =>
      v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams });
    const { started, callbackParams } = await signIn(v, provider, { account: 'alice' });
    await finish(callbackParams);
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef })).toBe('acme-at-1');
    await finish((await signIn(v, provider, { account: 'alice', omitRefreshToken: true })).callbackParams);
    expect((await v.tokens.load({ key: started.connectionRef }))?.refreshToken).toBe('acme-rt-1');
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
  it.each([
    ['a name the loopback receiver refuses', { name: '_picked', maxLength: 64 }],
    ['a size over the loopback receiver\'s field limit', { name: 'picked', maxLength: 4097 }],
  ])('refuses a descriptor whose callback field has %s', (_label, field) => {
    expect(() => parseApiConnectionDescriptor({ value: { pluginId: 'p', connectionId: 'c', label: 'L',
      authorizationEndpoint: 'https://a.example/auth', tokenEndpoint: 'https://a.example/token',
      callbackFields: [field] } })).toThrow(expect.objectContaining({ code: 'descriptor-invalid' }));
  });
  it('still accepts a start parameter up to 8192 characters', () => {
    expect(parseApiConnectionDescriptor({ value: { pluginId: 'p', connectionId: 'c', label: 'L',
      authorizationEndpoint: 'https://a.example/auth', tokenEndpoint: 'https://a.example/token',
      startParams: [{ name: '_mode', maxLength: 8192 }] } }).startParams).toEqual([{ name: '_mode', maxLength: 8192 }]);
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
    h = buildHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' }, clientKind: 'confidential' });
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
  it('refuses a switch to the account already connected, staging nothing and revoking nothing', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', intent: 'switch-account' });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'account-unchanged' });
    expect([(await h.service.getStatus({ connectionRef: ref })).pendingSwitch, h.tokens.entries.has(`${ref}#staged`), provider.revoked])
      .toEqual([null, false, []]);
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

describe('characterization: account actions that must keep their behaviour (pinned before G1c)', () => {
  it('cancelling a staged switch revokes the staged grant and keeps the live account serving', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const cancelled = await h.service.cancelSwitchAccount({ connectionRef: ref });
    expect([cancelled.remoteRevocation, cancelled.pendingSwitch, provider.revoked]).toEqual(['confirmed', null, ['acme-rt-2']]);
    expect(await h.service.getAccessToken({ connectionRef: ref }, { expectedAccountId: 'alice' })).toBe('acme-at-1');
  });
  it('a same-account reconnect never calls the revoke hook (the new tokens share the grant)', async () => {
    await connect('alice');
    await complete((await signIn(h, provider, { account: 'alice' })).callbackParams);
    expect(provider.revoked).toEqual([]);
  });
  it('a confirmed switch never calls the revoke hook for the previous account', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await h.service.confirmSwitchAccount({ connectionRef: ref, actorId: 'actor-1' });
    expect(provider.revoked).toEqual([]);
  });
});

describe('revocation honesty against the real vault token store', () => {
  let v: ReturnType<typeof buildVaultHarness>;
  const finish = (callbackParams: Record<string, string>) =>
    v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams });
  async function vaultConnect(account = 'alice') {
    const { started, callbackParams } = await signIn(v, provider, { account });
    await finish(callbackParams);
    return started.connectionRef;
  }
  beforeEach(() => { v = buildVaultHarness(provider); });

  it('disconnect calls the revoke hook once with the stored grant and reports confirmed', async () => {
    const ref = await vaultConnect();
    const result = await v.service.disconnect({ connectionRef: ref });
    expect([result.status, result.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'confirmed', ['acme-rt-1']]);
  });
  it('clears the local credential after a confirmed revocation', async () => {
    const ref = await vaultConnect();
    await v.service.disconnect({ connectionRef: ref });
    const again = await v.service.disconnect({ connectionRef: ref });
    expect([again.remoteRevocation, provider.revoked]).toEqual(['not-needed', ['acme-rt-1']]);
  });
  it('stays revocation-pending and serves no token when the revoke hook fails', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    const result = await v.service.disconnect({ connectionRef: ref });
    expect([result.status, result.remoteRevocation, await v.tokens.load({ key: ref })]).toEqual(['revocation-pending', 'pending', null]);
    await expect(v.service.getAccessToken({ connectionRef: ref })).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('retries a pending revocation with the kept credential, then clears it', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    await v.service.disconnect({ connectionRef: ref });
    provider.failRevocation = false;
    const retried = await v.service.disconnect({ connectionRef: ref });
    expect([retried.status, retried.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'confirmed', ['acme-rt-1']]);
  });
  it('reports not-needed only when no credential is stored (the provider already rejected the grant)', async () => {
    const ref = await vaultConnect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    v.clock.now += 3600_000;
    await expect(v.service.getAccessToken({ connectionRef: ref })).rejects.toMatchObject({ code: 'reconnect-required' });
    const result = await v.service.disconnect({ connectionRef: ref });
    expect([result.status, result.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'not-needed', ['acme-rt-1']]);
  });
  it('disconnect also revokes a staged switch credential', async () => {
    const ref = await vaultConnect('alice');
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const result = await v.service.disconnect({ connectionRef: ref });
    expect([result.remoteRevocation, [...provider.revoked].sort()]).toEqual(['confirmed', ['acme-rt-1', 'acme-rt-2']]);
  });
  it('revokes with the access token when the stored credential has no refresh token', async () => {
    const { started, callbackParams } = await signIn(v, provider, { omitRefreshToken: true });
    await finish(callbackParams);
    const result = await v.service.disconnect({ connectionRef: started.connectionRef });
    expect([result.remoteRevocation, provider.revoked]).toEqual(['confirmed', ['acme-at-1']]);
  });
  it('refuses a new sign-in while a revocation is pending, so the kept credential is not orphaned', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    await v.service.disconnect({ connectionRef: ref });
    await expect(signIn(v, provider)).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('cancelling with no staged switch never calls the revoke hook and keeps the live account', async () => {
    const ref = await vaultConnect();
    const result = await v.service.cancelSwitchAccount({ connectionRef: ref });
    expect([result.remoteRevocation, result.status, provider.revoked]).toEqual(['not-needed', 'connected', []]);
    expect(await v.service.getAccessToken({ connectionRef: ref })).toBe('acme-at-1');
  });
  it('keeps a staged switch for a retry when cancelling cannot revoke it', async () => {
    const ref = await vaultConnect('alice');
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    provider.failRevocation = true;
    const failed = await v.service.cancelSwitchAccount({ connectionRef: ref });
    provider.failRevocation = false;
    const retried = await v.service.cancelSwitchAccount({ connectionRef: ref });
    expect([failed.remoteRevocation, failed.pendingSwitch?.accountId, retried.remoteRevocation, retried.pendingSwitch, provider.revoked])
      .toEqual(['pending', 'bob', 'confirmed', null, ['acme-rt-2']]);
  });
});

describe('paths that would discard a consented credential', () => {
  it('refuses a new sign-in while an account switch waits, so the staged grant is never overwritten', async () => {
    await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await expect(signIn(h, provider, { account: 'carol', intent: 'switch-account' })).rejects.toMatchObject({ code: 'switch-in-progress' });
  });
  it('refuses to stage a switch started before another one was staged, keeping the first staged', async () => {
    const ref = await connect('alice');
    const bob = await signIn(h, provider, { account: 'bob', intent: 'switch-account' });
    const carol = await signIn(h, provider, { account: 'carol', intent: 'switch-account' });
    await complete(bob.callbackParams);
    await expect(complete(carol.callbackParams)).rejects.toMatchObject({ code: 'switch-in-progress' });
    expect([(await h.service.getStatus({ connectionRef: ref })).pendingSwitch?.accountId, h.tokens.entries.get(`${ref}#staged`)?.accessToken])
      .toEqual(['bob', 'acme-at-2']);
  });
  it('writes no staged tokens when another writer wins the record update', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob', intent: 'switch-account' });
    h.records.compareAndSet = async () => false;
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'storage-conflict' });
    expect(h.tokens.entries.has(`${ref}#staged`)).toBe(false);
  });
  it('cancelling never revokes a staged copy a confirmed switch left behind (it is the live grant)', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const realDelete = h.tokens.delete;
    h.tokens.delete = async () => { throw new Error('simulated crash before the staged copy was removed'); };
    await expect(h.service.confirmSwitchAccount({ connectionRef: ref, actorId: 'actor-1' })).rejects.toThrow('simulated crash');
    h.tokens.delete = realDelete;
    const result = await h.service.cancelSwitchAccount({ connectionRef: ref });
    expect([result.remoteRevocation, provider.revoked]).toEqual(['not-needed', []]);
    expect(await h.service.getAccessToken({ connectionRef: ref }, { expectedAccountId: 'bob' })).toBe('acme-at-2');
  });
  it('says the previous account was not revoked at the provider when a switch is confirmed', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const confirmed = await h.service.confirmSwitchAccount({ connectionRef: ref, actorId: 'actor-1' });
    expect(confirmed.previousAccountRevocation).toBe('not-attempted');
  });
});

describe('a changed OAuth client or an unreadable stored credential never locks the connection out', () => {
  let before: ReturnType<typeof buildVaultHarness>;
  let after: ReturnType<typeof buildVaultHarness>;
  let ref: string;
  const finishOn = (x: Harness<VaultOAuthTokenStore>, callbackParams: Record<string, string>) =>
    x.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams });
  const storedRow = () => before.vault.get({ ...VAULT_SCOPE, id: ref });
  beforeEach(async () => {
    before = buildVaultHarness(provider);
    const { started, callbackParams } = await signIn(before, provider);
    await finishOn(before, callbackParams);
    ref = started.connectionRef;
    // The same host restarted with another OAuth client id: same vault rows, same records.
    after = buildVaultHarness(provider, { client: { clientId: 'acme-desktop-2', authMethod: 'none' }, records: before.records }, before.vault);
  });

  it('reconnects under the new client and serves the newly issued token', async () => {
    await finishOn(after, (await signIn(after, provider)).callbackParams);
    expect(await after.service.getAccessToken({ connectionRef: ref })).toBe('acme-at-2');
  });
  it('a hosted same-account reconnect under the new client installs instead of failing on the old row', async () => {
    const hosted = buildVaultHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' },
      clientKind: 'confidential', records: before.records }, before.vault);
    await finishOn(hosted, (await signIn(hosted, provider, { account: 'alice', omitRefreshToken: true })).callbackParams);
    expect((await hosted.service.getStatus({ connectionRef: ref })).status).toBe('connected');
  });
  it('disconnect removes the unreadable credential locally and reports pending, never confirmed', async () => {
    const result = await after.service.disconnect({ connectionRef: ref });
    expect([result.status, result.remoteRevocation, provider.revoked, await storedRow()]).toEqual(['disconnected', 'pending', [], null]);
  });
  it('allows a new sign-in after such a disconnect', async () => {
    await after.service.disconnect({ connectionRef: ref });
    await finishOn(after, (await signIn(after, provider)).callbackParams);
    expect((await after.service.getStatus({ connectionRef: ref })).status).toBe('connected');
  });
  it('treats a malformed stored credential the same way: removed locally, pending, then reconnectable', async () => {
    const row = (await storedRow())!;
    await before.vault.put({ ...VAULT_SCOPE, id: ref, expectedRevision: row.summary.revision, provider: null, label: ref,
      meta: buildRecordMeta({ meta: { status: 'active', leaseHolder: null, leaseExpiresAtMs: null } }),
      payload: { format: 'oauth-token-set', version: 99 } }); // malformed on purpose
    const result = await before.service.disconnect({ connectionRef: ref });
    await finishOn(before, (await signIn(before, provider)).callbackParams);
    expect([result.status, result.remoteRevocation, (await before.service.getStatus({ connectionRef: ref })).status])
      .toEqual(['disconnected', 'pending', 'connected']);
  });
  it('surfaces any other token-store failure during revocation and keeps the credential', async () => {
    before.tokens.loadForRevocation = async () => { throw new Error('vault unavailable'); };
    await expect(before.service.disconnect({ connectionRef: ref })).rejects.toThrow('vault unavailable');
    expect([(await before.service.getStatus({ connectionRef: ref })).status, await storedRow()])
      .toEqual(['revocation-pending', expect.objectContaining({ payload: expect.anything() })]);
  });
});
