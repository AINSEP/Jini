import { nowIso, type Clock } from '@jini-ai/core/primitives';
import {
    ClientSecretBasic, ClientSecretPost, Configuration, None, ResponseBodyError,
    allowInsecureRequests, customFetch, genericGrantRequest, refreshTokenGrant,
} from 'openid-client';
import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
import { MAX_OAUTH_RESPONSE_BYTES } from './bounded-json.js';
import { assertSafeProviderEndpoint } from './endpoint-safety.js';
import { adaptOAuthResponse, mapProviderErrorCode, OAuthError } from './errors.js';
import { createOAuthCustomFetch } from './guarded-transport.js';
import type { OAuthClient, OAuthTokenSet, OAuthHttpPorts, OAuthResource } from './ports.js';
import { applyResourceIndicators } from './resource.js';

export const DEFAULT_TOKEN_REQUEST_TIMEOUT_MS = 15000;
export interface TokenRequestDeps extends OAuthHttpPorts { readonly clock: Clock }
export interface TokenRequestInput {
    readonly tokenEndpoint: string;
    readonly client: OAuthClient;
    readonly params: Readonly<Record<string, string>>;
    readonly resource?: OAuthResource;
    readonly timeoutMs?: number;
}

/** Shared configuration for endpoint-only operations. The opaque issuer is transport metadata,
 * never a trusted identity guessed from a token URL. Only explicit OIDC validation asserts identity.
 */
export function createOAuthClientConfiguration({ client, endpoint, endpointName }: {
    readonly client: OAuthClient; readonly endpoint: URL;
    readonly endpointName: 'token_endpoint' | 'device_authorization_endpoint' | 'authorization_endpoint' | 'revocation_endpoint';
}, _optionalArgs: OAuthEmptyArgs = {}): Configuration {
    const auth = client.authMethod === 'none' ? None()
        : client.authMethod === 'client_secret_basic' ? ClientSecretBasic(client.clientSecret ?? '')
        : ClientSecretPost(client.clientSecret ?? '');
    const config = new Configuration({ issuer: 'urn:jini:oauth:transport-only', [endpointName]: endpoint.href },
        client.clientId, {}, auth);
    // The guarded adapter owns the millisecond deadline through the complete body read.
    config.timeout = undefined;
    // HTTP is permitted only after the host's explicit loopback policy approves it.
    if (endpoint.protocol === 'http:') allowInsecureRequests(config);
    return config;
}

/** One grant request; upstream owns authentication, token validation and OAuth error decoding. */
export async function requestOAuthToken(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & TokenRequestInput>,
    optionalArgs: OAuthOptionalArgs<TokenRequestDeps & TokenRequestInput> = {}): Promise<OAuthTokenSet> {
    const { tokenEndpoint, client, clock } = requiredArgs;
    const endpoint = assertSafeProviderEndpoint(tokenEndpoint, 'token endpoint', requiredArgs.guard);
    const params = new URLSearchParams(requiredArgs.params);
    applyResourceIndicators(params, optionalArgs.resource);
    const guardedFetch = createOAuthCustomFetch({
        ...requiredArgs, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
        endpointLabel: 'token endpoint', responseMessages: {
            overflowMessage: `the authorization server's response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: "This provider's token endpoint is not behaving like an OAuth 2.0 endpoint.",
        },
    }, { unreachable: {
        message: `could not reach the authorization server at ${endpoint.host}`,
        operatorAction: 'Check network access to this provider, then try connecting again. Nothing was retried automatically.' } });
    let idToken: string | undefined;
    let tokenType: string | undefined;
    try {
        const config = createOAuthClientConfiguration({ client, endpoint, endpointName: 'token_endpoint' });
        // OAuth-only callers lack issuer/JWKS trust inputs. Keep identity data opaque until
        // explicit validation, and preserve provider token-type casing after upstream validation.
        config[customFetch] = async (url, options) => adaptOAuthResponse({ response: await guardedFetch(url, options) }, {
            project(body) {
                idToken = typeof body.id_token === 'string' && body.id_token !== '' ? body.id_token : undefined;
                tokenType = typeof body.token_type === 'string' ? body.token_type : undefined;
                delete body.id_token;
            },
        });
        const grantType = params.get('grant_type') ?? '';
        params.delete('grant_type');
        const tokens = grantType === 'refresh_token'
            ? await refreshTokenGrant(config, params.get('refresh_token') ?? '', params)
            : await genericGrantRequest(config, grantType, params);
        return {
            accessToken: tokens.access_token, ...(idToken === undefined ? {} : { idToken }),
            refreshToken: tokens.refresh_token ?? null, tokenType: tokenType ?? tokens.token_type,
            scopes: tokens.scope?.split(/[\s,]+/).filter(Boolean) ?? [],
            expiresAt: tokens.expires_in === undefined || tokens.expires_in <= 0 ? null
                : new Date(Date.parse(nowIso({ clock })) + tokens.expires_in * 1000).toISOString(),
        };
    } catch (error) {
        if (guardedFetch.failure) throw guardedFetch.failure.error;
        const status = guardedFetch.status ?? 200;
        if (error instanceof ResponseBodyError) {
            const code = mapProviderErrorCode({ providerErrorCode: error.error });
            const interval = error.cause.interval;
            throw new OAuthError({
                code, message: `the authorization server refused the request (HTTP ${status}, ${error.error})`,
                operatorAction: code === 'OAUTH_INVALID_GRANT'
                    ? "This connection's authorization is no longer valid — reconnect it in the connection settings."
                    : "Check this provider's client id, secret, scopes and redirect URI, then try connecting again.",
            }, { providerErrorCode: error.error,
                ...(typeof interval === 'number' && Number.isFinite(interval) ? { retryAfterSeconds: interval } : {}) });
        }
        const invalidInput = error instanceof TypeError;
        const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
        const malformedMessage = reason instanceof SyntaxError ? 'the authorization server did not return a JSON object'
            : reason instanceof Error && reason.message.includes('"access_token"') ? "the authorization server's response contained no access token"
            : "the authorization server's response did not contain a supported OAuth token set";
        // Never expose upstream causes: they can retain credentials, JWTs or response bodies.
        throw new OAuthError({
            code: invalidInput ? 'OAUTH_INVALID_REQUEST' : status >= 200 && status < 300 ? 'OAUTH_MALFORMED_RESPONSE' : 'OAUTH_PROVIDER_REJECTED',
            message: invalidInput ? 'the OAuth grant or client configuration is invalid'
                : status >= 200 && status < 300 ? malformedMessage
                : `the authorization server refused the request (HTTP ${status})`,
            operatorAction: invalidInput ? "Check this provider's client id, secret and grant parameters."
                : status >= 200 && status < 300 ? 'Check that the token endpoint URL points at an OAuth 2.0 token endpoint.'
                : "Check this provider's client id, secret, scopes and redirect URI, then try connecting again.",
        });
    }
}
