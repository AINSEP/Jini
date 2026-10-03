import { defaultOAuthMessages, type OAuthMessages } from './messages.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
/** Browser grant split across the redirect. Persist PKCE and resource binding before redirect; consume owner-bound state before exchanging the code once. */
// A cloud-hosted client needs a stable, browser-reachable callback. A per-agent subprocess's
// transient localhost listener is unreachable from a remote user's browser and can die between
// the redirect and callback. The host owns that callback and storage; this module owns the grant.
import { assertOAuthAppOptions } from "./options.js";
import { applyResourceIndicators } from "./resource.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import type { PendingAuthorizationStore } from "./pending-authorizations.js";
import { assertValidCodeVerifier, createPkcePair } from "./pkce.js";
import type { OAuthClient, OAuthProviderDescriptor, OAuthRandomBytes, OAuthTokenSet, OAuthUrlGuard, OAuthAppOptions, OAuthResource } from "./ports.js";
import { requestOAuthToken, type TokenRequestDeps } from "./token-endpoint.js";
const MAX_CODE_LENGTH = 2048;
const MAX_STATE_LENGTH = 256;
const PROVIDER_ERROR_PATTERN = /^[a-z_]{1,64}$/;
export interface BeginAuthorizationCodeDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
    readonly randomBytesFn: OAuthRandomBytes;
    readonly guard: OAuthUrlGuard;
    readonly options: OAuthAppOptions;
}
export interface BeginAuthorizationCodeInput {
    readonly messages?: OAuthMessages;
    readonly ownerKey: string;
    readonly client: OAuthClient;
    readonly redirectUri: string;
    readonly resource?: OAuthResource;
    readonly scopes?: readonly string[];
    readonly extraAuthorizationParams?: Readonly<Record<string, string>>;
}
export interface BeginAuthorizationCodeResult {
    readonly authorizationUrl: string;
    readonly state: string;
    readonly expiresAt: string;
}
const RESERVED_AUTHORIZATION_PARAMS: ReadonlySet<string> = new Set([
    "resource",
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
]);
function applyExtraAuthorizationParams(authorizationUrl: URL, extraAuthorizationParams: Readonly<Record<string, string>> | undefined, messages: OAuthMessages): void {
    for (const [key, value] of Object.entries(extraAuthorizationParams ?? {})) {
        if (RESERVED_AUTHORIZATION_PARAMS.has(key)) {
            throw new OAuthError({
                code: "OAUTH_INVALID_REQUEST", message: messages.reservedAuthorizationParameter({ parameter: key }),
                operatorAction: messages.reservedAuthorizationParameterAction
            });
        }
        authorizationUrl.searchParams.set(key, value);
    }
}
function assertGrantSupported(provider: OAuthProviderDescriptor, grant: "authorization_code" | "device_code"): void {
    if (!provider.supportedGrants.includes(grant)) {
        throw new OAuthError({
            code: "OAUTH_UNSUPPORTED_GRANT", message: `provider '${provider.providerId}' does not support the ${grant} grant`,
            operatorAction: "Choose a different connection method for this provider."
        });
    }
}
export async function beginAuthorizationCode(requiredArgs: OAuthRequiredArgs<BeginAuthorizationCodeDeps & BeginAuthorizationCodeInput>, optionalArgs: OAuthOptionalArgs<BeginAuthorizationCodeDeps & BeginAuthorizationCodeInput> = {}): Promise<BeginAuthorizationCodeResult> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, ownerKey: requiredArgs.ownerKey, client: requiredArgs.client, redirectUri: requiredArgs.redirectUri };
    assertOAuthAppOptions(deps.options);
    const { provider } = deps;
    assertGrantSupported(provider, "authorization_code");
    if (!provider.authorizationEndpoint) {
        throw new OAuthError({
            code: "OAUTH_UNSUPPORTED_GRANT", message: `provider '${provider.providerId}' declares no authorization endpoint`,
            operatorAction: "Configure this provider's authorization endpoint, or connect it with the device grant instead."
        });
    }
    const authorizationUrl = assertSafeProviderEndpoint(provider.authorizationEndpoint, "authorization endpoint", deps.guard);
    const redirectUri = assertSafeProviderEndpoint(input.redirectUri, "redirect URI", deps.guard);
    if (!deps.options.redirectUris.some(uri => new URL(uri).href === redirectUri.href)) {
        throw new OAuthError({
            code: 'OAUTH_INVALID_REQUEST', message: 'redirect URI is not in the configured client identity',
            operatorAction: 'Register this callback URL before connecting.'
        });
    }
    applyExtraAuthorizationParams(authorizationUrl, input.extraAuthorizationParams, optionalArgs.messages ?? defaultOAuthMessages);
    applyResourceIndicators(authorizationUrl.searchParams, input.resource);
    const scopes = input.scopes ?? provider.defaultScopes;
    const pkce = provider.usesPkce ? createPkcePair({
        randomBytesFn: deps.randomBytesFn
    }) : undefined;
    const entry = await deps.pending.put({
        ownerKey: input.ownerKey,
        providerId: provider.providerId,
        codeVerifier: pkce?.codeVerifier ?? "",
        redirectUri: redirectUri.toString(),
        scopes: [...scopes]
    }, {
        ...(input.resource === undefined ? {} : { resource: input.resource })
    });
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", input.client.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
    if (scopes.length > 0)
        authorizationUrl.searchParams.set("scope", scopes.join(" "));
    authorizationUrl.searchParams.set("state", entry.state);
    if (pkce) {
        authorizationUrl.searchParams.set("code_challenge", pkce.codeChallenge);
        authorizationUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
    }
    return { authorizationUrl: authorizationUrl.toString(), state: entry.state, expiresAt: entry.expiresAt };
}
export interface CompleteAuthorizationCodeDeps extends TokenRequestDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
}
export interface AuthorizationCallbackParams {
    readonly state: string;
    readonly code?: string;
    readonly error?: string;
}
export interface CompleteAuthorizationCodeInput {
    readonly ownerKey: string;
    readonly client: OAuthClient;
    readonly params: AuthorizationCallbackParams;
    readonly timeoutMs?: number;
}
export async function completeAuthorizationCode(requiredArgs: OAuthRequiredArgs<CompleteAuthorizationCodeDeps & CompleteAuthorizationCodeInput>, optionalArgs: OAuthOptionalArgs<CompleteAuthorizationCodeDeps & CompleteAuthorizationCodeInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, ownerKey: requiredArgs.ownerKey, client: requiredArgs.client, params: requiredArgs.params };
    assertGrantSupported(deps.provider, "authorization_code");
    assertCallbackShape(input.params);
    const entry = await deps.pending.take({ state: input.params.state, ownerKey: input.ownerKey });
    if (entry.providerId !== deps.provider.providerId) {
        throw new OAuthError({
            code: "OAUTH_INVALID_STATE", message: "the authorization request could not be matched — it may have expired or already been used",
            operatorAction: "Start the connection again from the connection settings."
        });
    }
    if (input.params.error !== undefined)
        throw toCallbackError(input.params.error);
    const code = input.params.code;
    if (code === undefined || code === "") {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: "the authorization server returned neither a code nor an error",
            operatorAction: "Start the connection again from the connection settings."
        });
    }
    const params: Record<string, string> = {
        grant_type: "authorization_code",
        code,
        redirect_uri: entry.redirectUri,
    };
    if (deps.provider.usesPkce) {
        assertValidCodeVerifier({
            codeVerifier: entry.codeVerifier
        });
        params.code_verifier = entry.codeVerifier;
    }
    return requestOAuthToken({
        ...deps,
        tokenEndpoint: deps.provider.tokenEndpoint,
        client: input.client,
        params
    }, {
        ...(entry.resource === undefined ? {} : { resource: entry.resource }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
}
function assertCallbackShape(params: AuthorizationCallbackParams): void {
    if (params.state === "" || params.state.length > MAX_STATE_LENGTH) {
        throw new OAuthError({
            code: "OAUTH_INVALID_STATE", message: "the authorization request could not be matched — it may have expired or already been used",
            operatorAction: "Start the connection again from the connection settings."
        });
    }
    if (params.code !== undefined && params.code.length > MAX_CODE_LENGTH) {
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: `the authorization code exceeded ${MAX_CODE_LENGTH} characters`,
            operatorAction: "Start the connection again from the connection settings."
        });
    }
}
function toCallbackError(rawError: string): OAuthError {
    const providerErrorCode = PROVIDER_ERROR_PATTERN.test(rawError) ? rawError : undefined;
    if (providerErrorCode === "access_denied") {
        return new OAuthError({
            code: "OAUTH_ACCESS_DENIED", message: "authorization was declined",
            operatorAction: "Approve the request on the provider's consent screen, then connect again."
        }, {
            providerErrorCode
        });
    }
    return new OAuthError({
        code: "OAUTH_PROVIDER_REJECTED", message: "the authorization server refused the authorization request",
        operatorAction: "Check this provider's client id, scopes and redirect URI, then try connecting again."
    }, {
        ...(providerErrorCode === undefined ? {} : { providerErrorCode })
    });
}

export function buildOAuthAuthorizationUrl(requiredArgs: {
  authorizationEndpoint: string; clientId: string; redirectUri: string; state: string; codeChallenge: string;
}, optionalArgs: { scope?: string; resource?: string } = {}): string {
  const url = new URL(requiredArgs.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', requiredArgs.clientId);
  url.searchParams.set('redirect_uri', requiredArgs.redirectUri);
  url.searchParams.set('state', requiredArgs.state);
  url.searchParams.set('code_challenge', requiredArgs.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (optionalArgs.scope) url.searchParams.set('scope', optionalArgs.scope);
  // RFC 8707 binds the issued token to the requested resource; servers that require audience
  // narrowing need this indicator, while servers that ignore it can still accept the request.
  if (optionalArgs.resource) url.searchParams.set('resource', optionalArgs.resource);
  return url.toString();
}

/** Fixed-issuer code exchange; confidential clients use Basic, public PKCE clients omit it.
 * RFC 8707 binds tokens to the requested resource, and the host owns endpoint/DNS policy.
 * The same bounded parser and normalized result serve browser and fixed-issuer flows.
 * Hosts own HTTP policy and token persistence; no credential storage is hidden here.
 */
export interface OAuthCodeExchangeInput {
    readonly tokenEndpoint: string;
    readonly client: OAuthClient;
    readonly redirectUri: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly resource?: OAuthResource;
}
export async function exchangeOAuthAuthorizationCode(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & OAuthCodeExchangeInput>, optionalArgs: OAuthOptionalArgs<TokenRequestDeps & OAuthCodeExchangeInput> = {}): Promise<OAuthTokenSet> {
    return requestOAuthToken({ ...requiredArgs, params: {
        grant_type: 'authorization_code', code: requiredArgs.code,
        redirect_uri: requiredArgs.redirectUri, code_verifier: requiredArgs.codeVerifier,
    } }, optionalArgs);
}
