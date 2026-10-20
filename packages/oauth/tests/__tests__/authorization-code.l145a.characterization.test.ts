import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginAuthorizationCode } from '../../src/authorization-code.js';
import { createOAuthUrlGuard } from '../../src/endpoint-safety.js';
import { defaultOAuthMessages } from '../../src/messages.js';
import { createPendingAuthorizationStore, type PendingAuthorization } from '../../src/pending-authorizations.js';
import type { OAuthProviderDescriptor, OAuthRandomBytes } from '../../src/ports.js';
import { MAX_AUTHORIZATION_STATE_LENGTH, type SealedAuthorizationState } from '../../src/sealed-state.js';
import { createTestClock, TEST_CLIENT, TEST_PROVIDER } from '../helpers.js';

const redirectUri = 'https://client.example/callback';
const entropy: OAuthRandomBytes = ({ byteLength }) => new Uint8Array(byteLength).fill(9);
function flow(_required: Record<string, never>, { provider = TEST_PROVIDER }: { provider?: OAuthProviderDescriptor } = {}) {
  const clock = createTestClock();
  const pending = createPendingAuthorizationStore({ clock, randomBytesFn: entropy });
  return { provider, pending, randomBytesFn: entropy,
    guard: createOAuthUrlGuard({ assertAllowed: () => undefined }),
    options: { clientDisplayName: 'Client', softwareId: 'client', redirectUris: [redirectUri] },
    ownerKey: 'owner', client: TEST_CLIENT, redirectUri };
}

describe('begin authorization code characterization', () => {
  it('stores the exact redirect, resource, default scopes and PKCE secret while exposing only its challenge', async () => {
    const deps = flow({});
    const result = await beginAuthorizationCode(deps, { resource: ['https://api.example/a', 'https://api.example/b'],
      extraAuthorizationParams: { prompt: 'consent' } });
    const saved = await deps.pending.take({ state: result.state, ownerKey: 'owner' });
    expect(saved).toEqual({ state: result.state, ownerKey: 'owner', providerId: TEST_PROVIDER.providerId,
      codeVerifier: Buffer.from(new Uint8Array(32).fill(9)).toString('base64url'), redirectUri,
      scopes: ['images:generate'], resource: ['https://api.example/a', 'https://api.example/b'],
      createdAt: '2026-08-25T12:00:00.000Z', expiresAt: '2026-08-25T12:10:00.000Z' });
    const url = new URL(result.authorizationUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({ prompt: 'consent', resource: 'https://api.example/b',
      response_type: 'code', client_id: TEST_CLIENT.clientId, redirect_uri: redirectUri, scope: 'images:generate',
      state: result.state, code_challenge: createHash('sha256').update(saved.codeVerifier).digest('base64url'), code_challenge_method: 'S256' });
    expect(url.searchParams.getAll('resource')).toEqual(['https://api.example/a', 'https://api.example/b']);
    expect(result.expiresAt).toBe(saved.expiresAt);
  });

  it('supports non-PKCE providers and empty scope overrides without removing endpoint query parameters', async () => {
    const deps = flow({}, { provider: { ...TEST_PROVIDER, usesPkce: false,
      authorizationEndpoint: 'https://auth.example.com/authorize?scope=existing&code_challenge=existing' } });
    const result = await beginAuthorizationCode(deps, { scopes: [] });
    const saved = await deps.pending.take({ state: result.state, ownerKey: 'owner' });
    expect(saved.codeVerifier).toBe('');
    expect(saved.scopes).toEqual([]);
    expect(saved).not.toHaveProperty('resource');
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get('scope')).toBe('existing');
    expect(url.searchParams.get('code_challenge')).toBe('existing');
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
  });

  it('applies custom scopes and writes an empty scope when the nonempty array contains an empty string', async () => {
    const deps = flow({});
    const result = await beginAuthorizationCode(deps, { scopes: [''] });
    expect(new URL(result.authorizationUrl).searchParams.get('scope')).toBe('');
    expect((await deps.pending.take({ state: result.state, ownerKey: 'owner' })).scopes).toEqual(['']);
  });

  it('seals a stateless request without invoking a pending store', async () => {
    const { pending: _pending, ...deps } = flow({});
    const sealed: Omit<PendingAuthorization, 'state' | 'createdAt' | 'expiresAt'>[] = [];
    const stateless: SealedAuthorizationState = {
      async seal({ entry }) { sealed.push(entry); return { ...entry, state: 'sealed',
        createdAt: '2026-08-25T12:00:00.000Z', expiresAt: '2026-08-25T12:01:00.000Z' }; },
      async open() { throw new Error('unexpected open'); },
    };
    const result = await beginAuthorizationCode({ ...deps, stateless }, { scopes: ['email'], resource: 'https://api.example/' });
    expect(sealed).toEqual([{ ownerKey: 'owner', providerId: TEST_PROVIDER.providerId,
      codeVerifier: Buffer.from(new Uint8Array(32).fill(9)).toString('base64url'), redirectUri,
      scopes: ['email'], resource: 'https://api.example/' }]);
    expect(result.state).toBe('sealed');
    expect(result.expiresAt).toBe('2026-08-25T12:01:00.000Z');
  });

  it.each(['', 's'.repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1)])('rejects an invalid stored state of length %s', async state => {
    const { pending: _pending, ...deps } = flow({});
    const stateless: SealedAuthorizationState = {
      async seal({ entry }) { return { ...entry, state, createdAt: '2026-08-25T12:00:00.000Z', expiresAt: '2026-08-25T12:10:00.000Z' }; },
      async open() { throw new Error('unexpected open'); },
    };
    await expect(beginAuthorizationCode({ ...deps, stateless })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
  });

  it('accepts the maximum state length from storage', async () => {
    const { pending: _pending, ...deps } = flow({});
    const state = 's'.repeat(MAX_AUTHORIZATION_STATE_LENGTH);
    const stateless: SealedAuthorizationState = {
      async seal({ entry }) { return { ...entry, state, createdAt: '2026-08-25T12:00:00.000Z', expiresAt: '2026-08-25T12:10:00.000Z' }; },
      async open() { throw new Error('unexpected open'); },
    };
    expect((await beginAuthorizationCode({ ...deps, stateless })).state).toBe(state);
  });

  it.each([
    { provider: { ...TEST_PROVIDER, supportedGrants: [] }, message: "provider 'test-provider' does not support the authorization_code grant" },
    { provider: { ...TEST_PROVIDER, authorizationEndpoint: '' }, message: "provider 'test-provider' declares no authorization endpoint" },
  ])('rejects unsupported or absent authorization endpoints before storage: $message', async ({ provider, message }) => {
    const deps = flow({}, { provider });
    await expect(beginAuthorizationCode(deps)).rejects.toMatchObject({ code: 'OAUTH_UNSUPPORTED_GRANT', message });
    expect(await deps.pending.size({})).toBe(0);
  });

  it('validates app identity before checking grant support', async () => {
    const deps = flow({}, { provider: { ...TEST_PROVIDER, supportedGrants: [] } });
    await expect(beginAuthorizationCode({ ...deps, options: { ...deps.options, clientDisplayName: '' } }))
      .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', message: "OAuth client option 'clientDisplayName' is required and must be valid" });
    expect(await deps.pending.size({})).toBe(0);
  });

  it('rejects an unregistered redirect and accepts the canonical URL of a registered redirect', async () => {
    const deps = flow({});
    await expect(beginAuthorizationCode({ ...deps, redirectUri: 'https://other.example/callback' }))
      .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', message: 'redirect URI is not in the configured client identity' });
    expect(await deps.pending.size({})).toBe(0);
    const result = await beginAuthorizationCode({ ...deps, options: { ...deps.options, redirectUris: ['https://CLIENT.example:443/callback'] } });
    expect(new URL(result.authorizationUrl).searchParams.get('redirect_uri')).toBe(redirectUri);
  });

  it.each(['resource', 'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'])
    ('refuses a reserved extra parameter before storage: %s', async key => {
      const deps = flow({});
      await expect(beginAuthorizationCode(deps, { extraAuthorizationParams: { [key]: 'override' } }))
        .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', message: `'${key}' is set by the OAuth client and cannot be overridden for this provider` });
      expect(await deps.pending.size({})).toBe(0);
    });

  it('preserves host supplied reserved-parameter messages', async () => {
    const deps = flow({});
    await expect(beginAuthorizationCode(deps, { extraAuthorizationParams: { state: 'override' },
      messages: { ...defaultOAuthMessages, reservedAuthorizationParameter: ({ parameter }) => `Reserved ${parameter}`,
        reservedAuthorizationParameterAction: 'Remove it' } }))
      .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', message: 'Reserved state', operatorAction: 'Remove it' });
  });

  it.each([
    { provider: { ...TEST_PROVIDER, authorizationEndpoint: 'http://auth.example.com/authorize' }, callback: redirectUri },
    { provider: TEST_PROVIDER, callback: 'http://client.example/callback' },
  ])('runs URL safety before storing a request: $callback', async ({ provider, callback }) => {
    const deps = flow({}, { provider });
    await expect(beginAuthorizationCode({ ...deps, redirectUri: callback })).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(await deps.pending.size({})).toBe(0);
  });

  it('rejects a resource fragment before storage', async () => {
    const deps = flow({});
    await expect(beginAuthorizationCode(deps, { resource: 'https://api.example/#fragment' }))
      .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    expect(await deps.pending.size({})).toBe(0);
  });
});
