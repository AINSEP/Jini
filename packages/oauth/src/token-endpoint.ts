import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { applyResourceIndicators } from "./resource.js";
import type { ISODateTime } from '@jini-ai/core/primitives';
import { MAX_OAUTH_RESPONSE_BYTES, readBoundedOAuthJson } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { mapProviderErrorCode, OAuthError } from "./errors.js";
import type { OAuthClient, OAuthFetch, OAuthTokenSet, OAuthHttpPorts, OAuthResource } from "./ports.js";
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
function applyClientAuth(client: OAuthClient, params: Record<string, string>, headers: Record<string, string>): void {
    if (client.authMethod === "client_secret_basic") {
        const encoded = Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret ?? "")}`).toString("base64");
        headers.authorization = `Basic ${encoded}`;
        return;
    }
    params.client_id = client.clientId;
    if (client.authMethod === "client_secret_post" && client.clientSecret) {
        params.client_secret = client.clientSecret;
    }
}
interface RawTokenResponse {
    access_token?: unknown;
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
export async function requestOAuthToken(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & TokenRequestInput>, optionalArgs: OAuthOptionalArgs<TokenRequestDeps & TokenRequestInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, tokenEndpoint: requiredArgs.tokenEndpoint, client: requiredArgs.client, params: requiredArgs.params };
    const endpoint = assertSafeProviderEndpoint(input.tokenEndpoint, "token endpoint", deps.guard);
    const fetchFn = deps.fetchFn;
    const params: Record<string, string> = { ...input.params };
    const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
    };
    applyClientAuth(input.client, params, headers);
    const formBody = tokenForm(params, input.resource);
    let response: Response;
    try {
        response = await fetchFn({
            url: endpoint.toString()
        }, {
            method: "POST",
            headers,
            body: formBody,
            redirect: "error",
            signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS),
        });
    }
    catch (cause) {
        throw new OAuthError({
            code: "OAUTH_PROVIDER_UNREACHABLE", message: `could not reach the authorization server at ${endpoint.host}`,
            operatorAction: "Check network access to this provider, then try connecting again. Nothing was retried automatically."
        }, {
            cause
        });
    }
    const body = (await readBoundedOAuthJson(response, TOKEN_RESPONSE_MESSAGES)) as RawTokenResponse;
    if (typeof body.error === "string" || !response.ok)
        throw toProviderError(body, response.status);
    if (typeof body.access_token !== "string" || body.access_token === "") {
        throw new OAuthError({
            code: "OAUTH_MALFORMED_RESPONSE", message: "the authorization server's response contained no access token",
            operatorAction: "Check that the token endpoint URL points at an OAuth 2.0 token endpoint."
        });
    }
    const nowIso = readNowIso({ clock: deps.clock });
    return {
        accessToken: body.access_token,
        refreshToken: nonEmptyStringOrNull(body.refresh_token),
        tokenType: nonEmptyStringOrDefault(body.token_type, "Bearer"),
        scopes: parseScopes(body.scope),
        expiresAt: resolveExpiresAt(body.expires_in, nowIso),
    };
}
function tokenForm(params: Record<string, string>, resource: OAuthResource | undefined): string {
    const form = new URLSearchParams(params);
    applyResourceIndicators(form, resource);
    return form.toString();
}
