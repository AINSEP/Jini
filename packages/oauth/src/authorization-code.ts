import { defaultOAuthMessages, type OAuthMessages } from './messages.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { buildAuthorizationUrl } from 'openid-client';
/** Browser grant split across the redirect. Store or seal PKCE and resource binding before redirect; validate owner-bound state before exchanging the code once. */
// A cloud-hosted client needs a stable, browser-reachable callback. A per-agent subprocess's
// transient localhost listener is unreachable from a remote user's browser and can die between
// the redirect and callback. The host owns that callback and storage/sealing; this module owns the grant.
import { assertOAuthAppOptions } from "./options.js";
import { applyResourceIndicators } from "./resource.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import { invalidState, type PendingAuthorizationStore } from './pending-authorizations.js';
import { assertValidCodeVerifier, createPkcePair } from "./pkce.js";
import type { OAuthClient, OAuthProviderDescriptor, OAuthRandomBytes, OAuthTokenSet, OAuthUrlGuard, OAuthAppOptions, OAuthResource } from "./ports.js";
import { createOAuthClientConfiguration, requestOAuthToken, type TokenRequestDeps } from "./token-endpoint.js";
import { MAX_AUTHORIZATION_STATE_LENGTH, type SealedAuthorizationState } from './sealed-state.js';
/** Bound on an authorization code; the loopback receiver applies the same one at the edge. */
export const MAX_CODE_LENGTH = 2048;
const PROVIDER_ERROR_PATTERN = /^[a-z_]{1,64}$/;
export interface BeginAuthorizationCodeDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
    readonly randomBytesFn: OAuthRandomBytes;
    readonly guard: OAuthUrlGuard;
    readonly options: OAuthAppOptions;
}
/** Explicit stateless mode; the host supplies sealing bound to the expected connection. */
export interface BeginStatelessAuthorizationCodeDeps extends Omit<BeginAuthorizationCodeDeps, 'pending'> {
    readonly stateless: SealedAuthorizationState;
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
    "resource", "response_type", "client_id", "redirect_uri", "scope", "state",
    "code_challenge", "code_challenge_method",
]);
function applyExtraAuthorizationParams(authorizationUrl: URL, extraAuthorizationParams: Readonly<Record<string, string>> | undefined, messages: OAuthMessages): void {
    for (const [key, value] of Object.entries(extraAuthorizationParams ?? {})) {
        if (RESERVED_AUTHORIZATION_PARAMS.has(key))
            throw new OAuthError({
                code: "OAUTH_INVALID_REQUEST", message: messages.reservedAuthorizationParameter({ parameter: key }),
                operatorAction: messages.reservedAuthorizationParameterAction
            });
        authorizationUrl.searchParams.set(key, value);
    }
}
function assertGrantSupported(provider: OAuthProviderDescriptor, grant: "authorization_code" | "device_code"): void {
    if (!provider.supportedGrants.includes(grant))
        throw new OAuthError({
            code: "OAUTH_UNSUPPORTED_GRANT", message: `provider '${provider.providerId}' does not support the ${grant} grant`,
            operatorAction: "Choose a different connection method for this provider."
        });
}
type BeginAuthorizationCodeArgs = OAuthRequiredArgs<Omit<BeginAuthorizationCodeDeps, 'pending'> & BeginAuthorizationCodeInput>
    & ({ pending: PendingAuthorizationStore } | { stateless: SealedAuthorizationState });
/** Upstream appends endpoint query fields; pass them as parameters to retain facade replacement
 * semantics and repeated resource fields. Formatting is synchronous and makes no HTTP request.
 */
function formatAuthorizationUrl({ url, clientId }: { readonly url: URL; readonly clientId: string }, _optionalArgs: Record<string, never> = {}): string {
    const endpoint = new URL(url);
    endpoint.search = '';
    const params = new URLSearchParams(url.searchParams);
    params.delete('client_id');
    params.set('response_type', 'code');
    try {
        const config = createOAuthClientConfiguration({ client: { clientId, authMethod: 'none' },
            endpoint, endpointName: 'authorization_endpoint' });
        return buildAuthorizationUrl(config, params).href;
    } catch {
        // Upstream errors may contain supplied metadata. Keep the public error copy secret-free.
        throw new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message: 'the OAuth authorization request configuration is invalid',
            operatorAction: "Check this provider's client id and authorization endpoint." });
    }
}
/** Persist or seal the owner-bound request before returning the browser redirect. */
export async function beginAuthorizationCode(requiredArgs: BeginAuthorizationCodeArgs, optionalArgs: OAuthOptionalArgs<BeginAuthorizationCodeDeps & BeginAuthorizationCodeInput> = {}): Promise<BeginAuthorizationCodeResult> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, ownerKey: requiredArgs.ownerKey, client: requiredArgs.client, redirectUri: requiredArgs.redirectUri };
    const { provider } = deps;
    assertOAuthAppOptions(deps.options);
    assertGrantSupported(provider, "authorization_code");
    if (!provider.authorizationEndpoint)
        throw new OAuthError({
            code: "OAUTH_UNSUPPORTED_GRANT", message: `provider '${provider.providerId}' declares no authorization endpoint`,
            operatorAction: "Configure this provider's authorization endpoint, or connect it with the device grant instead."
        });
    const authorizationUrl = assertSafeProviderEndpoint(provider.authorizationEndpoint, "authorization endpoint", deps.guard);
    const redirectUri = assertSafeProviderEndpoint(input.redirectUri, "redirect URI", deps.guard);
    if (!deps.options.redirectUris.some(uri => new URL(uri).href === redirectUri.href))
        throw new OAuthError({
            code: 'OAUTH_INVALID_REQUEST', message: 'redirect URI is not in the configured client identity',
            operatorAction: 'Register this callback URL before connecting.'
        });
    applyExtraAuthorizationParams(authorizationUrl, input.extraAuthorizationParams, optionalArgs.messages ?? defaultOAuthMessages);
    applyResourceIndicators(authorizationUrl.searchParams, input.resource);
    const scopes = input.scopes ?? provider.defaultScopes;
    const pkce = provider.usesPkce ? createPkcePair({ randomBytesFn: deps.randomBytesFn }) : undefined;
    const authorization = {
        ownerKey: input.ownerKey,
        providerId: provider.providerId,
        codeVerifier: pkce?.codeVerifier ?? "",
        redirectUri: redirectUri.toString(),
        scopes: [...scopes]
    };
    applyAuthorizationCodeParams({ authorizationUrl, redirectUri, scopes, pkce });
    // Validate/format before committing state so an upstream configuration refusal cannot leave
    // a pending request behind. Only the host-issued state is attached after storage succeeds.
    const formattedUrl = new URL(formatAuthorizationUrl({ url: authorizationUrl, clientId: input.client.clientId }));
    const entry = await storeAuthorizationRequest({ deps, authorization }, { resource: input.resource });
    assertIssuedAuthorizationState({ state: entry.state });
    formattedUrl.searchParams.set('state', entry.state);
    return { authorizationUrl: formattedUrl.href, state: entry.state, expiresAt: entry.expiresAt };
}
export interface CompleteAuthorizationCodeDeps extends TokenRequestDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
}
/** The exact callback URI is mandatory in stateless mode and is checked before exchange. */
export interface CompleteStatelessAuthorizationCodeDeps extends Omit<CompleteAuthorizationCodeDeps, 'pending'> {
    readonly stateless: SealedAuthorizationState;
    readonly redirectUri: string;
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
type CompleteAuthorizationCodeArgs = OAuthRequiredArgs<Omit<CompleteAuthorizationCodeDeps, 'pending'> & CompleteAuthorizationCodeInput>
    & ({ pending: PendingAuthorizationStore } | { stateless: SealedAuthorizationState; redirectUri: string });
export async function completeAuthorizationCode(requiredArgs: CompleteAuthorizationCodeArgs, optionalArgs: OAuthOptionalArgs<CompleteAuthorizationCodeDeps & CompleteAuthorizationCodeInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, ownerKey: requiredArgs.ownerKey, client: requiredArgs.client, params: requiredArgs.params };
    assertGrantSupported(deps.provider, "authorization_code");
    assertCallbackShape(input.params);
    const entry = 'stateless' in deps
        ? await deps.stateless.open({ state: input.params.state, ownerKey: input.ownerKey,
            providerId: deps.provider.providerId, redirectUri: deps.redirectUri })
        : await deps.pending.take({ state: input.params.state, ownerKey: input.ownerKey });
    if (entry.providerId !== deps.provider.providerId) throw invalidState({});
    if (input.params.error !== undefined)
        throw toCallbackError(input.params.error);
    const code = input.params.code;
    if (code === undefined || code === "")
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: "the authorization server returned neither a code nor an error",
            operatorAction: "Start the connection again from the connection settings."
        });
    const params: Record<string, string> = {
        grant_type: "authorization_code",
        code,
        redirect_uri: entry.redirectUri,
    };
    if (deps.provider.usesPkce) {
        assertValidCodeVerifier({ codeVerifier: entry.codeVerifier });
        params.code_verifier = entry.codeVerifier;
    }
    // The shared token owner uses openid-client's one-request generic grant operation. Its
    // authorizationCodeGrant API takes a complete callback URL and strips redirect query fields;
    // this facade receives parsed fields and must exchange the exact stored redirect URI instead.
    return requestOAuthToken({ ...deps, tokenEndpoint: deps.provider.tokenEndpoint, client: input.client, params }, {
        ...(entry.resource === undefined ? {} : { resource: entry.resource }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
}
function assertCallbackShape(params: AuthorizationCallbackParams): void {
    if (params.state === "" || params.state.length > MAX_AUTHORIZATION_STATE_LENGTH) throw invalidState({});
    if (params.code !== undefined && params.code.length > MAX_CODE_LENGTH)
        throw new OAuthError({
            code: "OAUTH_INVALID_REQUEST", message: `the authorization code exceeded ${MAX_CODE_LENGTH} characters`,
            operatorAction: "Start the connection again from the connection settings."
        });
}
/** Maps a callback `error` parameter to a typed failure; the raw value is kept only when it is a plain protocol code. */
export function toCallbackError(rawError: string): OAuthError {
    const providerErrorCode = PROVIDER_ERROR_PATTERN.test(rawError) ? rawError : undefined;
    const denied = providerErrorCode === 'access_denied';
    return new OAuthError({
        code: denied ? 'OAUTH_ACCESS_DENIED' : 'OAUTH_PROVIDER_REJECTED',
        message: denied ? 'authorization was declined' : 'the authorization server refused the authorization request',
        operatorAction: denied ? "Approve the request on the provider's consent screen, then connect again."
            : "Check this provider's client id, scopes and redirect URI, then try connecting again.",
    }, { ...(providerErrorCode === undefined ? {} : { providerErrorCode }) });
}

export function buildOAuthAuthorizationUrl(requiredArgs: {
  authorizationEndpoint: string; clientId: string; redirectUri: string; state: string; codeChallenge: string;
}, optionalArgs: { scope?: string; resource?: string } = {}): string {
  const url = new URL(requiredArgs.authorizationEndpoint);
  url.searchParams.set('redirect_uri', requiredArgs.redirectUri);
  url.searchParams.set('state', requiredArgs.state);
  url.searchParams.set('code_challenge', requiredArgs.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (optionalArgs.scope) url.searchParams.set('scope', optionalArgs.scope);
  // RFC 8707 binds the issued token to the requested resource; servers that require audience
  // narrowing need this indicator, while servers that ignore it can still accept the request.
  if (optionalArgs.resource) url.searchParams.set('resource', optionalArgs.resource);
  return formatAuthorizationUrl({ url, clientId: requiredArgs.clientId });
}

/** Fixed-issuer code exchange; confidential clients use Basic, public PKCE clients omit it.
 * RFC 8707 binds tokens to the requested resource, and the host owns endpoint/DNS policy.
 * Both facades call the same upstream grant processor.
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

/** Build the browser request before any owner-bound state is committed. */
function applyAuthorizationCodeParams({ authorizationUrl, redirectUri, scopes, pkce }: {
    authorizationUrl: URL; redirectUri: URL; scopes: readonly string[];
    pkce: ReturnType<typeof createPkcePair> | undefined;
}): void {
    authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
    if (scopes.length > 0)
        authorizationUrl.searchParams.set("scope", scopes.join(" "));
    if (pkce) {
        authorizationUrl.searchParams.set("code_challenge", pkce.codeChallenge);
        authorizationUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
    }
}
async function storeAuthorizationRequest({ deps, authorization }: {
    deps: BeginAuthorizationCodeArgs;
    authorization: Parameters<PendingAuthorizationStore['put']>[0];
}, { resource }: { resource?: OAuthResource } = {}) {
    const resourceOptions = resource === undefined ? {} : { resource };
    return 'stateless' in deps
        ? await deps.stateless.seal({ entry: { ...authorization, ...resourceOptions } })
        : await deps.pending.put(authorization, resourceOptions);
}

function assertIssuedAuthorizationState({ state }: { state: string }): void {
    if (state.length === 0 || state.length > MAX_AUTHORIZATION_STATE_LENGTH) throw invalidState({});
}
