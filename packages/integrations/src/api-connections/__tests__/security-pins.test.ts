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
import { browserBindingOf, buildHarness, buildVaultHarness, CALLBACK, signIn, VAULT_SCOPE, type Harness } from './fixtures/harness.js';

let provider: AcmeProvider;
let h: Harness;
beforeEach(async () => { provider = await startAcmeProvider(); h = buildHarness(provider); });
afterEach(async () => { await provider.close(); });

const complete = (callbackParams: Record<string, string>,
  over: Partial<{ workspaceId: string; actorId: string; redirectUri: string; browserBinding: string }> = {}) =>
  h.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams,
    browserBinding: browserBindingOf(h, callbackParams), ...over });

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

describe('browser binding (a hosted callback carries no session, so the starting browser must prove itself)', () => {
  it('refuses a callback from a browser that carries no binding, burns the attempt and installs nothing', async () => {
    const { callbackParams } = await signIn(h, provider);
    await expect(complete(callbackParams, { browserBinding: '' })).rejects.toMatchObject({ code: 'invalid-attempt' });
    expect([h.records.attempts.size, h.tokens.entries.size, provider.tokenRequests.length]).toEqual([0, 0, 0]);
  });
  it("refuses a callback from a browser that carries another sign-in's binding", async () => {
    const victim = await signIn(h, provider);
    const own = await signIn(h, provider);
    await expect(complete(victim.callbackParams, { browserBinding: own.started.browserBinding }))
      .rejects.toMatchObject({ code: 'invalid-attempt' });
  });
  it('returns a 32-byte random binding separate from state and attempt id', async () => {
    const { started } = await signIn(h, provider);
    const { browserBinding, state, attemptId } = started;
    expect([/^[A-Za-z0-9_-]{43}$/.test(browserBinding), browserBinding !== state, browserBinding !== attemptId]).toEqual([true, true, true]);
  });
  it('stores only a hash of the binding in the attempt', async () => {
    const { started } = await signIn(h, provider);
    const stored = h.records.attempts.get(started.state);
    expect([JSON.stringify(stored).includes(started.browserBinding),
      stored?.browserBindingHash === createHash('sha256').update(started.browserBinding).digest('base64url')]).toEqual([false, true]);
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

const HOSTED_CLIENT: OAuthClient = { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' };
const forcedConsent = (started: { authorizationUrl: string }) => new URL(started.authorizationUrl).searchParams.get('force_consent');

describe('client kind', () => {
  it('sends the hosted extra parameters, not the installed-app ones, for a hosted client', async () => {
    h = buildHarness(provider, { client: HOSTED_CLIENT, clientKind: 'confidential' });
    const { started } = await signIn(h, provider);
    const params = new URL(started.authorizationUrl).searchParams;
    expect([params.get('include_granted'), params.get('prompt')]).toEqual(['true', null]);
  });
});

describe('hosted sign-ins always end renewable (a repeat consent may omit the refresh token)', () => {
  beforeEach(() => { h = buildHarness(provider, { client: HOSTED_CLIENT, clientKind: 'confidential' }); });

  it('refuses a hosted first connect that grants no refresh token and writes nothing', async () => {
    const { started, callbackParams } = await signIn(h, provider, { omitRefreshToken: true });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'offline-access-required' });
    expect([h.tokens.entries.size, (await h.service.getStatus({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).status])
      .toEqual([0, 'disconnected']);
  });
  it('refuses to stage a hosted switch whose new account granted no refresh token', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob', intent: 'switch-account', omitRefreshToken: true });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'offline-access-required' });
    expect(h.tokens.entries.has(`${ref}#staged`)).toBe(false);
  });
  it('forces consent on a hosted first connect, when nothing renewable is stored', async () => {
    expect(forcedConsent((await signIn(h, provider)).started)).toBe('true');
  });
  it('does not force consent on a hosted reconnect while a renewable credential is stored', async () => {
    await connect('alice');
    expect(forcedConsent((await signIn(h, provider)).started)).toBeNull();
  });
  it('forces consent on a hosted reconnect once the connection needs reconnecting', async () => {
    const ref = await connect('alice');
    const record = (await h.records.read({ key: ref }))!;
    await h.records.compareAndSet({ key: ref, expectedRevision: record.revision,
      record: { ...record, status: 'reconnect-required', revision: record.revision + 1 } });
    expect(forcedConsent((await signIn(h, provider)).started)).toBe('true');
  });
  it('forces consent on a hosted reconnect when the stored credential has no refresh token', async () => {
    const ref = await connect('alice');
    h.tokens.entries.set(ref, { ...h.tokens.entries.get(ref)!, refreshToken: null });
    expect(forcedConsent((await signIn(h, provider)).started)).toBe('true');
  });
  it('forces consent on a hosted switch: the new account holds nothing renewable here', async () => {
    await connect('alice');
    expect(forcedConsent((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).started)).toBe('true');
  });
  it('never adds the force-consent parameters for an installed app (its own parameters re-consent every time)', async () => {
    h = buildHarness(provider);
    expect(forcedConsent((await signIn(h, provider)).started)).toBeNull();
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
  it('keeps the stored refresh token when a same-account re-consent omits one, so the credential stays renewable', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', omitRefreshToken: true });
    await complete(callbackParams);
    expect([(await h.tokens.load({ key: ref }))?.accessToken, (await h.tokens.load({ key: ref }))?.refreshToken]).toEqual(['acme-at-2', 'acme-rt-1']);
  });
  it('refuses a first connect that grants no refresh token and stores nothing', async () => {
    const { started, callbackParams } = await signIn(h, provider, { omitRefreshToken: true });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'offline-access-required' });
    expect([h.tokens.entries.size, (await h.service.getStatus({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).status])
      .toEqual([0, 'disconnected']);
  });
  it('refuses to stage a switch whose new account granted no refresh token', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob', intent: 'switch-account', omitRefreshToken: true });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'offline-access-required' });
    expect([h.tokens.entries.has(`${ref}#staged`), (await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).pendingSwitch]).toEqual([false, null]);
  });
  it('keeps the secret out of the authorization URL, attempt, record, stored tokens, status and result', async () => {
    const { started, callbackParams } = await signIn(h, provider);
    const attempts = JSON.stringify([...h.records.attempts.values()]);
    const result = await complete(callbackParams);
    const stored = JSON.stringify([await h.records.read({ key: started.connectionRef }), [...h.tokens.entries.values()],
      await h.service.getStatus({ connectionRef: started.connectionRef, workspaceId: 'ws-1' }), result, started]);
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
    await v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, browserBinding: browserBindingOf(v, callbackParams) });
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).toBe('acme-at-1');
  });
  it('stages and confirms an account switch', async () => {
    const v = buildVaultHarness(provider);
    const finish = (callbackParams: Record<string, string>) =>
      v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, browserBinding: browserBindingOf(v, callbackParams) });
    const { started, callbackParams } = await signIn(v, provider, { account: 'alice' });
    await finish(callbackParams);
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await v.service.confirmSwitchAccount({ connectionRef: started.connectionRef, workspaceId: 'ws-1', actorId: 'actor-1' });
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' }, { expectedAccountId: 'bob' })).toBe('acme-at-2');
  });
  it('keeps the stored refresh token on a hosted same-account reconnect right after a token was served', async () => {
    const v = buildVaultHarness(provider, { client: { clientId: 'acme-web', clientSecret: 'test-only', authMethod: 'client_secret_post' },
      clientKind: 'confidential' });
    const finish = (callbackParams: Record<string, string>) =>
      v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, browserBinding: browserBindingOf(v, callbackParams) });
    const { started, callbackParams } = await signIn(v, provider, { account: 'alice' });
    await finish(callbackParams);
    expect(await v.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).toBe('acme-at-1');
    await finish((await signIn(v, provider, { account: 'alice', omitRefreshToken: true })).callbackParams);
    expect((await v.tokens.load({ key: started.connectionRef }))?.refreshToken).toBe('acme-rt-1');
  });
});

describe('granted scopes', () => {
  it('stores nothing when the account granted fewer scopes than requested', async () => {
    const { started, callbackParams } = await signIn(h, provider, { grantScopes: ['acme.other'] });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'scope-not-granted' });
    expect([h.tokens.entries.size, (await h.service.getStatus({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).status]).toEqual([0, 'disconnected']);
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
    const status = JSON.stringify(await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' }));
    expect(status).not.toMatch(/acme-(at|rt)-|acme-code-/);
  });
  it('keeps every token out of a reconnect-required refusal and its causes', async () => {
    const ref = await connect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    h.clock.now += 3600_000;
    const error = await h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }).then((): Error => new Error('expected a refusal'), (caught: unknown) => caught as Error);
    const chain = [error, error.cause, (error.cause as Error | undefined)?.cause].map(item => (item as Error | undefined)?.message ?? '');
    expect([(error as { code?: string }).code, chain.join(' ')]).toEqual(['reconnect-required', expect.not.stringMatching(/acme-(at|rt)-/)]);
  });
});

describe('serving access tokens', () => {
  it('moves to reconnect-required and refuses when the provider rejects the refresh token', async () => {
    const ref = await connect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    h.clock.now += 3600_000;
    await expect(h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'reconnect-required' });
    expect((await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status).toBe('reconnect-required');
  });
  it('refuses a connectionRef that belongs to another plugin', async () => {
    const ref = await connect();
    const foreign = buildHarness(provider, { pluginId: 'other-plugin' });
    // Copy the record so only the plugin-ownership check stands in the way.
    await foreign.records.compareAndSet({ key: ref, expectedRevision: 0, record: (await h.records.read({ key: ref }))! });
    await expect(foreign.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'connection-not-found' });
  });
});

describe('workspace binding of connectionRef-only operations', () => {
  const foreign = { workspaceId: 'ws-2' };
  it.each([
    ['getAccessToken', (ref: string) => h.service.getAccessToken({ connectionRef: ref, ...foreign })],
    ['getStatus', (ref: string) => h.service.getStatus({ connectionRef: ref, ...foreign })],
    ['disconnect', (ref: string) => h.service.disconnect({ connectionRef: ref, ...foreign })],
    ['confirmSwitchAccount', (ref: string) => h.service.confirmSwitchAccount({ connectionRef: ref, ...foreign, actorId: 'actor-1' })],
    ['cancelSwitchAccount', (ref: string) => h.service.cancelSwitchAccount({ connectionRef: ref, ...foreign })],
  ])('%s refuses a ref of another workspace', async (_name, call) => {
    const ref = await connect();
    await expect(call(ref)).rejects.toMatchObject({ code: 'connection-not-found' });
  });
  it('a refused foreign disconnect leaves the record connected and revokes nothing', async () => {
    const ref = await connect();
    await h.service.disconnect({ connectionRef: ref, ...foreign }).catch(() => undefined);
    expect([(await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status, provider.revoked]).toEqual(['connected', []]);
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
  it('stages a switch without changing the live account until confirmed', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'bob', intent: 'switch-account' });
    expect((await complete(callbackParams)).outcome).toBe('staged');
    expect(await h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }, { expectedAccountId: 'alice' })).toBe('acme-at-1');
  });
  it('refuses a switch to the account already connected, staging nothing and revoking nothing', async () => {
    const ref = await connect('alice');
    const { callbackParams } = await signIn(h, provider, { account: 'alice', intent: 'switch-account' });
    await expect(complete(callbackParams)).rejects.toMatchObject({ code: 'account-unchanged' });
    expect([(await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).pendingSwitch, h.tokens.entries.has(`${ref}#staged`), provider.revoked])
      .toEqual([null, false, []]);
    expect(await h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }, { expectedAccountId: 'alice' })).toBe('acme-at-1');
  });
  it('refuses a switch confirmation from a different actor', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await expect(h.service.confirmSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1', actorId: 'actor-2' })).rejects.toMatchObject({ code: 'switch-not-staged' });
  });
  it('refuses a frozen binding once the confirmed switch changed the account', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await h.service.confirmSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1', actorId: 'actor-1' });
    await expect(h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }, { expectedAccountId: 'alice' })).rejects.toMatchObject({ code: 'account-changed' });
  });
});

describe('revocation honesty', () => {
  it('stays revocation-pending, keeps the credential and serves nothing when remote revocation fails', async () => {
    const ref = await connect();
    provider.failRevocation = true;
    const result = await h.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.status, result.remoteRevocation, h.tokens.entries.has(ref)]).toEqual(['revocation-pending', 'pending', true]);
    await expect(h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('clears the kept credential when a retried disconnect is confirmed', async () => {
    const ref = await connect();
    provider.failRevocation = true;
    await h.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    provider.failRevocation = false;
    const retried = await h.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([retried.status, retried.remoteRevocation, h.tokens.entries.has(ref)]).toEqual(['disconnected', 'confirmed', false]);
  });
});

describe('characterization: account actions that must keep their behaviour (pinned before G1c)', () => {
  it('cancelling a staged switch revokes the staged grant and keeps the live account serving', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const cancelled = await h.service.cancelSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([cancelled.remoteRevocation, cancelled.pendingSwitch, provider.revoked]).toEqual(['confirmed', null, ['acme-rt-2']]);
    expect(await h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }, { expectedAccountId: 'alice' })).toBe('acme-at-1');
  });
  it('a same-account reconnect never calls the revoke hook (the new tokens share the grant)', async () => {
    await connect('alice');
    await complete((await signIn(h, provider, { account: 'alice' })).callbackParams);
    expect(provider.revoked).toEqual([]);
  });
  it('a confirmed switch never calls the revoke hook for the previous account', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await h.service.confirmSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1', actorId: 'actor-1' });
    expect(provider.revoked).toEqual([]);
  });
});

describe('revocation honesty against the real vault token store', () => {
  let v: ReturnType<typeof buildVaultHarness>;
  const finish = (callbackParams: Record<string, string>) =>
    v.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, browserBinding: browserBindingOf(v, callbackParams) });
  async function vaultConnect(account = 'alice') {
    const { started, callbackParams } = await signIn(v, provider, { account });
    await finish(callbackParams);
    return started.connectionRef;
  }
  beforeEach(() => { v = buildVaultHarness(provider); });

  it('disconnect calls the revoke hook once with the stored grant and reports confirmed', async () => {
    const ref = await vaultConnect();
    const result = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.status, result.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'confirmed', ['acme-rt-1']]);
  });
  it('clears the local credential after a confirmed revocation', async () => {
    const ref = await vaultConnect();
    await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    const again = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([again.remoteRevocation, provider.revoked]).toEqual(['not-needed', ['acme-rt-1']]);
  });
  it('stays revocation-pending and serves no token when the revoke hook fails', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    const result = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.status, result.remoteRevocation, await v.tokens.load({ key: ref })]).toEqual(['revocation-pending', 'pending', null]);
    await expect(v.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('retries a pending revocation with the kept credential, then clears it', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    provider.failRevocation = false;
    const retried = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([retried.status, retried.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'confirmed', ['acme-rt-1']]);
  });
  it('reports not-needed only when no credential is stored (the provider already rejected the grant)', async () => {
    const ref = await vaultConnect();
    await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token: 'acme-rt-1' }) });
    v.clock.now += 3600_000;
    await expect(v.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'reconnect-required' });
    const result = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.status, result.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'not-needed', ['acme-rt-1']]);
  });
  it('disconnect also revokes a staged switch credential', async () => {
    const ref = await vaultConnect('alice');
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const result = await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.remoteRevocation, [...provider.revoked].sort()]).toEqual(['confirmed', ['acme-rt-1', 'acme-rt-2']]);
  });
  it('refuses a new sign-in while a revocation is pending, so the kept credential is not orphaned', async () => {
    const ref = await vaultConnect();
    provider.failRevocation = true;
    await v.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    await expect(signIn(v, provider)).rejects.toMatchObject({ code: 'revocation-pending' });
  });
  it('cancelling with no staged switch never calls the revoke hook and keeps the live account', async () => {
    const ref = await vaultConnect();
    const result = await v.service.cancelSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.remoteRevocation, result.status, provider.revoked]).toEqual(['not-needed', 'connected', []]);
    expect(await v.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).toBe('acme-at-1');
  });
  it('keeps a staged switch for a retry when cancelling cannot revoke it', async () => {
    const ref = await vaultConnect('alice');
    await finish((await signIn(v, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    provider.failRevocation = true;
    const failed = await v.service.cancelSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1' });
    provider.failRevocation = false;
    const retried = await v.service.cancelSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1' });
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
    expect([(await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).pendingSwitch?.accountId, h.tokens.entries.get(`${ref}#staged`)?.accessToken])
      .toEqual(['bob', 'acme-at-2']);
  });
  it('refuses a connect that completes after a switch was staged, keeping the staged credential and the live account', async () => {
    const ref = await connect('alice');
    const reconnect = await signIn(h, provider, { account: 'alice' });
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    await expect(complete(reconnect.callbackParams)).rejects.toMatchObject({ code: 'switch-in-progress' });
    expect([(await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).pendingSwitch?.accountId,
      h.tokens.entries.get(`${ref}#staged`)?.accessToken, h.tokens.entries.get(ref)?.accessToken]).toEqual(['bob', 'acme-at-2', 'acme-at-1']);
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
    await expect(h.service.confirmSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1', actorId: 'actor-1' })).rejects.toThrow('simulated crash');
    h.tokens.delete = realDelete;
    const result = await h.service.cancelSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.remoteRevocation, provider.revoked]).toEqual(['not-needed', []]);
    expect(await h.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' }, { expectedAccountId: 'bob' })).toBe('acme-at-2');
  });
  it('a confirmed switch answers with the new account\'s status view only (the previous grant is never revoked)', async () => {
    const ref = await connect('alice');
    await complete((await signIn(h, provider, { account: 'bob', intent: 'switch-account' })).callbackParams);
    const confirmed = await h.service.confirmSwitchAccount({ connectionRef: ref, workspaceId: 'ws-1', actorId: 'actor-1' });
    expect([confirmed, provider.revoked]).toEqual([await h.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' }), []]);
  });
});

describe('a changed OAuth client or an unreadable stored credential never locks the connection out', () => {
  let before: ReturnType<typeof buildVaultHarness>;
  let after: ReturnType<typeof buildVaultHarness>;
  let ref: string;
  const finishOn = (x: Harness<VaultOAuthTokenStore>, callbackParams: Record<string, string>) =>
    x.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK, callbackParams, browserBinding: browserBindingOf(x, callbackParams) });
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
    expect(await after.service.getAccessToken({ connectionRef: ref, workspaceId: 'ws-1' })).toBe('acme-at-2');
  });
  it('a hosted same-account reconnect under the new client installs instead of failing on the old row', async () => {
    const hosted = buildVaultHarness(provider, { client: HOSTED_CLIENT, clientKind: 'confidential', records: before.records }, before.vault);
    await finishOn(hosted, (await signIn(hosted, provider, { account: 'alice' })).callbackParams);
    expect((await hosted.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status).toBe('connected');
  });
  it('a hosted reconnect under the new client forces consent: the old row cannot renew', async () => {
    const hosted = buildVaultHarness(provider, { client: HOSTED_CLIENT, clientKind: 'confidential', records: before.records }, before.vault);
    expect(forcedConsent((await signIn(hosted, provider, { account: 'alice' })).started)).toBe('true');
  });
  it('disconnect removes the unreadable credential locally and reports pending, never confirmed', async () => {
    const result = await after.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    expect([result.status, result.remoteRevocation, provider.revoked, await storedRow()]).toEqual(['disconnected', 'pending', [], null]);
  });
  it('allows a new sign-in after such a disconnect', async () => {
    await after.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    await finishOn(after, (await signIn(after, provider)).callbackParams);
    expect((await after.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status).toBe('connected');
  });
  it('treats a malformed stored credential the same way: removed locally, pending, then reconnectable', async () => {
    const row = (await storedRow())!;
    await before.vault.put({ ...VAULT_SCOPE, id: ref, expectedRevision: row.summary.revision, provider: null, label: ref,
      meta: buildRecordMeta({ meta: { status: 'active', leaseHolder: null, leaseExpiresAtMs: null } }),
      payload: { format: 'oauth-token-set', version: 99 } }); // malformed on purpose
    const result = await before.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' });
    await finishOn(before, (await signIn(before, provider)).callbackParams);
    expect([result.status, result.remoteRevocation, (await before.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status])
      .toEqual(['disconnected', 'pending', 'connected']);
  });
  it('surfaces any other token-store failure during revocation and keeps the credential', async () => {
    before.tokens.loadForRevocation = async () => { throw new Error('vault unavailable'); };
    await expect(before.service.disconnect({ connectionRef: ref, workspaceId: 'ws-1' })).rejects.toThrow('vault unavailable');
    expect([(await before.service.getStatus({ connectionRef: ref, workspaceId: 'ws-1' })).status, await storedRow()])
      .toEqual(['revocation-pending', expect.objectContaining({ payload: expect.anything() })]);
  });
});
