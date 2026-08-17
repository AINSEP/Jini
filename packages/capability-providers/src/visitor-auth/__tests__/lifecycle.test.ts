import { describe, expect, it } from 'vitest';

import {
  evaluateVisitorAuthCallback,
  FACEBOOK_VISITOR_AUTH_PROVIDER,
  GOOGLE_VISITOR_AUTH_PROVIDER,
  planVisitorAuthAuthorization,
  validateVisitorAuthIdentityClaims,
  VisitorAuthConfigurationError,
  type VisitorAuthAuthorizationPlan,
  type VisitorAuthAuthorizationServer,
  type VisitorAuthCallbackParameters,
  type VisitorAuthProviderDefinition,
  type VisitorAuthTransaction,
  type VisitorAuthVerifiedIdTokenClaims,
} from '../index.js';

const google = GOOGLE_VISITOR_AUTH_PROVIDER;
const facebook = FACEBOOK_VISITOR_AUTH_PROVIDER;
const nowMs = 1_800_000_000_000;

const googleServer: VisitorAuthAuthorizationServer = {
  providerId: 'google',
  authorizationEndpoint: 'https://accounts.example.test/authorize',
  tokenEndpoint: 'https://accounts.example.test/token',
  issuer: 'https://accounts.example.test',
  supportsPkceS256: true,
  requiresAuthorizationResponseIssuer: true,
};
const expectedIssuer = 'https://accounts.example.test';

function plan(
  provider: VisitorAuthProviderDefinition = google,
  server: VisitorAuthAuthorizationServer = googleServer,
): VisitorAuthAuthorizationPlan {
  return planVisitorAuthAuthorization(
    {
      provider,
      server,
      registration: {
        tenantId: 'tenant-1',
        providerId: provider.id,
        clientId: 'client-1',
        clientSecretRef: { id: 'sealed:tenant-1/google/client-secret' },
      },
      redirectUri: 'https://app.example.test/auth/callback',
      flowBinding: 'browser-session-1',
      security: {
        state: 's'.repeat(32),
        nonce: 'n'.repeat(32),
        codeVerifier: 'v'.repeat(43),
        codeChallenge: 'c'.repeat(43),
      },
      nowMs,
    },
    { extraParameters: { prompt: 'select_account' } },
  );
}

describe('planVisitorAuthAuthorization', () => {
  it('plans OIDC authorization with state, nonce, and PKCE S256', () => {
    const result = plan();
    const url = new URL(result.authorizationUrl);

    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example.test/auth/callback',
      scope: 'openid profile email',
      state: 's'.repeat(32),
      nonce: 'n'.repeat(32),
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(result.transaction).toMatchObject({
      tenantId: 'tenant-1',
      providerId: 'google',
      flowBinding: 'browser-session-1',
      clientSecretRef: { id: 'sealed:tenant-1/google/client-secret' },
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 10 * 60 * 1000,
    });
    expect(result.transaction).not.toHaveProperty('clientSecret');
  });

  it('does not add an OIDC nonce for OAuth-only providers', () => {
    const result = plan(facebook, {
      providerId: 'facebook',
      authorizationEndpoint: googleServer.authorizationEndpoint,
      tokenEndpoint: googleServer.tokenEndpoint,
      supportsPkceS256: true,
      requiresAuthorizationResponseIssuer: false,
    });
    expect(new URL(result.authorizationUrl).searchParams.has('nonce')).toBe(false);
    expect(result.transaction.nonce).toBeUndefined();
  });

  it.each([
    ['state', 'attacker-state'],
    ['redirect_uri', 'https://attacker.example/callback'],
    ['code_challenge_method', 'plain'],
  ])('rejects an extra parameter that overrides %s', (key, value) => {
    expect(() =>
      planVisitorAuthAuthorization(
        {
          provider: google,
          server: googleServer,
          registration: { tenantId: 'tenant-1', providerId: 'google', clientId: 'client-1' },
          redirectUri: 'https://app.example.test/auth/callback',
          flowBinding: 'browser-session-1',
          security: {
            state: 's'.repeat(32),
            nonce: 'n'.repeat(32),
            codeVerifier: 'v'.repeat(43),
            codeChallenge: 'c'.repeat(43),
          },
          nowMs,
        },
        { extraParameters: { [key]: value } },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<VisitorAuthConfigurationError>>({
        code: 'reserved-parameter',
      }),
    );
  });

  it.each([
    ['weak state', { state: 'short' }],
    ['weak verifier', { codeVerifier: 'v'.repeat(42) }],
    ['weak nonce', { nonce: 'short' }],
  ])('fails closed for %s', (_label, securityOverride) => {
    expect(() =>
      planVisitorAuthAuthorization({
        provider: google,
        server: googleServer,
        registration: { tenantId: 'tenant-1', providerId: 'google', clientId: 'client-1' },
        redirectUri: 'https://app.example.test/auth/callback',
        flowBinding: 'browser-session-1',
        security: {
          state: 's'.repeat(32),
          nonce: 'n'.repeat(32),
          codeVerifier: 'v'.repeat(43),
          codeChallenge: 'c'.repeat(43),
          ...securityOverride,
        },
        nowMs,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VisitorAuthConfigurationError>>({ code: 'invalid-input' }),
    );
  });

  it('rejects insecure endpoints and non-loopback HTTP redirect URIs', () => {
    expect(() => plan(google, { ...googleServer, tokenEndpoint: 'http://token.example.test' })).toThrowError(
      expect.objectContaining<Partial<VisitorAuthConfigurationError>>({ code: 'insecure-url' }),
    );

    expect(() =>
      planVisitorAuthAuthorization({
        provider: google,
        server: googleServer,
        registration: { tenantId: 'tenant-1', providerId: 'google', clientId: 'client-1' },
        redirectUri: 'http://app.example.test/auth/callback',
        flowBinding: 'browser-session-1',
        security: {
          state: 's'.repeat(32),
          nonce: 'n'.repeat(32),
          codeVerifier: 'v'.repeat(43),
          codeChallenge: 'c'.repeat(43),
        },
        nowMs,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VisitorAuthConfigurationError>>({ code: 'insecure-url' }),
    );
  });

  it('requires a trusted issuer when response-issuer validation is enabled', () => {
    expect(() =>
      plan(facebook, {
        providerId: 'facebook',
        authorizationEndpoint: googleServer.authorizationEndpoint,
        tokenEndpoint: googleServer.tokenEndpoint,
        supportsPkceS256: true,
        requiresAuthorizationResponseIssuer: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VisitorAuthConfigurationError>>({ code: 'invalid-input' }),
    );
  });
});

describe('evaluateVisitorAuthCallback', () => {
  const transaction = plan().transaction;

  function evaluate(
    callback: VisitorAuthCallbackParameters,
    transactionOverride: Partial<VisitorAuthTransaction> = {},
    contextOverride: Partial<{ tenantId: string; flowBinding: string; nowMs: number }> = {},
  ) {
    return evaluateVisitorAuthCallback({
      transaction: { ...transaction, ...transactionOverride },
      callback,
      tenantId: 'tenant-1',
      flowBinding: 'browser-session-1',
      nowMs: nowMs + 1,
      ...contextOverride,
    });
  }

  it('produces a secret-reference-only exchange request after every binding succeeds', () => {
    const result = evaluate({
      state: transaction.state,
      code: 'authorization-code',
      issuer: expectedIssuer,
    });
    expect(result).toEqual({
      decision: 'exchange',
      request: {
        tenantId: 'tenant-1',
        providerId: 'google',
        clientId: 'client-1',
        clientSecretRef: { id: 'sealed:tenant-1/google/client-secret' },
        tokenEndpoint: 'https://accounts.example.test/token',
        authorizationCode: 'authorization-code',
        codeVerifier: 'v'.repeat(43),
        redirectUri: 'https://app.example.test/auth/callback',
      },
    });
    expect(result).not.toHaveProperty('request.clientSecret');
  });

  it.each([
    ['tenant-mismatch', { state: transaction.state, code: 'code', issuer: expectedIssuer }, {}, { tenantId: 'tenant-2' }],
    ['flow-binding-mismatch', { state: transaction.state, code: 'code', issuer: expectedIssuer }, {}, { flowBinding: 'other-browser' }],
    ['expired', { state: transaction.state, code: 'code', issuer: expectedIssuer }, {}, { nowMs: transaction.expiresAtMs }],
    ['state-mismatch', { state: 'wrong', code: 'code', error: 'denied' }, {}, {}],
    ['issuer-mismatch', { state: transaction.state, code: 'code', issuer: 'https://attacker.example' }, {}, {}],
    ['provider-error', { state: transaction.state, error: 'access_denied', errorDescription: 'secret detail', issuer: expectedIssuer }, {}, {}],
    ['missing-code', { state: transaction.state, issuer: expectedIssuer }, {}, {}],
  ] as const)('rejects terminal callback path %s', (reason, callback, txOverride, contextOverride) => {
    const result = evaluate(callback, txOverride, contextOverride);
    expect(result).toMatchObject({ decision: 'reject', reason });
    expect(JSON.stringify(result)).not.toContain('secret detail');
  });

  it('does not propagate malformed provider error input', () => {
    expect(
      evaluate({
        state: transaction.state,
        issuer: expectedIssuer,
        error: '<script>alert(1)</script>',
      }),
    ).toEqual({ decision: 'reject', reason: 'provider-error' });
  });
});

describe('validateVisitorAuthIdentityClaims', () => {
  const transaction = plan().transaction;
  const claims: VisitorAuthVerifiedIdTokenClaims = {
    issuer: expectedIssuer,
    subject: 'provider-user-1',
    audience: transaction.clientId,
    expiresAtSeconds: Math.floor(nowMs / 1000) + 300,
    nonce: 'n'.repeat(32),
    email: 'visitor@example.test',
    emailVerified: true,
  };

  it('accepts semantically valid claims returned by the cryptographic verifier port', () => {
    expect(
      validateVisitorAuthIdentityClaims({
        transaction,
        claims,
        nowSeconds: Math.floor(nowMs / 1000),
      }),
    ).toEqual({
      decision: 'accept',
      identity: {
        providerId: 'google',
        subject: 'provider-user-1',
        email: 'visitor@example.test',
        emailVerified: true,
      },
    });
  });

  it.each([
    ['issuer-mismatch', { issuer: 'https://attacker.example' }],
    ['audience-mismatch', { audience: 'other-client' }],
    ['authorized-party-mismatch', { audience: ['client-1', 'other-client'] }],
    ['expired', { expiresAtSeconds: Math.floor(nowMs / 1000) - 60 }],
    ['nonce-mismatch', { nonce: 'different-nonce' }],
    ['subject-missing', { subject: ' ' }],
    ['malformed-claims', { expiresAtSeconds: Number.NaN }],
    ['malformed-claims', { audience: [] }],
  ] as const)('rejects %s claims', (reason, override) => {
    expect(
      validateVisitorAuthIdentityClaims({
        transaction,
        claims: { ...claims, ...override },
        nowSeconds: Math.floor(nowMs / 1000),
      }),
    ).toEqual({ decision: 'reject', reason });
  });
});
