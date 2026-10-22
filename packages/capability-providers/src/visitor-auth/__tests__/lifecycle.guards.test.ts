import { describe, expect, it } from 'vitest';

import {
  evaluateVisitorAuthCallback,
  FACEBOOK_VISITOR_AUTH_PROVIDER,
  GOOGLE_VISITOR_AUTH_PROVIDER,
  planVisitorAuthAuthorization,
  validateVisitorAuthIdentityClaims,
  type VisitorAuthAuthorizationServer,
  type VisitorAuthClientRegistration,
  type VisitorAuthTransaction,
  type VisitorAuthVerifiedIdTokenClaims,
} from '../index.js';

const nowMs = 1_800_000_000_000;
const server: VisitorAuthAuthorizationServer = {
  providerId: 'google',
  authorizationEndpoint: 'https://accounts.example.test/authorize',
  tokenEndpoint: 'https://accounts.example.test/token',
  issuer: 'https://accounts.example.test',
  supportsPkceS256: true,
};
const { issuer: _omittedIssuer, ...serverWithoutIssuer } = server;
const registration: VisitorAuthClientRegistration = { tenantId: 'tenant-1', providerId: 'google', clientId: 'client-1' };
const security = { state: 's'.repeat(32), nonce: 'n'.repeat(32), codeVerifier: 'v'.repeat(43), codeChallenge: 'c'.repeat(43) };

type PlanRequired = Parameters<typeof planVisitorAuthAuthorization>[0];
function planWith(overrides: Partial<PlanRequired> = {}, optional: Parameters<typeof planVisitorAuthAuthorization>[1] = {}) {
  return planVisitorAuthAuthorization({
    provider: GOOGLE_VISITOR_AUTH_PROVIDER,
    server,
    registration,
    redirectUri: 'https://app.example.test/auth/callback',
    flowBinding: 'browser-session-1',
    security,
    nowMs,
    ...overrides,
  }, optional);
}

describe('planVisitorAuthAuthorization fails closed on configuration', () => {
  it.each([
    { name: 'an unparseable token endpoint', overrides: { server: { ...server, tokenEndpoint: 'not a url' } }, code: 'invalid-input', message: 'tokenEndpoint must be an absolute URL' },
    { name: 'a blank tenant id', overrides: { registration: { ...registration, tenantId: ' ' } }, code: 'invalid-input', message: 'tenantId must not be empty' },
    { name: 'a blank client id', overrides: { registration: { ...registration, clientId: '' } }, code: 'invalid-input', message: 'clientId must not be empty' },
    { name: 'a blank browser flow binding', overrides: { flowBinding: '  ' }, code: 'invalid-input', message: 'flowBinding must not be empty' },
    { name: 'a blank client secret reference', overrides: { registration: { ...registration, clientSecretRef: { id: ' ' } } }, code: 'invalid-input', message: 'clientSecretRef.id must not be empty' },
    { name: 'a server for another provider', overrides: { server: { ...server, providerId: 'facebook' } }, code: 'provider-mismatch', message: 'provider definition, authorization server, and client registration must match' },
    { name: 'a registration for another provider', overrides: { registration: { ...registration, providerId: 'facebook' } }, code: 'provider-mismatch', message: 'provider definition, authorization server, and client registration must match' },
    { name: 'a non-finite clock', overrides: { nowMs: Number.NaN }, code: 'invalid-input', message: 'nowMs must be finite' },
    { name: 'a server without PKCE S256', overrides: { server: { ...server, supportsPkceS256: false } }, code: 'pkce-s256-required', message: 'visitor-auth requires authorization servers that support PKCE S256' },
    { name: 'an OIDC server without an issuer', overrides: { server: serverWithoutIssuer }, code: 'invalid-input', message: 'OIDC authorization server metadata must declare an issuer' },
    { name: 'an authorization endpoint that presets client_id', overrides: { server: { ...server, authorizationEndpoint: 'https://accounts.example.test/authorize?client_id=other' } }, code: 'reserved-parameter', message: 'authorizationEndpoint must not preconfigure reserved parameter "client_id"' },
  ])('refuses $name', ({ overrides, code, message }) => {
    expect(() => planWith(overrides as Partial<PlanRequired>)).toThrowError(expect.objectContaining({ code, message }));
  });

  it.each([0, 1.5, 15 * 60 * 1000 + 1])('refuses a transaction lifetime of %s ms', ttlMs => {
    expect(() => planWith({}, { ttlMs })).toThrowError(expect.objectContaining({ code: 'invalid-input', message: 'ttlMs must be an integer between 1 and 900000' }));
  });

  it('plans a public-client flow with no secret reference, no extra parameters and no response-issuer requirement', () => {
    const { authorizationUrl, transaction } = planWith();
    expect(new URL(authorizationUrl).searchParams.get('prompt')).toBeNull();
    expect(transaction).not.toHaveProperty('clientSecretRef');
    expect(transaction.requiresAuthorizationResponseIssuer).toBe(false);
    expect(transaction.expiresAtMs).toBe(nowMs + 10 * 60 * 1000);
  });
});

describe('evaluateVisitorAuthCallback edge bindings', () => {
  const transaction = planWith().transaction;
  const callback = { state: transaction.state, code: 'authorization-code' };

  it('treats a non-finite clock as an expired transaction', () => {
    expect(evaluateVisitorAuthCallback({ transaction, callback, tenantId: 'tenant-1', flowBinding: 'browser-session-1', nowMs: Number.NaN })).toEqual({ decision: 'reject', reason: 'expired' });
  });

  it('rejects a callback that omits the issuer when the server requires one in the response', () => {
    const strict: VisitorAuthTransaction = { ...transaction, requiresAuthorizationResponseIssuer: true };
    expect(evaluateVisitorAuthCallback({ transaction: strict, callback, tenantId: 'tenant-1', flowBinding: 'browser-session-1', nowMs: nowMs + 1 })).toEqual({ decision: 'reject', reason: 'issuer-mismatch' });
  });

  it('builds an exchange request without a secret reference for a public client', () => {
    const result = evaluateVisitorAuthCallback({ transaction, callback, tenantId: 'tenant-1', flowBinding: 'browser-session-1', nowMs: nowMs + 1 });
    expect(result).toMatchObject({ decision: 'exchange', request: { clientId: 'client-1', authorizationCode: 'authorization-code' } });
    expect(result).not.toHaveProperty('request.clientSecretRef');
  });
});

describe('validateVisitorAuthIdentityClaims edge bindings', () => {
  const transaction = planWith().transaction;
  const { expectedIssuer: _omittedExpectedIssuer, ...withoutIssuer } = transaction;
  const { nonce: _omittedNonce, ...withoutNonce } = transaction;
  const nowSeconds = Math.floor(nowMs / 1000);
  const claims: VisitorAuthVerifiedIdTokenClaims = { issuer: 'https://accounts.example.test', subject: 'user-1', audience: 'client-1', expiresAtSeconds: nowSeconds + 300, nonce: 'n'.repeat(32) };

  it.each([-1, 301, Number.NaN])('refuses a clock skew policy of %s seconds', clockSkewSeconds => {
    expect(() => validateVisitorAuthIdentityClaims({ transaction, claims, nowSeconds }, { clockSkewSeconds })).toThrowError(expect.objectContaining({ code: 'invalid-input', message: 'clockSkewSeconds must be between 0 and 300' }));
  });

  it.each([
    { name: 'a blank audience entry', change: { claims: { ...claims, audience: ['client-1', ' '] } }, reason: 'malformed-claims' },
    { name: 'a non-finite clock', change: { nowSeconds: Number.NaN }, reason: 'malformed-claims' },
    { name: 'a transaction with no expected issuer', change: { transaction: withoutIssuer }, reason: 'issuer-mismatch' },
    { name: 'a transaction with no nonce (plain OAuth2)', change: { transaction: withoutNonce }, reason: 'nonce-mismatch' },
  ])('rejects $name', ({ change, reason }) => {
    expect(validateVisitorAuthIdentityClaims({ transaction, claims, nowSeconds, ...change } as Parameters<typeof validateVisitorAuthIdentityClaims>[0])).toEqual({ decision: 'reject', reason });
  });

  it('accepts claims without email details and reports only the subject', () => {
    expect(validateVisitorAuthIdentityClaims({ transaction, claims, nowSeconds })).toEqual({ decision: 'accept', identity: { providerId: 'google', subject: 'user-1' } });
  });

  it('keeps an explicit emailVerified=false rather than dropping it', () => {
    expect(validateVisitorAuthIdentityClaims({ transaction, claims: { ...claims, email: 'v@example.test', emailVerified: false }, nowSeconds })).toEqual({ decision: 'accept', identity: { providerId: 'google', subject: 'user-1', email: 'v@example.test', emailVerified: false } });
  });
});

it('plans plain OAuth2 (no nonce) for a non-OIDC provider', () => {
  const { transaction, authorizationUrl } = planWith({ provider: FACEBOOK_VISITOR_AUTH_PROVIDER, server: { ...serverWithoutIssuer, providerId: 'facebook' }, registration: { ...registration, providerId: 'facebook' } });
  expect(transaction).not.toHaveProperty('nonce');
  expect(new URL(authorizationUrl).searchParams.has('nonce')).toBe(false);
});
