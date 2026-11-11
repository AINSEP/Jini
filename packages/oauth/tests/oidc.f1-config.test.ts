/**
 * F1 fix wave (Stryker L1 §4 oidc.ts:86 — each operand of the configuration guard → false survived).
 * One valid configuration, then exactly one field broken per case; every case must be refused as
 * OAUTH_INVALID_REQUEST before any network traffic. The all-valid case gets past the guard (it
 * fails later, on the deliberately unsigned token, with a DIFFERENT code).
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateOidcIdToken } from '../src/index.js';
import { fixtureGuard } from './fixtures.js';
import { assertOAuthRejects, createFetchDouble, createTestClock } from './helpers.js';

const clock = createTestClock();
const valid = {
    issuer: 'https://issuer.example.com', jwksUri: 'https://issuer.example.com/jwks', clientId: 'client-1',
    expectedNonce: 'n-1' as string | null,
    tokens: { accessToken: 'a', refreshToken: null, tokenType: 'Bearer', scopes: [], expiresAt: null, idToken: 'not.a.jwt' },
};

const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['empty clientId', { clientId: '' }, {}],
    ['NaN clock', { clock: { nowMs: () => Number.NaN } }, {}],
    ['infinite clock', { clock: { nowMs: () => Number.POSITIVE_INFINITY } }, {}],
    ['infinite tolerance', {}, { clockToleranceSeconds: Number.POSITIVE_INFINITY }],
    ['negative tolerance', {}, { clockToleranceSeconds: -1 }],
    ['empty-string nonce', { expectedNonce: '' }, {}],
    ['issuer with username', { issuer: 'https://u@issuer.example.com' }, {}],
    ['issuer with password', { issuer: 'https://:p@issuer.example.com' }, {}],
    ['issuer with query', { issuer: 'https://issuer.example.com/?x=1' }, {}],
    ['issuer with fragment', { issuer: 'https://issuer.example.com/#f' }, {}],
    ['jwks with username', { jwksUri: 'https://u@issuer.example.com/jwks' }, {}],
    ['jwks with password', { jwksUri: 'https://:p@issuer.example.com/jwks' }, {}],
    ['jwks with fragment', { jwksUri: 'https://issuer.example.com/jwks#f' }, {}],
    ['NaN maxAge', {}, { maxAgeSeconds: Number.NaN }],
    ['negative maxAge', {}, { maxAgeSeconds: -1 }],
];

for (const [label, required, optional] of cases) {
    test(`F1: OIDC config with ${label} → OAUTH_INVALID_REQUEST, no fetch`, async () => {
        const http = createFetchDouble([]);
        const error = await assertOAuthRejects(() => validateOidcIdToken({ guard: fixtureGuard, fetchFn: http.fetchFn, clock, ...valid, ...required } as never, optional as never), 'OAUTH_INVALID_REQUEST');
        assert.equal(error.message, 'the OpenID Connect validation configuration is invalid');
        assert.equal(http.callCount(), 0);
    });
}

test('F1: the all-valid configuration passes the guard (fails later as MALFORMED, not INVALID_REQUEST)', async () => {
    const http = createFetchDouble([]);
    await assertOAuthRejects(() => validateOidcIdToken({ guard: fixtureGuard, fetchFn: http.fetchFn, clock, ...valid }), 'OAUTH_MALFORMED_RESPONSE');
    await assertOAuthRejects(() => validateOidcIdToken({ guard: fixtureGuard, fetchFn: http.fetchFn, clock, ...valid, expectedNonce: null }, { clockToleranceSeconds: 0, maxAgeSeconds: 0 }), 'OAUTH_MALFORMED_RESPONSE');
});
