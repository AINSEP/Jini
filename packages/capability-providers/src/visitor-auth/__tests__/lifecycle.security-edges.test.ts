import { describe, expect, it } from 'vitest';

import {
  evaluateVisitorAuthCallback,
  FACEBOOK_VISITOR_AUTH_PROVIDER,
  GOOGLE_VISITOR_AUTH_PROVIDER,
  planVisitorAuthAuthorization,
  validateVisitorAuthIdentityClaims,
  type VisitorAuthAuthorizationServer,
  type VisitorAuthVerifiedIdTokenClaims,
} from '../index.js';

/**
 * Security edges of `lifecycle.ts` that the main suites only cover on one side: the
 * loopback-HTTP exception (`isSecureProtocol`), URL credential/fragment refusal, reserved
 * parameters preconfigured on the endpoint, provider-error sanitisation boundaries, and
 * the clock-skew / multi-audience claim checks at their exact limits.
 */

const nowMs = 1_800_000_000_000;
const nowSeconds = Math.floor(nowMs / 1000);
const ISSUER = 'https://accounts.example.test';
const server: VisitorAuthAuthorizationServer = {
  providerId: 'google',
  authorizationEndpoint: 'https://accounts.example.test/authorize',
  tokenEndpoint: 'https://accounts.example.test/token',
  issuer: ISSUER,
  supportsPkceS256: true,
  requiresAuthorizationResponseIssuer: true,
};
const security = {
  state: 's'.repeat(32),
  nonce: 'n'.repeat(32),
  codeVerifier: 'v'.repeat(43),
  codeChallenge: 'c'.repeat(43),
};

function planWith(override: { redirectUri?: string; server?: Partial<VisitorAuthAuthorizationServer> } = {}) {
  return planVisitorAuthAuthorization({
    provider: GOOGLE_VISITOR_AUTH_PROVIDER,
    server: { ...server, ...override.server },
    registration: { tenantId: 'tenant-1', providerId: 'google', clientId: 'client-1' },
    redirectUri: override.redirectUri ?? 'https://app.example.test/cb',
    flowBinding: 'browser-1',
    security,
    nowMs,
  });
}

const insecure = expect.objectContaining({ name: 'VisitorAuthConfigurationError', code: 'insecure-url' });

describe('isSecureProtocol loopback-HTTP exception', () => {
  it.each(['http://localhost:5173/cb', 'http://127.0.0.1:8080/cb', 'http://[::1]:3000/cb'])(
    'redirectUri %s (loopback http) is allowed',
    (redirectUri) => {
      expect(planWith({ redirectUri }).transaction.redirectUri).toBe(new URL(redirectUri).toString());
    },
  );

  it.each([
    'http://evil.example/cb',
    'http://localhost.evil.example/cb',
    'http://127.0.0.2/cb',
    'http://10.0.0.1/cb',
    'ftp://localhost/cb',
    'ws://localhost/cb',
  ])('redirectUri %s is refused as insecure-url', (redirectUri) => {
    expect(() => planWith({ redirectUri })).toThrowError(insecure);
  });

  it.each([
    ['tokenEndpoint', 'http://localhost/token'],
    ['tokenEndpoint', 'http://127.0.0.1/token'],
    ['authorizationEndpoint', 'http://localhost/authorize'],
    ['authorizationEndpoint', 'http://[::1]/authorize'],
  ] as const)('%s %s is refused: the loopback exception is redirect-only', (field, value) => {
    expect(() => planWith({ server: { [field]: value } })).toThrowError(insecure);
  });

  it('https on any host is accepted for every URL', () => {
    const result = planWith({ redirectUri: 'https://evil-but-https.example/cb' });
    expect(result.transaction.tokenEndpoint).toBe('https://accounts.example.test/token');
    expect(new URL(result.authorizationUrl).origin).toBe('https://accounts.example.test');
  });
});

describe('parsedSecureUrl refuses credentials, fragments and non-URLs', () => {
  it.each([
    'https://user@app.example.test/cb',
    'https://:pw@app.example.test/cb',
    'https://user:pw@app.example.test/cb',
    'https://app.example.test/cb#frag',
    'http://user@localhost/cb',
  ])('redirectUri %s → insecure-url', (redirectUri) => {
    expect(() => planWith({ redirectUri })).toThrowError(insecure);
  });

  it('a relative redirectUri → invalid-input naming the field', () => {
    expect(() => planWith({ redirectUri: '/cb' })).toThrowError(
      expect.objectContaining({ code: 'invalid-input', message: 'redirectUri must be an absolute URL' }),
    );
  });

  it('a tokenEndpoint with a fragment → insecure-url naming tokenEndpoint', () => {
    expect(() => planWith({ server: { tokenEndpoint: 'https://accounts.example.test/token#x' } })).toThrowError(
      expect.objectContaining({ code: 'insecure-url', message: expect.stringContaining('tokenEndpoint') }),
    );
  });
});

describe('reserved parameters preconfigured on authorizationEndpoint', () => {
  it.each(['client_id', 'code_challenge', 'code_challenge_method', 'nonce', 'redirect_uri', 'response_type', 'scope', 'state'])(
    'authorizationEndpoint?%s=x is refused as reserved-parameter',
    (key) => {
      expect(() => planWith({ server: { authorizationEndpoint: `https://accounts.example.test/authorize?${key}=x` } })).toThrowError(
        expect.objectContaining({ code: 'reserved-parameter', message: expect.stringContaining(`"${key}"`) }),
      );
    },
  );

  it('a non-reserved preconfigured parameter is kept alongside the protocol parameters', () => {
    const url = new URL(planWith({ server: { authorizationEndpoint: 'https://accounts.example.test/authorize?hd=example.test' } }).authorizationUrl);
    expect(url.searchParams.get('hd')).toBe('example.test');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('evaluateVisitorAuthCallback provider-error sanitisation boundaries', () => {
  const transaction = planWith().transaction;
  const evaluate = (error: string) =>
    evaluateVisitorAuthCallback({
      transaction,
      callback: { state: transaction.state, issuer: ISSUER, error },
      tenantId: 'tenant-1',
      flowBinding: 'browser-1',
      nowMs: nowMs + 1,
    });

  it.each(['a', 'access_denied', 'x'.repeat(64), 'A-Z.0_9'])('safe code %j is propagated verbatim', (error) => {
    expect(evaluate(error)).toEqual({ decision: 'reject', reason: 'provider-error', providerError: error });
  });

  it.each(['x'.repeat(65), 'a/b', 'access_denied\n', ' access_denied', 'access denied', 'é'])(
    'unsafe code %j is dropped (no providerError key)',
    (error) => {
      expect(evaluate(error)).toEqual({ decision: 'reject', reason: 'provider-error' });
    },
  );

  it('expires exactly at expiresAtMs but not one ms before', () => {
    const at = (t: number) =>
      evaluateVisitorAuthCallback({
        transaction,
        callback: { state: transaction.state, issuer: ISSUER, code: 'c' },
        tenantId: 'tenant-1',
        flowBinding: 'browser-1',
        nowMs: t,
      }).decision;
    expect(at(transaction.expiresAtMs - 1)).toBe('exchange');
    expect(evaluateVisitorAuthCallback({
      transaction,
      callback: { state: transaction.state, issuer: ISSUER, code: 'c' },
      tenantId: 'tenant-1',
      flowBinding: 'browser-1',
      nowMs: transaction.expiresAtMs,
    })).toEqual({ decision: 'reject', reason: 'expired' });
  });

  it('a callback with no state is a state-mismatch even when the transaction state is present', () => {
    expect(
      evaluateVisitorAuthCallback({
        transaction,
        callback: { issuer: ISSUER, code: 'c' },
        tenantId: 'tenant-1',
        flowBinding: 'browser-1',
        nowMs: nowMs + 1,
      }),
    ).toEqual({ decision: 'reject', reason: 'state-mismatch' });
  });

  it('when the server does not require the response issuer, a missing issuer is accepted but a wrong one is not', () => {
    const tx = planVisitorAuthAuthorization({
      provider: FACEBOOK_VISITOR_AUTH_PROVIDER,
      server: { ...server, providerId: 'facebook', requiresAuthorizationResponseIssuer: false },
      registration: { tenantId: 'tenant-1', providerId: 'facebook', clientId: 'client-1' },
      redirectUri: 'https://app.example.test/cb',
      flowBinding: 'browser-1',
      security,
      nowMs,
    }).transaction;
    const run = (issuer?: string) =>
      evaluateVisitorAuthCallback({
        transaction: tx,
        callback: { state: tx.state, code: 'c', ...(issuer ? { issuer } : {}) },
        tenantId: 'tenant-1',
        flowBinding: 'browser-1',
        nowMs: nowMs + 1,
      });
    expect(run().decision).toBe('exchange');
    expect(run('https://attacker.example')).toEqual({ decision: 'reject', reason: 'issuer-mismatch' });
  });
});

describe('validateVisitorAuthIdentityClaims limits', () => {
  const transaction = planWith().transaction;
  const claims: VisitorAuthVerifiedIdTokenClaims = {
    issuer: ISSUER,
    subject: 'sub-1',
    audience: 'client-1',
    expiresAtSeconds: nowSeconds + 300,
    nonce: security.nonce,
  };
  const validate = (override: Partial<VisitorAuthVerifiedIdTokenClaims>, clockSkewSeconds?: number) =>
    validateVisitorAuthIdentityClaims(
      { transaction, claims: { ...claims, ...override }, nowSeconds },
      clockSkewSeconds === undefined ? {} : { clockSkewSeconds },
    );

  it.each([0, 300])('clock skew of exactly %i seconds is a valid policy', (skew) => {
    expect(validate({}, skew).decision).toBe('accept');
  });

  it.each([-0.001, 300.001])('clock skew of %d seconds is refused with invalid-input', (skew) => {
    expect(() => validate({}, skew)).toThrowError(
      expect.objectContaining({ code: 'invalid-input', message: 'clockSkewSeconds must be between 0 and 300' }),
    );
  });

  it('expiry is tolerated within the skew in the past direction only (default 60 s)', () => {
    expect(validate({ expiresAtSeconds: nowSeconds - 59 }).decision).toBe('accept');
    expect(validate({ expiresAtSeconds: nowSeconds - 60 })).toEqual({ decision: 'reject', reason: 'expired' });
    expect(validate({ expiresAtSeconds: nowSeconds - 61 })).toEqual({ decision: 'reject', reason: 'expired' });
  });

  it('with zero skew a token expiring exactly now is expired and one second later is accepted', () => {
    expect(validate({ expiresAtSeconds: nowSeconds }, 0)).toEqual({ decision: 'reject', reason: 'expired' });
    expect(validate({ expiresAtSeconds: nowSeconds + 1 }, 0).decision).toBe('accept');
  });

  it('a non-finite nowSeconds is malformed-claims, not acceptance', () => {
    expect(
      validateVisitorAuthIdentityClaims({ transaction, claims, nowSeconds: Number.NaN }),
    ).toEqual({ decision: 'reject', reason: 'malformed-claims' });
  });

  it('multi-audience requires azp === clientId; single audience does not', () => {
    expect(validate({ audience: ['client-1', 'other'], authorizedParty: 'client-1' }).decision).toBe('accept');
    expect(validate({ audience: ['client-1', 'other'], authorizedParty: 'other' })).toEqual({
      decision: 'reject',
      reason: 'authorized-party-mismatch',
    });
    expect(validate({ audience: ['client-1'], authorizedParty: 'other' }).decision).toBe('accept');
    expect(validate({ audience: 'client-1', authorizedParty: 'other' }).decision).toBe('accept');
  });

  it('a blank audience entry is malformed even when clientId is also present', () => {
    expect(validate({ audience: ['client-1', ' '] })).toEqual({ decision: 'reject', reason: 'malformed-claims' });
    expect(validate({ audience: [' ', 'client-1'] })).toEqual({ decision: 'reject', reason: 'malformed-claims' });
  });

  it('a transaction without a nonce or expectedIssuer cannot accept claims', () => {
    const { nonce: _n, ...noNonce } = transaction;
    expect(
      validateVisitorAuthIdentityClaims({ transaction: noNonce, claims: (({ nonce: _x, ...rest }) => rest)(claims), nowSeconds }),
    ).toEqual({ decision: 'reject', reason: 'nonce-mismatch' });
    const { expectedIssuer: _i, ...noIssuer } = transaction;
    expect(validateVisitorAuthIdentityClaims({ transaction: noIssuer, claims, nowSeconds })).toEqual({
      decision: 'reject',
      reason: 'issuer-mismatch',
    });
  });
});
