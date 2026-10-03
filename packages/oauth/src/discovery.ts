import { createIssuerBoundDiscoveryPolicy, type OAuthDiscoveryPolicy } from './discovery-policy.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
/** Authorization-server and protected-resource discovery. Missing candidates are skipped; unsafe endpoints and malformed fetched documents terminate discovery. */
import { MAX_OAUTH_RESPONSE_BYTES, readBoundedOAuthJson, readOptionalString, readStringArray, } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import type { OAuthFetch, OAuthHttpPorts, OAuthUrlGuard } from "./ports.js";
const DISCOVERY_TIMEOUT_MS = 10000;
const METADATA_MESSAGES = {
    overflowMessage: `the OAuth metadata document exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
    overflowOperatorAction: "This server's OAuth metadata endpoint is not behaving like an RFC 8414 endpoint.",
    notJsonMessage: "the OAuth metadata endpoint did not return a JSON object",
    notJsonOperatorAction: "Check that this server publishes OAuth metadata, or type its endpoints by hand.",
} as const;
export interface OAuthDiscoveryDeps extends OAuthHttpPorts {
}
export interface DiscoveredAuthorizationServer {
    readonly issuer: string;
    readonly authorizationEndpoint: string | null;
    readonly tokenEndpoint: string;
    readonly deviceAuthorizationEndpoint: string | null;
    readonly registrationEndpoint: string | null;
    readonly scopesSupported: readonly string[];
    readonly grantTypesSupported: readonly string[];
    readonly codeChallengeMethodsSupported: readonly string[];
    readonly tokenEndpointAuthMethodsSupported: readonly string[];
}
export interface DiscoveredOAuthConfiguration {
    readonly server: DiscoveredAuthorizationServer;
    readonly resourceScopes: readonly string[];
}
export interface DiscoverAuthorizationServerInput {
    readonly resourceUrl: string;
    readonly wwwAuthenticate?: string;
    /** Permit origin-wide metadata only after exhausting the path-scoped issuer candidates. */
    readonly allowOriginFallback?: boolean;
    readonly timeoutMs?: number;
    /** Issuer binding is enabled unless the host explicitly selects "none". */
    readonly metadataPolicy?: OAuthDiscoveryPolicy | "none";
}
function readAuthParam(wwwAuthenticate: string, name: string): string | null {
    const match = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,"]+))`, "i").exec(wwwAuthenticate);
    const value = match?.[1] ?? match?.[2];
    return value !== undefined && value.trim() !== "" ? value.trim() : null;
}
export function parseResourceMetadataUrl({ wwwAuthenticate }: {
    readonly wwwAuthenticate: string;
}): string | null {
    return readAuthParam(wwwAuthenticate, "resource_metadata");
}
export function parseWwwAuthenticateScopes({ wwwAuthenticate }: {
    readonly wwwAuthenticate: string;
}): readonly string[] {
    const scope = readAuthParam(wwwAuthenticate, "scope");
    return scope === null ? [] : scope.split(/[\s,]+/).filter((part) => part.length > 0);
}
async function fetchMetadataDocument(deps: OAuthDiscoveryDeps, url: URL, timeoutMs: number): Promise<Record<string, unknown>> {
    url = deps.guard.assertSafeUrl({
        raw: url.href,
        label: "OAuth metadata endpoint"
    });
    const fetchFn = deps.fetchFn;
    let response: Response;
    try {
        response = await fetchFn({
            url: url.toString()
        }, {
            method: "GET",
            headers: { accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (cause) {
        throw new OAuthError({
            code: "OAUTH_PROVIDER_UNREACHABLE", message: `could not reach the OAuth metadata endpoint at ${url.host}`,
            operatorAction: "Check network access to this server, then try connecting again."
        }, {
            cause
        });
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new OAuthError({
            code: "OAUTH_PROVIDER_REJECTED", message: `the OAuth metadata endpoint answered HTTP ${response.status}`,
            operatorAction: "This server publishes no OAuth metadata at that location."
        });
    }
    return readBoundedOAuthJson(response, METADATA_MESSAGES);
}
function issuerPathSuffix(url: URL): string {
    return url.pathname.replace(/\/+$/, "");
}
function authorizationServerMetadataCandidates(issuer: URL, allowOriginFallback: boolean): readonly URL[] {
    // Providers differ in which discovery layout they publish: try RFC 8414's path insertion,
    // OIDC layouts, exhausting path candidates before failing. Origin-wide fallbacks require
    // explicit opt-in so tenant-specific discovery cannot silently select another issuer.
    const suffix = issuerPathSuffix(issuer);
    const candidates = [
        new URL(`/.well-known/oauth-authorization-server${suffix}`, issuer),
        new URL(`/.well-known/openid-configuration${suffix}`, issuer),
    ];
    if (suffix !== "")
        candidates.push(new URL(`${suffix}/.well-known/openid-configuration`, issuer));
    if (suffix !== "" && allowOriginFallback) {
        candidates.push(new URL('/.well-known/oauth-authorization-server', issuer));
        candidates.push(new URL('/.well-known/openid-configuration', issuer));
    }
    return candidates;
}
function protectedResourceMetadataCandidates(resource: URL): readonly URL[] {
    // RFC 9728 places the resource path after the well-known segment. Also try the bare root
    // location because some servers publish no path-specific protected-resource document.
    const suffix = issuerPathSuffix(resource);
    const candidates = [new URL(`/.well-known/oauth-protected-resource${suffix}`, resource)];
    if (suffix !== "")
        candidates.push(new URL("/.well-known/oauth-protected-resource", resource));
    return candidates;
}
function readDiscoveredEndpoint(document: Record<string, unknown>, key: string, label: string, guard: OAuthUrlGuard): string | null {
    const raw = readOptionalString(document[key]);
    if (raw === null)
        return null;
    assertSafeProviderEndpoint(raw, label, guard);
    return raw;
}
function narrowAuthorizationServerMetadata(document: Record<string, unknown>, fallbackIssuer: string, guard: OAuthUrlGuard): DiscoveredAuthorizationServer | null {
    const tokenEndpoint = readDiscoveredEndpoint(document, "token_endpoint", "discovered token endpoint", guard);
    if (tokenEndpoint === null)
        return null;
    return {
        issuer: readOptionalString(document.issuer) ?? fallbackIssuer,
        authorizationEndpoint: readDiscoveredEndpoint(document, "authorization_endpoint", "discovered authorization endpoint", guard),
        tokenEndpoint,
        deviceAuthorizationEndpoint: readDiscoveredEndpoint(document, "device_authorization_endpoint", "discovered device authorization endpoint", guard),
        registrationEndpoint: readDiscoveredEndpoint(document, "registration_endpoint", "discovered registration endpoint", guard),
        scopesSupported: readStringArray(document.scopes_supported),
        grantTypesSupported: readStringArray(document.grant_types_supported),
        codeChallengeMethodsSupported: readStringArray(document.code_challenge_methods_supported),
        tokenEndpointAuthMethodsSupported: readStringArray(document.token_endpoint_auth_methods_supported),
    };
}
function isTerminalDiscoveryFailure(error: unknown): error is OAuthError {
    return error instanceof OAuthError && (error.code === "OAUTH_UNSAFE_ENDPOINT" || error.code === "OAUTH_MALFORMED_RESPONSE");
}
function noMetadataError(host: string): OAuthError {
    return new OAuthError({
        code: "OAUTH_INVALID_REQUEST", message: `no OAuth authorization server metadata could be discovered for ${host}`,
        operatorAction: "This server publishes no OAuth discovery document — type its OAuth endpoints in the connection settings."
    });
}
/** Fetches bounded metadata candidates and binds the issuer by default before narrowing.
 * Policy failures are terminal; explicit metadataPolicy: "none" retains unbound discovery.
 * @throws OAuthError for unsafe metadata/endpoints, malformed responses or absent metadata.
 * @complexity O(c * b) time/space-bounded parsing for c fixed candidates and b bounded bytes.
 * @example fetchAuthorizationServerMetadata({ fetchFn, guard, issuer }, {})
 */
export async function fetchAuthorizationServerMetadata(requiredArgs: OAuthDiscoveryDeps & {
    readonly issuer: string;
}, optionalArgs: {
    readonly timeoutMs?: number;
    /** Issuer binding is enabled unless the host explicitly selects "none". */
    readonly metadataPolicy?: OAuthDiscoveryPolicy | "none";
    readonly allowOriginFallback?: boolean;
} = {}): Promise<DiscoveredAuthorizationServer> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, issuer: requiredArgs.issuer };
    const issuer = assertSafeProviderEndpoint(input.issuer, "authorization server issuer", deps.guard);
    const timeoutMs = input.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
    const metadataPolicy = input.metadataPolicy === "none" ? null : (input.metadataPolicy ?? createIssuerBoundDiscoveryPolicy({}));
    for (const candidate of authorizationServerMetadataCandidates(issuer, input.allowOriginFallback === true)) {
        let document: Record<string, unknown>;
        try {
            document = await fetchMetadataDocument(deps, candidate, timeoutMs);
        }
        catch (error) {
            if (isTerminalDiscoveryFailure(error))
                throw error;
            continue;
        }
        metadataPolicy?.assertMetadata({ issuer: input.issuer, document });
        const narrowed = narrowAuthorizationServerMetadata(document, input.issuer, deps.guard);
        if (narrowed !== null)
            return narrowed;
    }
    throw noMetadataError(issuer.host);
}
export interface DiscoveredProtectedResource {
    readonly resource: string | null;
    readonly authorizationServers: readonly string[];
    readonly scopesSupported: readonly string[];
}
export async function discoverProtectedResourceMetadata(requiredArgs: OAuthDiscoveryDeps & {
    readonly resourceUrl: string;
}, optionalArgs: {
    readonly wwwAuthenticate?: string;
    readonly timeoutMs?: number;
} = {}): Promise<DiscoveredProtectedResource | null> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, resourceUrl: requiredArgs.resourceUrl };
    const resource = assertSafeProviderEndpoint(input.resourceUrl, "protected resource URL", deps.guard);
    const timeoutMs = input.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
    const advertised = input.wwwAuthenticate === undefined ? null : parseResourceMetadataUrl({
        wwwAuthenticate: input.wwwAuthenticate
    });
    const candidates = advertised === null
        ? protectedResourceMetadataCandidates(resource)
        : [assertSafeProviderEndpoint(advertised, "protected resource metadata endpoint", deps.guard)];
    for (const candidate of candidates) {
        let document: Record<string, unknown>;
        try {
            document = await fetchMetadataDocument(deps, candidate, timeoutMs);
        }
        catch (error) {
            if (isTerminalDiscoveryFailure(error))
                throw error;
            continue;
        }
        return {
            resource: readOptionalString(document.resource),
            authorizationServers: readStringArray(document.authorization_servers),
            scopesSupported: readStringArray(document.scopes_supported),
        };
    }
    return null;
}
function safeIssuerCandidates(advertised: readonly string[], guard: OAuthUrlGuard): readonly string[] {
    return advertised.filter((issuer) => {
        try {
            assertSafeProviderEndpoint(issuer, "authorization server issuer", guard);
            return true;
        }
        catch {
            return false;
        }
    });
}
function resolveResourceScopes(wwwAuthenticate: string | undefined, metadata: DiscoveredProtectedResource | null): readonly string[] {
    const challengeScopes = wwwAuthenticate === undefined ? [] : parseWwwAuthenticateScopes({
        wwwAuthenticate: wwwAuthenticate
    });
    return challengeScopes.length > 0 ? challengeScopes : (metadata?.scopesSupported ?? []);
}
function resolveIssuerCandidates(metadata: DiscoveredProtectedResource | null, resourceOrigin: string, guard: OAuthUrlGuard): readonly string[] {
    // Stand-alone providers often host the resource and authorization server at the same origin;
    // use that convention when no advertised candidate survives, still validating discovery URLs.
    const advertised = safeIssuerCandidates(metadata?.authorizationServers ?? [], guard);
    return advertised.length > 0 ? advertised : [resourceOrigin];
}
async function fetchFirstAuthorizationServer(deps: OAuthDiscoveryDeps, issuers: readonly string[], timeoutMs: number, resourceHost: string, metadataPolicy?: OAuthDiscoveryPolicy | "none", allowOriginFallback = false): Promise<DiscoveredAuthorizationServer> {
    for (const issuer of issuers) {
        try {
            return await fetchAuthorizationServerMetadata({
                ...deps,
                issuer
            }, {
                timeoutMs,
                ...(metadataPolicy === undefined ? {} : { metadataPolicy }), allowOriginFallback
            });
        }
        catch (error) {
            if (isTerminalDiscoveryFailure(error))
                throw error;
        }
    }
    throw noMetadataError(resourceHost);
}
export async function discoverAuthorizationServer(requiredArgs: OAuthRequiredArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput>, optionalArgs: OAuthOptionalArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput> = {}): Promise<DiscoveredOAuthConfiguration> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, resourceUrl: requiredArgs.resourceUrl };
    const resource = assertSafeProviderEndpoint(input.resourceUrl, "protected resource URL", deps.guard);
    const timeoutMs = input.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
    const metadata = await discoverProtectedResourceMetadata({
        ...deps,
        resourceUrl: input.resourceUrl
    }, {
        ...(input.wwwAuthenticate === undefined ? {} : { wwwAuthenticate: input.wwwAuthenticate }),
        timeoutMs
    });
    const resourceScopes = resolveResourceScopes(input.wwwAuthenticate, metadata);
    const issuers = resolveIssuerCandidates(metadata, resource.origin, deps.guard);
    const server = await fetchFirstAuthorizationServer(deps, issuers, timeoutMs, resource.host, input.metadataPolicy, input.allowOriginFallback);
    return { server, resourceScopes };
}
