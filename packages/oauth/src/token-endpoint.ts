import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
import {
    ClientSecretBasic, ClientSecretPost, Configuration, None, allowInsecureRequests,
    customFetch, genericGrantRequest, refreshTokenGrant,
    type ClientAuth,
} from 'openid-client';
import { applyResourceIndicators } from "./resource.js";
import type { ISODateTime } from '@jini-ai/core/primitives';
import { MAX_OAUTH_RESPONSE_BYTES, parseOAuthJsonObject } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { mapProviderErrorCode, OAuthError } from "./errors.js";
import type { OAuthClient, OAuthTokenSet, OAuthHttpPorts, OAuthResource } from "./ports.js";
import { createOAuthCustomFetch } from './guarded-transport.js';
const TOKEN_RESPONSE_MESSAGES = {
    overflowMessage: `the authorization server's response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
    overflowOperatorAction: "This provider's token endpoint is not behaving like an OAuth 2.0 endpoint.",
    notJsonMessage: "the authorization server did not return a JSON object",
    notJsonOperatorAction: "Check that the token endpoint URL points at an OAuth 2.0 token endpoint.",
} as const;
export const DEFAULT_TOKEN_REQUEST_TIMEOUT_MS = 15000;
export interface TokenRequestDeps extends OAuthHttpPorts {
    readonly clock: Clock;
}
export interface TokenRequestInput {
    readonly tokenEndpoint: string;
    readonly client: OAuthClient;
    readonly params: Readonly<Record<string, string>>;
    readonly resource?: OAuthResource;
    readonly timeoutMs?: number;
}
/** Selects upstream authentication; the library owns credential validation and wire encoding.
 * @returns The configured library authentication method, without sending a request.
 * @throws {TypeError} For missing/empty confidential-client credentials (mapped by the caller).
 * @complexity O(1) time and space.
 */
function clientAuthentication({ client }: { readonly client: OAuthClient }, _optionalArgs: OAuthEmptyArgs = {}): ClientAuth {
    switch (client.authMethod) {
        case 'client_secret_basic': return ClientSecretBasic(client.clientSecret ?? '');
        case 'client_secret_post': return ClientSecretPost(client.clientSecret ?? '');
        case 'none': return None();
    }
}

/** Internal configuration owner shared by token, device, authorization-URL and revocation operations.
 * The opaque issuer is transport metadata, never an asserted provider identity. These OAuth-only
 * operations do not discover metadata or verify ID tokens using an issuer guessed from an endpoint.
 * Upstream confidential-client methods reject absent/empty secrets rather than sending no secret.
 * @returns A configuration without a library deadline; the guarded customFetch owns that deadline.
 * @throws {TypeError} For invalid client identity or missing confidential-client credentials.
 * @complexity O(n) time and space in the endpoint URL; performs no HTTP requests.
 */
export function createOAuthClientConfiguration({ client, endpoint, endpointName }: {
    readonly client: OAuthClient;
    readonly endpoint: URL;
    readonly endpointName: 'token_endpoint' | 'device_authorization_endpoint' | 'authorization_endpoint' | 'revocation_endpoint';
}, _optionalArgs: OAuthEmptyArgs = {}): Configuration {
    const config = new Configuration({
        issuer: 'urn:jini:oauth:transport-only', [endpointName]: endpoint.href,
    }, client.clientId, {}, clientAuthentication({ client }));
    // The guarded adapter owns our millisecond deadline, through the complete body read.
    config.timeout = undefined;
    // Plain HTTP is permitted only after the application's explicit loopback policy approved it.
    // The synchronous URL-only formatter has no HTTP effect and retains its existing HTTP support.
    if (endpoint.protocol === 'http:') allowInsecureRequests(config);
    return config;
}
interface RawTokenResponse extends Readonly<Record<string, unknown>> {
    access_token?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    error?: unknown;
    error_description?: unknown;
    interval?: unknown;
}
function toProviderError(body: RawTokenResponse, httpStatus: number): OAuthError {
    const providerErrorCode = typeof body.error === "string" ? body.error : undefined;
    const code = providerErrorCode ? mapProviderErrorCode({
        providerErrorCode: providerErrorCode
    }) : "OAUTH_PROVIDER_REJECTED";
    const retryAfterSeconds = typeof body.interval === "number" && Number.isFinite(body.interval) ? body.interval : undefined;
    return new OAuthError({
        code: code, message: `the authorization server refused the request (HTTP ${httpStatus}${providerErrorCode ? `, ${providerErrorCode}` : ""})`,
        operatorAction: code === "OAUTH_INVALID_GRANT"
            ? "This connection's authorization is no longer valid — reconnect it in the connection settings."
            : "Check this provider's client id, secret, scopes and redirect URI, then try connecting again."
    }, {
        ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    });
}
function resolveExpiresAt(expiresIn: unknown, nowIso: ISODateTime): ISODateTime | null {
    const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return null;
    return new Date(Date.parse(nowIso) + seconds * 1000).toISOString();
}
function parseScopes(scope: unknown): string[] {
    return typeof scope === "string" ? scope.split(/[\s,]+/).filter((part) => part.length > 0) : [];
}
function nonEmptyStringOrNull(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}
function nonEmptyStringOrDefault(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

/** Projects the existing OAuth-only normalization contract into the library's token processor.
 * Optional empty/non-string fields and unusable lifetimes have always meant "not supplied" here.
 * ID tokens stay outside this OAuth-only processor and are retained separately, unvalidated.
 * Only the explicit OIDC validator has trusted issuer/JWKS inputs; enabling OIDC verification
 * with an issuer guessed from a token URL is unsafe.
 * @returns Only the token fields this facade owns, ready for upstream protocol validation.
 * @complexity O(n) time and space in the bounded lifetime value's numeric coercion.
 */
function tokenResponseForLibrary({ body }: { readonly body: RawTokenResponse }, _optionalArgs: OAuthEmptyArgs = {}): Record<string, unknown> {
    const refreshToken = nonEmptyStringOrNull(body.refresh_token);
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
    return {
        access_token: body.access_token,
        token_type: nonEmptyStringOrDefault(body.token_type, 'Bearer'),
        ...(refreshToken === null ? {} : { refresh_token: refreshToken }),
        ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
        ...(Number.isFinite(seconds) && seconds > 0 ? { expires_in: seconds } : {}),
    };
}

/** Exchanges one grant through openid-client and the host's guarded HTTP transport.
 * @param requiredArgs - Explicit transport/clock ports, approved endpoint, client and grant fields.
 * @param optionalArgs - Resource binding and the request/body deadline.
 * @returns The source-compatible facade token set, using the injected clock for absolute expiry.
 * @throws {OAuthError} For unsafe endpoints, invalid inputs, provider failures or malformed tokens.
 * @complexity O(n) time and space in the form and bounded response; at most one HTTP request.
 * @example requestOAuthToken({ ...ports, tokenEndpoint, client, params: { grant_type: 'client_credentials' } })
 */
export async function requestOAuthToken(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & TokenRequestInput>, optionalArgs: OAuthOptionalArgs<TokenRequestDeps & TokenRequestInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, tokenEndpoint: requiredArgs.tokenEndpoint, client: requiredArgs.client, params: requiredArgs.params };
    const endpoint = assertSafeProviderEndpoint(input.tokenEndpoint, "token endpoint", deps.guard);
    const params = new URLSearchParams(input.params);
    applyResourceIndicators(params, input.resource);
    // openid-client wraps customFetch errors. Retain the original facade/transport failure,
    // including body-read failures, without attaching upstream errors containing response secrets.
    let adapterFailure: { readonly error: unknown } | undefined;
    let tokenType = 'Bearer';
    let idToken: string | null = null;
    try {
        // OAuth-only response projection excludes ID tokens; the shared configuration never
        // treats a token endpoint URL as a trusted issuer for identity verification.
        const config = createOAuthClientConfiguration({ client: input.client, endpoint, endpointName: 'token_endpoint' });
        const guardedFetch = createOAuthCustomFetch({
            guard: deps.guard, timeoutMs: input.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
            endpointLabel: 'token endpoint', responseMessages: TOKEN_RESPONSE_MESSAGES,
            fetchFn: async (args, options) => {
                try {
                    return await deps.fetchFn(args, options);
                } catch (cause) {
                    throw new OAuthError({
                        code: 'OAUTH_PROVIDER_UNREACHABLE', message: `could not reach the authorization server at ${endpoint.host}`,
                        operatorAction: 'Check network access to this provider, then try connecting again. Nothing was retried automatically.',
                    }, { cause });
                }
            },
        });
        // Upstream owns this positional ABI. Every request uses the same guarded transport,
        // including response bounds/redirect refusal before protocol processing can read JSON.
        config[customFetch] = async (url, options) => {
            try {
                const response = await guardedFetch(url, options);
                const body = parseOAuthJsonObject(await response.text(), TOKEN_RESPONSE_MESSAGES);
                // Providers also send OAuth errors with HTTP 200 or 5xx. Keep those terminal/
                // polling signals ahead of token processing; never echo error_description.
                if (typeof body.error === 'string' || !response.ok) throw toProviderError(body, response.status);
                if (typeof body.access_token !== 'string' || body.access_token === '') {
                    throw new OAuthError({
                        code: 'OAUTH_MALFORMED_RESPONSE', message: "the authorization server's response contained no access token",
                        operatorAction: 'Check that the token endpoint URL points at an OAuth 2.0 token endpoint.',
                    });
                }
                tokenType = nonEmptyStringOrDefault(body.token_type, 'Bearer');
                idToken = nonEmptyStringOrNull(body.id_token);
                return new Response(JSON.stringify(tokenResponseForLibrary({ body })), {
                    status: response.status, statusText: response.statusText, headers: response.headers,
                });
            } catch (error) {
                adapterFailure = { error };
                throw error;
            }
        };
        const grantType = params.get('grant_type') ?? '';
        params.delete('grant_type');
        const body = grantType === 'refresh_token'
            ? await refreshTokenGrant(config, params.get('refresh_token') ?? '', params)
            : await genericGrantRequest(config, grantType, params);
        return {
            accessToken: body.access_token,
            ...(idToken === null ? {} : { idToken }),
            refreshToken: nonEmptyStringOrNull(body.refresh_token),
            // Upstream lowercases token_type for validation; the facade preserves provider casing.
            tokenType,
            scopes: parseScopes(body.scope),
            expiresAt: resolveExpiresAt(body.expires_in, readNowIso({ clock: deps.clock })),
        };
    }
    catch (error) {
        if (adapterFailure) throw adapterFailure.error;
        const invalidInput = error instanceof TypeError;
        throw new OAuthError({
            code: invalidInput ? 'OAUTH_INVALID_REQUEST' : 'OAUTH_MALFORMED_RESPONSE',
            message: invalidInput ? 'the OAuth grant or client configuration is invalid'
                : "the authorization server's response did not contain a supported OAuth token set",
            operatorAction: invalidInput ? "Check this provider's client id, secret and grant parameters."
                : 'Check that the token endpoint URL points at an OAuth 2.0 token endpoint.',
        });
    }
}
