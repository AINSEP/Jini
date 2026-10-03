import { fixtureEntropy } from "./fixtures.js";
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { OAuthError, isOAuthError, mapProviderErrorCode, createPkcePair, deriveCodeChallenge, assertValidCodeVerifier, parseResourceMetadataUrl, parseWwwAuthenticateScopes, secureEqualsForOwnerBinding, isTokenDueForRefresh, buildOperatorOAuthProvider, assertValidOAuthProvider, createOAuthUrlGuard, assertSafeUserFacingUrl, } from '../src/index.js';
// Written after the owner suspended verification. Exercise the final public argument contract.
test('PKCE exports take an object containing the injected entropy or verifier', () => {
    const pair = createPkcePair({ randomBytesFn: fixtureEntropy });
    expect(deriveCodeChallenge({ codeVerifier: pair.codeVerifier })).toBe(pair.codeChallenge);
    expect(() => assertValidCodeVerifier({ codeVerifier: pair.codeVerifier })).not.toThrow();
});
test('challenge parsing exports take a header object', () => {
    const wwwAuthenticate = 'Bearer resource_metadata="https://api.example.com/meta", scope="read write"';
    expect(parseResourceMetadataUrl({ wwwAuthenticate })).toBe('https://api.example.com/meta');
    expect(parseWwwAuthenticateScopes({ wwwAuthenticate })).toEqual(['read', 'write']);
});
test('error construction and mapping use object arguments without changing typed errors', () => {
    const error = new OAuthError({
        code: 'OAUTH_INVALID_GRANT', message: 'refused', operatorAction: 'reconnect'
    });
    const input: {
        value: unknown;
    } = { value: error };
    expect(isOAuthError(input)).toBe(true);
    if (isOAuthError(input))
        expect(input.value.code).toBe('OAUTH_INVALID_GRANT');
    expect(mapProviderErrorCode({ providerErrorCode: 'authorization_pending' })).toBe('OAUTH_AUTHORIZATION_PENDING');
    expect(error.retryable).toBe(false);
});
test('binding and expiry helpers take named fields', () => {
    expect(secureEqualsForOwnerBinding({ a: 'owner', b: 'owner' })).toBe(true);
    expect(secureEqualsForOwnerBinding({ a: 'owner', b: 'other' })).toBe(false);
    expect(isTokenDueForRefresh({
        tokens: { accessToken: 'at', refreshToken: null, tokenType: 'Bearer', scopes: [], expiresAt: null },
        nowIso: '2030-01-01T00:00:00.000Z', skewMs: 120000,
    })).toBe(false);
});
test('provider and user-facing URL helpers take their guard in the argument object', () => {
    const guard = createOAuthUrlGuard({
        assertAllowed() { }
    });
    const descriptor = buildOperatorOAuthProvider({
        guard, providerId: 'example', label: 'Example', tokenEndpoint: 'https://auth.example.com/token'
    }, {
        authorizationEndpoint: 'https://auth.example.com/authorize'
    });
    expect(() => assertValidOAuthProvider({ descriptor, guard })).not.toThrow();
    expect(assertSafeUserFacingUrl({ raw: 'https://auth.example.com/device', guard }).hostname).toBe('auth.example.com');
});
