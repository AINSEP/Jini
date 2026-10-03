import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
/** Device authorization and one-shot polling (RFC 8628). The application owns polling cadence and keeps the device code secret. */
import { applyResourceIndicators } from "./resource.js";
import type { ISODateTime } from '@jini-ai/core/primitives';
import { readBoundedOAuthJson } from "./bounded-json.js";
import { assertSafeProviderEndpoint, assertSafeUserFacingUrl } from "./endpoint-safety.js";
import { mapProviderErrorCode, OAuthError } from "./errors.js";
import type { OAuthClient, OAuthFetch, OAuthProviderDescriptor, OAuthTokenSet, OAuthHttpPorts, OAuthUrlGuard, OAuthResource } from "./ports.js";
import { DEFAULT_TOKEN_REQUEST_TIMEOUT_MS, requestOAuthToken, type TokenRequestDeps } from "./token-endpoint.js";
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
interface RawDeviceAuthorizationResponse {
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
function buildDeviceAuthorizationParams(client: OAuthClient, scopes: readonly string[]): Record<string, string> {
    const params: Record<string, string> = { client_id: client.clientId };
    if (scopes.length > 0)
        params.scope = scopes.join(" ");
    if (client.authMethod === "client_secret_post" && client.clientSecret) {
        params.client_secret = client.clientSecret;
    }
    return params;
}
async function postDeviceAuthorizationRequest(fetchFn: OAuthFetch, endpoint: URL, params: Record<string, string>, resource: OAuthResource | undefined, timeoutMs: number): Promise<Response> {
    const body = deviceForm(params, resource);
    try {
        return await fetchFn({
            url: endpoint.toString()
        }, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
            body,
            redirect: "error",
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (cause) {
        throw new OAuthError({
            code: "OAUTH_PROVIDER_UNREACHABLE", message: `could not reach the device authorization endpoint at ${endpoint.host}`,
            operatorAction: "Check network access to this provider, then start the connection again. Nothing was retried automatically."
        }, {
            cause
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
function narrowDeviceAuthorization(body: RawDeviceAuthorizationResponse, nowIso: ISODateTime, guard: OAuthUrlGuard): DeviceAuthorization {
    const verificationUri = assertSafeUserFacingUrl({
        raw: requiredString(body.verification_uri ?? body.verification_url, "verification_uri"),
        guard: guard
    }).toString();
    const completeRaw = body.verification_uri_complete;
    const verificationUriComplete = typeof completeRaw === "string" && completeRaw !== "" ? assertSafeUserFacingUrl({
        raw: completeRaw,
        guard: guard
    }).toString() : null;
    const lifetimeSeconds = clampSeconds(body.expires_in, MAX_DEVICE_CODE_LIFETIME_SECONDS, 30, MAX_DEVICE_CODE_LIFETIME_SECONDS);
    return {
        deviceCode: requiredString(body.device_code, "device_code"),
        userCode: requiredString(body.user_code, "user_code"),
        verificationUri,
        verificationUriComplete,
        expiresAt: new Date(Date.parse(nowIso) + lifetimeSeconds * 1000).toISOString(),
        intervalSeconds: clampSeconds(body.interval, DEFAULT_POLL_INTERVAL_SECONDS, 1, MAX_POLL_INTERVAL_SECONDS),
    };
}
export async function beginDeviceAuthorization(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput>, optionalArgs: OAuthOptionalArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput> = {}): Promise<DeviceAuthorization> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, client: requiredArgs.client };
    const endpoint = assertSafeProviderEndpoint(requireDeviceAuthorizationEndpoint(deps.provider), "device authorization endpoint", deps.guard);
    const scopes = input.scopes ?? deps.provider.defaultScopes;
    const params = buildDeviceAuthorizationParams(input.client, scopes);
    const fetchFn = deps.fetchFn;
    const response = await postDeviceAuthorizationRequest(fetchFn, endpoint, params, input.resource, input.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS);
    const body = (await readBoundedOAuthJson(response, DEVICE_RESPONSE_MESSAGES, MAX_RESPONSE_BYTES)) as RawDeviceAuthorizationResponse;
    assertDeviceAuthorizationAccepted(response, body);
    return narrowDeviceAuthorization(body, readNowIso({ clock: deps.clock }), deps.guard);
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
function deviceForm(params: Record<string, string>, resource: OAuthResource | undefined): string {
    const form = new URLSearchParams(params);
    applyResourceIndicators(form, resource);
    return form.toString();
}
