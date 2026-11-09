/**
 * @file H2 conformance: the host wires the REAL `@jini-ai/oauth` exports (`oauthFlowOperations`, the real
 * capabilities and `isOAuthError` classifier) and the REAL vault-conflict classifier through the public
 * `api-connections` entry, so a structural fake elsewhere cannot hide a signature or behaviour mismatch.
 * Proves start, callback, refresh, hand-off and conflict through the injected operations, with the real
 * bounds, state bytes and error identity, and that a provider message carrying a token, secret, URL or
 * path never reaches model-facing text.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createOAuthUrlGuard, MAX_AUTHORIZATION_STATE_LENGTH, MAX_CALLBACK_FIELD_LENGTH, OAuthError, oauthFlowOperations,
  PENDING_AUTHORIZATION_STATE_BYTES, type OAuthFetch,
} from '@jini-ai/oauth';
import { VaultError } from '@jini-ai/platform/secrets/credential-sets';
import {
  ApiConnectionError, createApiConnectionService, createSignInHandoffs, parseApiConnectionDescriptor, type ApiConnectionService,
} from '../index.js';
import { startAcmeProvider, type AcmeProvider } from './fixtures/acme-provider.js';
import { acmeHooks, CALLBACK, memoryRecordStore, memoryTokenStore } from './fixtures/harness.js';
import { realCallbackFieldRules, realOAuthCapabilities, realVaultConflict } from './fixtures/real-capabilities.js';

const CANARIES = ['at-CANARY-7f3a', 'sk-CANARY-secret-91', 'https://canary.invalid/leak?code=1', '/var/lib/canary/secret.json'] as const;
const CANARY_DESCRIPTION = `upstream said ${CANARIES.join(' ')}`;

interface Rig { service: ApiConnectionService; clock: { now: number; nowMs(): number }; poison: { token: string | null } }

/** The production wiring shape over a local fake provider; `poison.token` makes the next token call fail with a canary body. */
function rig(provider: AcmeProvider): Rig {
  const poison: Rig['poison'] = { token: null };
  const fetchFn: OAuthFetch = async ({ url }, init) => {
    if (!String(url).startsWith(provider.origin)) throw new Error('test fetch refused a foreign host');
    if (String(url).endsWith('/token') && poison.token !== null) {
      const error = poison.token;
      poison.token = null;
      return new Response(JSON.stringify({ error, error_description: CANARY_DESCRIPTION, error_uri: CANARIES[2] }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return fetch(url, init);
  };
  const descriptor = parseApiConnectionDescriptor({ callbackFieldRules: realCallbackFieldRules, value: {
    pluginId: 'conformance-plugin', connectionId: 'account', label: 'Conformance account',
    authorizationEndpoint: `${provider.origin}/authorize`, tokenEndpoint: `${provider.origin}/token`,
    callbackFields: [{ name: 'picked', maxLength: 64 }],
  } });
  const clock = { now: Date.parse('2026-10-20T10:00:00.000Z'), nowMs() { return this.now; } };
  const service = createApiConnectionService({ oauth: realOAuthCapabilities, descriptor, client: { clientId: 'conformance', authMethod: 'none' },
    clientKind: 'public', hooks: acmeHooks(provider), records: memoryRecordStore(), tokens: memoryTokenStore(), fetchFn, clock,
    appOptions: { clientDisplayName: 'Conformance host', softwareId: 'conformance-host', redirectUris: [CALLBACK] },
    guard: createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true }),
    randomBytesFn: ({ byteLength }) => randomBytes(byteLength), sleep: async () => undefined });
  return { service, clock, poison };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

function expectNoCanary(text: string): void {
  for (const canary of CANARIES) expect(text).not.toContain(canary);
  expect(text).not.toContain('upstream said');
}

const SCOPE = { workspaceId: 'ws-c', actorId: 'actor-c' } as const;

let provider: AcmeProvider;
let r: Rig;
beforeEach(async () => { provider = await startAcmeProvider(); r = rig(provider); });
afterEach(async () => { await provider.close(); });

async function connect() {
  const started = await r.service.start({ ...SCOPE, intent: 'connect', scopeSetIds: ['files'], redirectUri: CALLBACK });
  const callbackParams = provider.approve({ authorizationUrl: started.authorizationUrl, account: 'carol' });
  return { started, callbackParams };
}

describe('real OAuth exports through the public api-connections entry', () => {
  it('wires the host one capabilities object from the real flow operations value', () => {
    expect(realOAuthCapabilities.flow).toBe(oauthFlowOperations);
    expect(realOAuthCapabilities.pendingStateBytes).toBe(PENDING_AUTHORIZATION_STATE_BYTES);
    expect(realOAuthCapabilities.maxAuthorizationStateLength).toBe(MAX_AUTHORIZATION_STATE_LENGTH);
  });

  it('starts with real state bytes and PKCE, completes the callback, and refreshes through the real refresher', async () => {
    const { started, callbackParams } = await connect();
    expect(Buffer.from(started.state, 'base64url').length).toBe(PENDING_AUTHORIZATION_STATE_BYTES);
    expect(new URL(started.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
    const completed = await r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding,
      callbackParams: { ...callbackParams, picked: 'p-1' } });
    expect([completed.outcome, completed.callbackFields]).toEqual(['connected', { picked: 'p-1' }]);
    expect(await r.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: SCOPE.workspaceId })).toBe('acme-at-1');
    r.clock.now += 3600_000;
    expect(await r.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: SCOPE.workspaceId })).toBe('acme-at-2');
    expect(provider.tokenRequests.length).toBe(2);
  });

  it('refuses a callback one character past the real bound before contacting the provider, and accepts the bound itself', async () => {
    const { started, callbackParams } = await connect();
    const over = failure(r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding,
      callbackParams: { ...callbackParams, picked: 'x'.repeat(Math.max(MAX_CALLBACK_FIELD_LENGTH, MAX_AUTHORIZATION_STATE_LENGTH) + 1) } }));
    expect(await over).toMatchObject({ code: 'request-invalid' });
    expect(provider.tokenRequests.length).toBe(0);
    const atBound = await failure(r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding,
      callbackParams: { ...callbackParams, state: 's'.repeat(MAX_AUTHORIZATION_STATE_LENGTH) } }));
    expect(atBound).toBeInstanceOf(ApiConnectionError);
    expect((atBound as ApiConnectionError).code).not.toBe('request-invalid');
  });

  it('maps a provider refresh refusal to the reconnect refusal, keeping the real OAuthError as cause and no provider text', async () => {
    const { started, callbackParams } = await connect();
    await r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding, callbackParams });
    r.clock.now += 3600_000;
    r.poison.token = 'invalid_grant';
    const error = await failure(r.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: SCOPE.workspaceId }));
    expect(error).toBeInstanceOf(ApiConnectionError);
    expect(error).toMatchObject({ code: 'reconnect-required',
      message: 'This connection needs to be reconnected. Reconnect the account in the connection settings.' });
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(OAuthError);
    expect((cause as OAuthError).code).toBe('OAUTH_INVALID_GRANT');
    expectNoCanary((error as Error).message);
  });

  it('keeps provider text out of a failed code exchange and identifies the real OAuthError', async () => {
    const { started, callbackParams } = await connect();
    r.poison.token = 'invalid_client';
    const error = await failure(r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding, callbackParams }));
    expect(error).toBeInstanceOf(ApiConnectionError);
    expect((error as ApiConnectionError).code).toBe('authorization-failed');
    expect((error as Error).cause).toBeInstanceOf(OAuthError);
    expectNoCanary((error as Error).message);
  });

  it('never copies a provider secret in the error code into the model-facing connection failure', async () => {
    const { started, callbackParams } = await connect();
    const providerSecret = 'sk_' + 'live_' + 'CANARY';
    r.poison.token = providerSecret;
    const error = await failure(r.service.complete({ ...SCOPE, redirectUri: CALLBACK, browserBinding: started.browserBinding, callbackParams }));
    expect(error).toBeInstanceOf(ApiConnectionError);
    expect((error as ApiConnectionError).code).toBe('authorization-failed');
    expect((error as Error).cause).toBeInstanceOf(OAuthError);
    expect((error as Error).message).toBe('Sign-in did not complete: the authorization server returned an unrecognized error (HTTP 400). '
      + "Check this provider's client id, secret, scopes and redirect URI, then try connecting again.");
    expect((error as Error).message).not.toContain(providerSecret);
    expectNoCanary((error as Error).message);
  });

  it('issues single-use hand-offs through the real pending store and state generator', () => {
    const handoffs = createSignInHandoffs({ oauth: realOAuthCapabilities, clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') },
      randomBytesFn: ({ byteLength }) => randomBytes(byteLength) });
    const draft = { actorId: 'actor-c', authorizationUrl: 'https://auth.example.test/authorize', browserBinding: 'b'.repeat(43),
      expiresAt: '2030-01-01T00:10:00.000Z' };
    const id = handoffs.issue(draft);
    expect(Buffer.from(id, 'base64url').length).toBe(32); // hand-off ids keep the base 32-byte width, not the pending-state width
    expect(handoffs.take({ handoffId: id, actorId: 'actor-c' })).toEqual(draft);
    expect(handoffs.take({ handoffId: id, actorId: 'actor-c' })).toBeNull();
  });

  it('classifies only the real vault conflict as a conflict', () => {
    expect(realVaultConflict(new VaultError({ code: 'conflict' }))).toBe(true);
    expect(realVaultConflict(new VaultError({ code: 'context' }))).toBe(false);
    expect(realVaultConflict(Object.assign(new Error('Secrets vault: conflict'), { code: 'conflict' }))).toBe(false);
  });
});
