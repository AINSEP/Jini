/** Explicit-trust OIDC validation of an already received token set, with mandatory JWKS signature checks. */
import type { Clock } from '@jini-ai/core/primitives';
import {
    allowInsecureRequests, clockSkew, clockTolerance, customFetch, expectNoNonce,
    getValidatedIdTokenClaims, processAuthorizationCodeResponse, validateApplicationLevelSignature,
    type AuthorizationServer, type Client,
} from 'oauth4webapi';
import type { OAuthOptionalArgs, OAuthRequiredArgs } from './args.js';
import { MAX_OAUTH_RESPONSE_BYTES } from './bounded-json.js';
import { assertSafeProviderEndpoint } from './endpoint-safety.js';
import { OAuthError } from './errors.js';
import { createOAuthCustomFetch } from './guarded-transport.js';
import type { OAuthHttpPorts, OAuthTokenSet, OidcIdTokenClaims, OidcSigningAlgorithm, OidcTrustConfiguration } from './ports.js';
import { DEFAULT_TOKEN_REQUEST_TIMEOUT_MS } from './token-endpoint.js';

export interface ValidateOidcIdTokenInput extends OidcTrustConfiguration {
    readonly tokens: OAuthTokenSet;
    readonly clock: Clock;
    /** Bind to the authorization attempt; null explicitly declares no nonce was sent. */
    readonly expectedNonce: string | null;
    /** Pin the configured provider algorithm, never select it from the token header. Defaults to RS256. */
    readonly signingAlgorithm?: OidcSigningAlgorithm;
    /** No time leeway by default. */
    readonly clockToleranceSeconds?: number;
    /** Check auth_time when max_age was sent in the authorization request. */
    readonly maxAgeSeconds?: number;
    readonly timeoutMs?: number;
}

/** Validates identity claims and the digital signature before returning any claims.
 * openid-client has no high-level processor for an already received token set. Its engine owns
 * claim/nonce validation and signature verification here; no grant is redeemed again. Token data
 * cannot choose an issuer or JWKS URI, and a jku/x5u header cannot cause an additional fetch.
 * @param requiredArgs - HTTP/clock ports, trusted issuer/JWKS/client identity, tokens and nonce expectation.
 * @param optionalArgs - Configured signing algorithm, time leeway, max authentication age and JWKS deadline.
 * @returns Claims only after both library validation stages succeed. Does not install an account.
 * @throws {OAuthError} For unsafe metadata, invalid configuration, invalid tokens or guarded JWKS failure.
 * @complexity O(n + b + k) time and space for the ID token, bounded JWKS and its k keys; one JWKS request.
 * @example const claims = await validateOidcIdToken({ fetchFn, guard, clock, issuer, jwksUri, clientId, tokens, expectedNonce })
 */
export async function validateOidcIdToken(
    requiredArgs: OAuthRequiredArgs<OAuthHttpPorts & ValidateOidcIdTokenInput>,
    optionalArgs: OAuthOptionalArgs<OAuthHttpPorts & ValidateOidcIdTokenInput> = {},
): Promise<OidcIdTokenClaims> {
    const { guard, fetchFn, clock, issuer, jwksUri, clientId, tokens, expectedNonce } = requiredArgs;
    const issuerUrl = assertSafeProviderEndpoint(issuer, 'trusted OIDC issuer', guard);
    const jwksUrl = assertSafeProviderEndpoint(jwksUri, 'JWKS endpoint', guard);
    const nowMs = clock.nowMs();
    const tolerance = optionalArgs.clockToleranceSeconds ?? 0;
    if (!clientId || !Number.isFinite(nowMs) || !Number.isFinite(tolerance) || tolerance < 0
        || (expectedNonce !== null && (typeof expectedNonce !== 'string' || expectedNonce === ''))
        || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash
        || jwksUrl.username || jwksUrl.password || jwksUrl.hash
        || (optionalArgs.maxAgeSeconds !== undefined
            && (!Number.isFinite(optionalArgs.maxAgeSeconds) || optionalArgs.maxAgeSeconds < 0))) {
        throw new OAuthError({
            code: 'OAUTH_INVALID_REQUEST', message: 'the OpenID Connect validation configuration is invalid',
            operatorAction: 'Supply trusted issuer/JWKS metadata, a client identity, clock and explicit nonce expectation.',
        });
    }
    const as: AuthorizationServer = { issuer, jwks_uri: jwksUrl.href };
    const client: Client = {
        client_id: clientId, id_token_signed_response_alg: optionalArgs.signingAlgorithm ?? 'RS256',
        // The library uses the system epoch plus a skew. Bridge the injected host clock into
        // that supported seam instead of making identity expiry depend on a hidden host clock.
        [clockSkew]: Math.floor(nowMs / 1000) - Math.floor(Date.now() / 1000),
        [clockTolerance]: tolerance,
    };
    const guardedFetch = createOAuthCustomFetch({
        guard, fetchFn, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
        endpointLabel: 'JWKS endpoint', responseMessages: {
            overflowMessage: `the JWKS response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: 'Check the configured issuer JWKS endpoint. Identity was not verified.',
        },
    });
    try {
        // Adapt the retained, bounded token fields to the engine's response processor without
        // inventing credentials or sending another token request. OAuth-only parsing intentionally
        // omitted id_token from its processor because it has no trusted issuer/JWKS inputs.
        const response = Response.json({ access_token: tokens.accessToken, token_type: tokens.tokenType,
            ...(tokens.idToken === undefined ? {} : { id_token: tokens.idToken }) });
        const processed = await processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: expectedNonce === null ? expectNoNonce : expectedNonce, requireIdToken: true,
            ...(optionalArgs.maxAgeSeconds === undefined ? {} : { maxAge: optionalArgs.maxAgeSeconds }),
        });
        // Claim processing alone relies on transport TLS. This public identity boundary promises
        // an application signature as well, so verification is mandatory before exposing claims.
        await validateApplicationLevelSignature(as, response, {
            [allowInsecureRequests]: jwksUrl.protocol === 'http:',
            [customFetch]: async (url, options) => {
                try { return await guardedFetch(url, options); }
                catch (error) {
                    if (error instanceof OAuthError) throw error;
                    throw new OAuthError({
                        code: 'OAUTH_PROVIDER_UNREACHABLE', message: 'could not reach the trusted issuer JWKS endpoint',
                        operatorAction: 'Check network access to this issuer. Identity was not verified.',
                    });
                }
            },
        });
        const claims = getValidatedIdTokenClaims(processed);
        if (claims !== undefined) return claims;
        // requireIdToken above guarantees claims; keep the boundary closed if the upstream contract changes.
        throw new Error('ID token claims unavailable');
    } catch (error) {
        if (error instanceof OAuthError) throw error;
        // Upstream claim/signature errors retain JWTs, claims or responses in their causes.
        // Expose only stable facade text, never the untrusted token or upstream error object.
        throw new OAuthError({
            code: 'OAUTH_MALFORMED_RESPONSE', message: 'the OpenID Connect ID token could not be validated',
            operatorAction: 'Restart authorization with the trusted issuer and check its client, nonce and signing configuration.',
        });
    }
}
