import { nowIso as readNowIso, type Clock, type ISODateTime } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { customFetch, initiateDeviceAuthorization, ResponseBodyError } from 'openid-client';
/** Device authorization and one-shot polling (RFC 8628). The application owns polling cadence and keeps the device code secret. */
import { applyResourceIndicators } from "./resource.js";
import { assertSafeProviderEndpoint, assertSafeUserFacingUrl } from "./endpoint-safety.js";
import { adaptOAuthResponse, mapProviderErrorCode, OAuthError } from "./errors.js";
import type { OAuthClient, OAuthProviderDescriptor, OAuthTokenSet, OAuthHttpPorts, OAuthResource } from "./ports.js";
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
function clampSeconds(seconds: number, min: number, max: number): number {
    return Math.min(Math.max(Math.ceil(seconds), min), max);
}
/** The host owns polling cadence, local lifetime bounds and safe display links. */
export async function beginDeviceAuthorization(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput>, optionalArgs: OAuthOptionalArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput> = {}): Promise<DeviceAuthorization> {
    const { provider, client, guard, clock } = requiredArgs;
    if (!provider.supportedGrants.includes('device_code') || !provider.deviceAuthorizationEndpoint)
        throw new OAuthError({ code: 'OAUTH_UNSUPPORTED_GRANT',
            message: `provider '${provider.providerId}' does not support the device grant`,
            operatorAction: 'Connect this provider from Settings using the browser redirect flow instead.' });
    const endpoint = assertSafeProviderEndpoint(provider.deviceAuthorizationEndpoint, 'device authorization endpoint', guard);
    const params = new URLSearchParams();
    const scopes = optionalArgs.scopes ?? provider.defaultScopes;
    if (scopes.length > 0) params.set('scope', scopes.join(' '));
    applyResourceIndicators(params, optionalArgs.resource);
    const guardedFetch = createOAuthCustomFetch({
        ...requiredArgs, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
        endpointLabel: 'device authorization endpoint', responseMessages: DEVICE_RESPONSE_MESSAGES,
    }, { maxResponseBytes: MAX_RESPONSE_BYTES, unreachable: {
        message: `could not reach the device authorization endpoint at ${endpoint.host}`,
        operatorAction: 'Check network access to this provider, then start the connection again. Nothing was retried automatically.' } });
    try {
        const config = createOAuthClientConfiguration({ client, endpoint, endpointName: 'device_authorization_endpoint' });
        config[customFetch] = async (url, options) => adaptOAuthResponse({ response: await guardedFetch(url, options) }, {
            successStatus: 200,
            project(body) {
                // Google still emits the pre-RFC spelling; upstream validates the normalized field.
                if (body.verification_uri === undefined && typeof body.verification_url === 'string')
                    body.verification_uri = body.verification_url;
            },
        });
        const body = await initiateDeviceAuthorization(config, params);
        return {
            deviceCode: body.device_code, userCode: body.user_code,
            verificationUri: assertSafeUserFacingUrl({ raw: body.verification_uri, guard }).href,
            verificationUriComplete: body.verification_uri_complete === undefined ? null
                : assertSafeUserFacingUrl({ raw: body.verification_uri_complete, guard }).href,
            expiresAt: new Date(Date.parse(readNowIso({ clock }))
                + clampSeconds(body.expires_in, 30, MAX_DEVICE_CODE_LIFETIME_SECONDS) * 1000).toISOString(),
            intervalSeconds: clampSeconds(body.interval ?? DEFAULT_POLL_INTERVAL_SECONDS, 1, MAX_POLL_INTERVAL_SECONDS),
        };
    } catch (error) {
        if (guardedFetch.failure) throw guardedFetch.failure.error;
        if (error instanceof OAuthError) throw error;
        if (error instanceof ResponseBodyError)
            throw new OAuthError({
                code: mapProviderErrorCode({ providerErrorCode: error.error }),
                message: `the authorization server refused the device authorization request (HTTP ${guardedFetch.status})`,
                operatorAction: "Check this provider's client id and scopes, then start the connection again.",
            }, { providerErrorCode: error.error });
        if (guardedFetch.status !== undefined && (guardedFetch.status < 200 || guardedFetch.status >= 300))
            throw new OAuthError({ code: 'OAUTH_PROVIDER_REJECTED',
                message: `the authorization server refused the device authorization request (HTTP ${guardedFetch.status})`,
                operatorAction: "Check this provider's client id and scopes, then start the connection again." });
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
export interface PollDeviceAuthorizationInput {
    readonly resource?: OAuthResource;
    readonly client: OAuthClient;
    readonly deviceCode: string;
    readonly expiresAt: ISODateTime;
    readonly timeoutMs?: number;
}
export async function pollDeviceAuthorizationOnce(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput>, optionalArgs: OAuthOptionalArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput> = {}): Promise<OAuthTokenSet> {
    const { provider, clock, client, deviceCode, expiresAt } = requiredArgs;
    if (Date.parse(readNowIso({ clock })) >= Date.parse(expiresAt))
        throw new OAuthError({
            code: "OAUTH_EXPIRED_TOKEN", message: "the device authorization expired before it was approved",
            operatorAction: "Start the connection again to get a fresh code."
        }, { providerErrorCode: 'expired_token' });
    // Upstream's pollDeviceAuthorizationGrant sleeps and retries. The shared token owner's
    // generic grant operation makes one request so the host retains cadence and retry decisions.
    return requestOAuthToken({
        ...requiredArgs, tokenEndpoint: provider.tokenEndpoint, client,
        params: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode },
    }, optionalArgs);
}
const DEVICE_RESPONSE_MESSAGES = {
    overflowMessage: `the device authorization response exceeded ${MAX_RESPONSE_BYTES} bytes`,
    overflowOperatorAction: "This provider's device-authorization endpoint is not behaving like an RFC 8628 endpoint.",
} as const;
