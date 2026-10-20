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
    readonly tokens: OAuthTokenSet; readonly clock: Clock;
    readonly expectedNonce: string | null;
    readonly signingAlgorithm?: OidcSigningAlgorithm;
    readonly clockToleranceSeconds?: number; readonly maxAgeSeconds?: number;
    readonly timeoutMs?: number;
}

/** Trusted metadata chooses issuer/JWKS, never the token or its jku/x5u header.
 * Pin the algorithm (default RS256) with zero default leeway; null nonce means none was sent.
 * Check max_age when supplied and validate claims AND the signature before returning identity.
 */
export async function validateOidcIdToken(requiredArgs: OAuthRequiredArgs<OAuthHttpPorts & ValidateOidcIdTokenInput>,
    optionalArgs: OAuthOptionalArgs<OAuthHttpPorts & ValidateOidcIdTokenInput> = {}): Promise<OidcIdTokenClaims> {
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
            && (!Number.isFinite(optionalArgs.maxAgeSeconds) || optionalArgs.maxAgeSeconds < 0)))
        throw new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message: 'the OpenID Connect validation configuration is invalid',
            operatorAction: 'Supply trusted issuer/JWKS metadata, a client identity, clock and explicit nonce expectation.' });
    const as: AuthorizationServer = { issuer, jwks_uri: jwksUrl.href };
    const client: Client = {
        client_id: clientId, id_token_signed_response_alg: optionalArgs.signingAlgorithm ?? 'RS256',
        // Bridge the injected clock through upstream's system-epoch skew seam.
        [clockSkew]: Math.floor(nowMs / 1000) - Math.floor(Date.now() / 1000),
        [clockTolerance]: tolerance,
    };
    const guardedFetch = createOAuthCustomFetch({
        guard, fetchFn, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
        endpointLabel: 'JWKS endpoint', responseMessages: {
            overflowMessage: `the JWKS response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: 'Check the configured issuer JWKS endpoint. Identity was not verified.',
        },
    }, { unreachable: { preserveCause: false,
        message: 'could not reach the trusted issuer JWKS endpoint',
        operatorAction: 'Check network access to this issuer. Identity was not verified.' } });
    try {
        // Adapt already received tokens; never redeem the grant again to validate identity.
        const response = Response.json({ access_token: tokens.accessToken, token_type: tokens.tokenType,
            ...(tokens.idToken === undefined ? {} : { id_token: tokens.idToken }) });
        const processed = await processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: expectedNonce === null ? expectNoNonce : expectedNonce, requireIdToken: true,
            ...(optionalArgs.maxAgeSeconds === undefined ? {} : { maxAge: optionalArgs.maxAgeSeconds }),
        });
        // Claim processing alone relies on TLS; our identity boundary also requires a signature.
        await validateApplicationLevelSignature(as, response, {
            [allowInsecureRequests]: jwksUrl.protocol === 'http:', [customFetch]: guardedFetch,
        });
        // requireIdToken guarantees claims; fail closed if that upstream contract changes.
        const claims = getValidatedIdTokenClaims(processed);
        if (!claims) throw new Error('ID token claims unavailable');
        return claims;
    } catch {
        if (guardedFetch.failure) throw guardedFetch.failure.error;
        // Upstream causes retain JWTs/claims/responses. Expose only secret-free facade text.
        throw new OAuthError({ code: 'OAUTH_MALFORMED_RESPONSE', message: 'the OpenID Connect ID token could not be validated',
            operatorAction: 'Restart authorization with the trusted issuer and check its client, nonce and signing configuration.' });
    }
}
