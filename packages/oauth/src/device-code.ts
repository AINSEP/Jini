import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { customFetch, initiateDeviceAuthorization, type DeviceAuthorizationResponse } from 'openid-client';
/** Device authorization and one-shot polling (RFC 8628). The application owns polling cadence and keeps the device code secret. */
import { applyResourceIndicators } from "./resource.js";
import type { ISODateTime } from '@jini-ai/core/primitives';
import { parseOAuthJsonObject } from "./bounded-json.js";
import { assertSafeProviderEndpoint, assertSafeUserFacingUrl } from "./endpoint-safety.js";
import { mapProviderErrorCode, OAuthError } from "./errors.js";
import type { OAuthClient, OAuthProviderDescriptor, OAuthTokenSet, OAuthHttpPorts, OAuthUrlGuard, OAuthResource } from "./ports.js";
import { createOAuthClientConfiguration, DEFAULT_TOKEN_REQUEST_TIMEOUT_MS, requestOAuthToken, type TokenRequestDeps } from "./token-endpoint.js";
import { createOAuthCustomFetch } from './guarded-transport.js';
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 60;
const MAX_DEVICE_CODE_LIFETIME_SECONDS = 30 * 60;
const MAX_RESPONSE_BYTES = 16 * 1024;
export interface DeviceAuthorization {
    readonly deviceCode: string;
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete: string | null;
    readonly expiresAt: ISODateTime;
    readonly intervalSeconds: number;
}
export interface DeviceAuthorizationDeps extends OAuthHttpPorts {
    readonly provider: OAuthProviderDescriptor;
    readonly clock: Clock;
}
export interface BeginDeviceAuthorizationInput {
    readonly resource?: OAuthResource;
    readonly client: OAuthClient;
    readonly scopes?: readonly string[];
    readonly timeoutMs?: number;
}
interface RawDeviceAuthorizationResponse extends Readonly<Record<string, unknown>> {
    device_code?: unknown;
    user_code?: unknown;
    verification_uri?: unknown;
    verification_url?: unknown;
    verification_uri_complete?: unknown;
    expires_in?: unknown;
    interval?: unknown;
    error?: unknown;
}
function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value === "") {
        throw new OAuthError({
            code: "OAUTH_MALFORMED_RESPONSE", message: `the device authorization response is missing '${field}'`,
            operatorAction: "This provider's device-authorization endpoint is not RFC 8628 compliant."
        });
    }
    return value;
}
function clampSeconds(raw: unknown, fallback: number, min: number, max: number): number {
    const seconds = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(seconds))
        return fallback;
    return Math.min(Math.max(Math.ceil(seconds), min), max);
}
function requireDeviceAuthorizationEndpoint(provider: OAuthProviderDescriptor): string {
    if (!provider.supportedGrants.includes("device_code") || !provider.deviceAuthorizationEndpoint) {
        throw new OAuthError({
            code: "OAUTH_UNSUPPORTED_GRANT", message: `provider '${provider.providerId}' does not support the device grant`,
            operatorAction: "Connect this provider from Settings using the browser redirect flow instead."
        });
    }
    return provider.deviceAuthorizationEndpoint;
}
/** Performs one upstream device initiation through the guarded, bounded host transport.
 * Client authentication/configuration belongs to the shared token owner; no native fetch is used.
 * @returns The library-processed device response after facade compatibility projection.
 * @throws {OAuthError} Preserves endpoint, transport, body and provider errors without leaking JSON.
 * @complexity O(n) time and space in the form and response, capped at 16 KiB; exactly one HTTP call.
 */
async function postDeviceAuthorizationRequest({ deps, endpoint, client, params }: {
    readonly deps: DeviceAuthorizationDeps;
    readonly endpoint: URL;
    readonly client: OAuthClient;
    readonly params: URLSearchParams;
}, { timeoutMs = DEFAULT_TOKEN_REQUEST_TIMEOUT_MS }: { readonly timeoutMs?: number } = {}): Promise<DeviceAuthorizationResponse> {
    // openid-client wraps customFetch failures. Retain our error identity and copy, including
    // streamed-body failures; upstream errors can carry response data containing the device code.
    let adapterFailure: { readonly error: unknown } | undefined;
    try {
        const config = createOAuthClientConfiguration({ client, endpoint, endpointName: 'device_authorization_endpoint' });
        const guardedFetch = createOAuthCustomFetch({ guard: deps.guard, timeoutMs,
            endpointLabel: 'device authorization endpoint', responseMessages: DEVICE_RESPONSE_MESSAGES,
            fetchFn: async (args, options) => {
                try {
                    return await deps.fetchFn(args, options);
                } catch (cause) {
                    throw new OAuthError({
                        code: 'OAUTH_PROVIDER_UNREACHABLE', message: `could not reach the device authorization endpoint at ${endpoint.host}`,
                        operatorAction: 'Check network access to this provider, then start the connection again. Nothing was retried automatically.',
                    }, { cause });
                }
            },
        }, { maxResponseBytes: MAX_RESPONSE_BYTES });
        config[customFetch] = async (url, options) => {
            try {
                const response = await guardedFetch(url, options);
                const body = parseOAuthJsonObject(await response.text(), DEVICE_RESPONSE_MESSAGES);
                assertDeviceAuthorizationAccepted(response, body);
                const projected = deviceResponseForLibrary({ body, guard: deps.guard });
                // The facade accepts every successful 2xx and JSON object regardless of content
                // type. Canonicalize only after the original status/body checks and safety bounds.
                return new Response(JSON.stringify(projected), {
                    status: 200, headers: { 'content-type': 'application/json' },
                });
            } catch (error) {
                adapterFailure = { error };
                throw error;
            }
        };
        return await initiateDeviceAuthorization(config, params);
    } catch (error) {
        if (adapterFailure) throw adapterFailure.error;
        const invalidInput = error instanceof TypeError;
        throw new OAuthError({
            code: invalidInput ? 'OAUTH_INVALID_REQUEST' : 'OAUTH_MALFORMED_RESPONSE',
            message: invalidInput ? 'the OAuth grant or client configuration is invalid'
                : 'the device authorization endpoint did not return a JSON object',
            operatorAction: invalidInput ? "Check this provider's client id, secret and grant parameters."
                : 'Check that the device authorization endpoint URL is correct.',
        });
    }
}
function assertDeviceAuthorizationAccepted(response: Response, body: RawDeviceAuthorizationResponse): void {
    if (response.ok && typeof body.error !== "string")
        return;
    const providerErrorCode = typeof body.error === "string" ? body.error : undefined;
    throw new OAuthError({
        code: providerErrorCode ? mapProviderErrorCode({
            providerErrorCode: providerErrorCode
        }) : "OAUTH_PROVIDER_REJECTED", message: `the authorization server refused the device authorization request (HTTP ${response.status})`,
        operatorAction: "Check this provider's client id and scopes, then start the connection again."
    }, {
        ...(providerErrorCode === undefined ? {} : { providerErrorCode })
    });
}
/** Keeps the facade's legacy spelling/coercion/link policy ahead of upstream RFC 8628 processing.
 * @returns Canonical wire fields; only protocol fields are forwarded, never arbitrary response data.
 * @throws {OAuthError} For missing required strings or unsafe provider-supplied display links.
 * @complexity O(n) time and space in link lengths, within the bounded 16 KiB response.
 */
function deviceResponseForLibrary({ body, guard }: { readonly body: RawDeviceAuthorizationResponse; readonly guard: OAuthUrlGuard }, _optionalArgs: Record<string, never> = {}): DeviceAuthorizationResponse {
    const verificationUri = assertSafeUserFacingUrl({
        raw: requiredString(body.verification_uri ?? body.verification_url, "verification_uri"),
        guard: guard
    }).toString();
    const completeRaw = body.verification_uri_complete;
    const verificationUriComplete = typeof completeRaw === "string" && completeRaw !== "" ? assertSafeUserFacingUrl({
        raw: completeRaw,
        guard: guard
    }).toString() : null;
    return {
        device_code: requiredString(body.device_code, "device_code"),
        user_code: requiredString(body.user_code, "user_code"),
        verification_uri: verificationUri,
        ...(verificationUriComplete === null ? {} : { verification_uri_complete: verificationUriComplete }),
        expires_in: clampSeconds(body.expires_in, MAX_DEVICE_CODE_LIFETIME_SECONDS, 30, MAX_DEVICE_CODE_LIFETIME_SECONDS),
        interval: clampSeconds(body.interval, DEFAULT_POLL_INTERVAL_SECONDS, 1, MAX_POLL_INTERVAL_SECONDS),
    };
}
/** Initiates one device grant with upstream authentication and protocol processing.
 * The facade retains display-link safety, compatibility coercions and its injected clock.
 * @returns Normalized device authorization with bounded local expiry and polling interval.
 * @throws {OAuthError} For unsupported grants, invalid inputs, unsafe URLs or provider failures.
 * @complexity O(n) time and space in scopes/resources and the 16 KiB response; one HTTP request.
 * @example beginDeviceAuthorization({ ...ports, provider, clock, client }, { scopes: ['read'] })
 */
export async function beginDeviceAuthorization(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput>, optionalArgs: OAuthOptionalArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput> = {}): Promise<DeviceAuthorization> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, client: requiredArgs.client };
    const endpoint = assertSafeProviderEndpoint(requireDeviceAuthorizationEndpoint(deps.provider), "device authorization endpoint", deps.guard);
    const scopes = input.scopes ?? deps.provider.defaultScopes;
    const params = new URLSearchParams();
    if (scopes.length > 0) params.set('scope', scopes.join(' '));
    applyResourceIndicators(params, input.resource);
    const body = await postDeviceAuthorizationRequest({ deps, endpoint, client: input.client, params },
        { ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
    return {
        deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri,
        verificationUriComplete: body.verification_uri_complete ?? null,
        expiresAt: new Date(Date.parse(readNowIso({ clock: deps.clock })) + body.expires_in * 1000).toISOString(),
        intervalSeconds: body.interval ?? DEFAULT_POLL_INTERVAL_SECONDS,
    };
}
export interface PollDeviceAuthorizationInput {
    readonly resource?: OAuthResource;
    readonly client: OAuthClient;
    readonly deviceCode: string;
    readonly expiresAt: ISODateTime;
    readonly timeoutMs?: number;
}
export async function pollDeviceAuthorizationOnce(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput>, optionalArgs: OAuthOptionalArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, client: requiredArgs.client, deviceCode: requiredArgs.deviceCode, expiresAt: requiredArgs.expiresAt };
    if (Date.parse(readNowIso({ clock: deps.clock })) >= Date.parse(input.expiresAt)) {
        throw new OAuthError({
            code: "OAUTH_EXPIRED_TOKEN", message: "the device authorization expired before it was approved",
            operatorAction: "Start the connection again to get a fresh code."
        }, {
            providerErrorCode: "expired_token"
        });
    }
    // Upstream's pollDeviceAuthorizationGrant sleeps and retries. The shared token owner's
    // generic grant operation makes one request so the host retains cadence and retry decisions.
    return requestOAuthToken({
        ...deps,
        tokenEndpoint: deps.provider.tokenEndpoint,
        client: input.client,
        params: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: input.deviceCode }
    }, {
        ...(input.resource === undefined ? {} : { resource: input.resource }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
}
const DEVICE_RESPONSE_MESSAGES = {
    overflowMessage: `the device authorization response exceeded ${MAX_RESPONSE_BYTES} bytes`,
    overflowOperatorAction: "This provider's device-authorization endpoint is not behaving like an RFC 8628 endpoint.",
    notJsonMessage: "the device authorization endpoint did not return a JSON object",
    notJsonOperatorAction: "Check that the device authorization endpoint URL is correct.",
} as const;
