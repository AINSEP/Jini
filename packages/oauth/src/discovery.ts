import { discovery, None, allowInsecureRequests, customFetch } from 'openid-client';
import { resourceDiscoveryRequest, processResourceDiscoveryResponse,
    // @ts-expect-error Upstream exports its skip-check sentinel at runtime but omits its public type.
    _nodiscoverycheck,
    customFetch as resourceCustomFetch, allowInsecureRequests as allowInsecureResourceRequests } from 'oauth4webapi';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { MAX_OAUTH_RESPONSE_BYTES, readOptionalString, readStringArray } from './bounded-json.js';
import { createIssuerBoundDiscoveryPolicy, type OAuthDiscoveryPolicy } from './discovery-policy.js';
import { assertOAuthResponseNotRedirect, assertSafeProviderEndpoint } from './endpoint-safety.js';
import { OAuthError } from './errors.js';
import { createOAuthCustomFetch } from './guarded-transport.js';
import type { OAuthHttpPorts, OAuthUrlGuard } from './ports.js';

const DISCOVERY_TIMEOUT_MS = 10000;
export interface OAuthDiscoveryDeps extends OAuthHttpPorts {}
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
    /** Pass to grant APIs as the RFC 8707 resource; absent when no resource metadata was found. */
    readonly resource?: string | undefined;
}
export interface DiscoverAuthorizationServerInput {
    readonly resourceUrl: string;
    readonly wwwAuthenticate?: string;
    /** Origin-wide fallback is opt-in so a tenant cannot silently select another issuer. */
    readonly allowOriginFallback?: boolean;
    readonly timeoutMs?: number;
    readonly metadataPolicy?: OAuthDiscoveryPolicy | 'none';
}
export interface DiscoveredProtectedResource {
    readonly resource: string | null;
    readonly authorizationServers: readonly string[];
    readonly scopesSupported: readonly string[];
}
function readAuthParam(wwwAuthenticate: string, name: string): string | null {
    const match = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,"]+))`, 'i').exec(wwwAuthenticate);
    return (match?.[1] ?? match?.[2])?.trim() || null;
}
export function parseResourceMetadataUrl({ wwwAuthenticate }: { readonly wwwAuthenticate: string }): string | null {
    return readAuthParam(wwwAuthenticate, 'resource_metadata');
}
export function parseWwwAuthenticateScopes({ wwwAuthenticate }: { readonly wwwAuthenticate: string }): readonly string[] {
    return readAuthParam(wwwAuthenticate, 'scope')?.split(/[\s,]+/).filter(Boolean) ?? [];
}

/** Upstream owns document processing; the host selects candidates and binds the original issuer. */
async function fetchMetadataDocument({ deps, candidate, timeoutMs }: {
    readonly deps: OAuthDiscoveryDeps; readonly candidate: URL; readonly timeoutMs: number;
}, { resource }: { readonly resource?: URL } = {}): Promise<Record<string, unknown>> {
    const fetch = createOAuthCustomFetch({
        ...deps, timeoutMs, endpointLabel: 'OAuth metadata endpoint', responseMessages: {
            overflowMessage: `the OAuth metadata document exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: "This server's OAuth metadata endpoint is not behaving like an RFC 8414 endpoint.",
        },
        fetchFn: async (args, options) => {
            const response = await deps.fetchFn(args, options);
            // Refuse redirects before fallback even if an injected port ignores redirect refusal.
            await assertOAuthResponseNotRedirect({ response });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw new OAuthError({ code: 'OAUTH_PROVIDER_REJECTED',
                    message: `the OAuth metadata endpoint answered HTTP ${response.status}`,
                    operatorAction: 'This server publishes no OAuth metadata at that location.' });
            }
            return response;
        },
    });
    try {
        if (resource) {
            // openid-client has no RFC 9728 operation; override only its engine's candidate URL.
            const response = await resourceDiscoveryRequest(resource, {
                [allowInsecureResourceRequests]: resource.protocol === 'http:',
                [resourceCustomFetch]: (_url, options) => fetch(candidate.href, options),
            });
            // MCP permits an origin/path-prefix identifier; discovery validates that binding below.
            return { ...await processResourceDiscoveryResponse(_nodiscoverycheck, response) };
        }
        const config = await discovery(candidate, 'jini-metadata-reader', {}, None(), {
            timeout: Math.ceil(timeoutMs / 1000), [customFetch]: fetch,
            ...(candidate.protocol === 'http:' ? { execute: [allowInsecureRequests] } : {}),
        });
        // Direct-document discovery leaves comparison to the exact/custom/none host policy.
        return { ...config.serverMetadata() };
    } catch {
        if (fetch.failure) throw fetch.failure.error;
        // Upstream causes can retain arbitrary provider data; expose only facade copy.
        throw new OAuthError({ code: 'OAUTH_MALFORMED_RESPONSE',
            message: 'the OAuth metadata endpoint did not return a JSON object',
            operatorAction: 'Check that this server publishes OAuth metadata, or type its endpoints by hand.' });
    }
}
function authorizationServerMetadataCandidates(issuer: URL, allowOriginFallback: boolean): readonly URL[] {
    const suffix = issuer.pathname.replace(/\/+$/, '');
    // Exhaust RFC 8414 and both OIDC path layouts before an explicitly permitted origin fallback.
    const paths = [`/.well-known/oauth-authorization-server${suffix}`, `/.well-known/openid-configuration${suffix}`];
    if (suffix) paths.push(`${suffix}/.well-known/openid-configuration`);
    if (suffix && allowOriginFallback) paths.push('/.well-known/oauth-authorization-server', '/.well-known/openid-configuration');
    return paths.map(path => new URL(path, issuer));
}
function readDiscoveredEndpoint(document: Record<string, unknown>, key: string, guard: OAuthUrlGuard): string | null {
    const endpoint = readOptionalString(document[key]);
    if (endpoint !== null) assertSafeProviderEndpoint(endpoint, `discovered ${key.replaceAll('_', ' ')}`, guard);
    return endpoint;
}
function isTerminalDiscoveryFailure(error: unknown): error is OAuthError {
    return error instanceof OAuthError && (error.code === 'OAUTH_UNSAFE_ENDPOINT' || error.code === 'OAUTH_MALFORMED_RESPONSE'
        || error.code === 'OAUTH_RESOURCE_MISMATCH');
}

/** Bind parsed metadata like MCP's checkResourceAllowed, including path-segment boundaries.
 * Throws a typed failure without echoing provider data. No I/O; O(URL length) time/space.
 */
function assertResourceAllowed({ resource, advertisedResource }: { resource: URL; advertisedResource: string }): void {
    let advertised: URL;
    try { advertised = new URL(advertisedResource); }
    catch {
        throw new OAuthError({ code: 'OAUTH_MALFORMED_RESPONSE',
            message: 'the protected resource metadata contains an invalid resource URL',
            operatorAction: 'Check the resource URL published by this server.' });
    }
    const resourcePath = resource.pathname.endsWith('/') ? resource.pathname : `${resource.pathname}/`;
    const advertisedPath = advertised.pathname.endsWith('/') ? advertised.pathname : `${advertised.pathname}/`;
    // A bare string prefix would wrongly allow /api to stand for /api-other.
    if (resource.origin !== advertised.origin || resource.pathname.length < advertised.pathname.length
        || !resourcePath.startsWith(advertisedPath)) {
        throw new OAuthError({ code: 'OAUTH_RESOURCE_MISMATCH',
            message: 'the protected resource metadata names a different server or path',
            operatorAction: 'Check that this connection uses the server URL covered by its OAuth metadata.' });
    }
}
function noMetadataError(host: string): OAuthError {
    return new OAuthError({ code: 'OAUTH_INVALID_REQUEST',
        message: `no OAuth authorization server metadata could be discovered for ${host}`,
        operatorAction: 'This server publishes no OAuth discovery document — type its OAuth endpoints in the connection settings.' });
}
export async function fetchAuthorizationServerMetadata(requiredArgs: OAuthDiscoveryDeps & {
    readonly issuer: string;
}, optionalArgs: {
    readonly timeoutMs?: number;
    /** Issuer binding is enabled unless the host explicitly selects "none". */
    readonly metadataPolicy?: OAuthDiscoveryPolicy | 'none';
    readonly allowOriginFallback?: boolean;
} = {}): Promise<DiscoveredAuthorizationServer> {
    const issuer = assertSafeProviderEndpoint(requiredArgs.issuer, 'authorization server issuer', requiredArgs.guard);
    const policy = optionalArgs.metadataPolicy === 'none' ? null : optionalArgs.metadataPolicy ?? createIssuerBoundDiscoveryPolicy({});
    for (const candidate of authorizationServerMetadataCandidates(issuer, optionalArgs.allowOriginFallback === true)) {
        let document: Record<string, unknown>;
        try {
            document = await fetchMetadataDocument({ deps: requiredArgs, candidate, timeoutMs: optionalArgs.timeoutMs ?? DISCOVERY_TIMEOUT_MS });
        } catch (error) {
            if (isTerminalDiscoveryFailure(error)) throw error;
            continue;
        }
        // A policy failure is terminal and sees the unmodified document, before facade narrowing.
        policy?.assertMetadata({ issuer: requiredArgs.issuer, document });
        const server = projectAuthorizationServerMetadata({ document, requiredArgs });
        if (server !== null) return server;
    }
    throw noMetadataError(issuer.host);
}
export async function discoverProtectedResourceMetadata(requiredArgs: OAuthDiscoveryDeps & {
    readonly resourceUrl: string;
}, optionalArgs: { readonly wwwAuthenticate?: string; readonly timeoutMs?: number } = {}): Promise<DiscoveredProtectedResource | null> {
    const resource = assertSafeProviderEndpoint(requiredArgs.resourceUrl, 'protected resource URL', requiredArgs.guard);
    const advertised = optionalArgs.wwwAuthenticate === undefined ? null : parseResourceMetadataUrl({ wwwAuthenticate: optionalArgs.wwwAuthenticate });
    const suffix = resource.pathname.replace(/\/+$/, '');
    // RFC 9728 inserts the path after the well-known segment. Retain the root fallback.
    const candidates = advertised === null
        ? [...new Set([`/.well-known/oauth-protected-resource${suffix}`, '/.well-known/oauth-protected-resource'])].map(path => new URL(path, resource))
        : [assertSafeProviderEndpoint(advertised, 'protected resource metadata endpoint', requiredArgs.guard)];
    for (const candidate of candidates) {
        try {
            const document = await fetchMetadataDocument({ deps: requiredArgs, candidate,
                timeoutMs: optionalArgs.timeoutMs ?? DISCOVERY_TIMEOUT_MS }, { resource });
            // Upstream already requires a non-empty resource string. Keep the advertised spelling
            // for RFC 8707 instead of replacing the audience with the transport endpoint's path.
            const advertisedResource = document.resource as string;
            assertResourceAllowed({ resource, advertisedResource });
            return { resource: advertisedResource,
                authorizationServers: readStringArray(document.authorization_servers), scopesSupported: readStringArray(document.scopes_supported) };
        } catch (error) {
            if (isTerminalDiscoveryFailure(error)) throw error;
        }
    }
    return null;
}
export async function discoverAuthorizationServer(requiredArgs: OAuthRequiredArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput>, optionalArgs: OAuthOptionalArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput> = {}): Promise<DiscoveredOAuthConfiguration> {
    const resource = assertSafeProviderEndpoint(requiredArgs.resourceUrl, 'protected resource URL', requiredArgs.guard);
    const metadata = await discoverProtectedResourceMetadata(requiredArgs, optionalArgs);
    const scopes = optionalArgs.wwwAuthenticate === undefined ? [] : parseWwwAuthenticateScopes({ wwwAuthenticate: optionalArgs.wwwAuthenticate });
    const resourceScopes = selectResourceScopes({ scopes, metadata });
    const issuers = (metadata?.authorizationServers ?? []).filter(issuer => {
        try { assertSafeProviderEndpoint(issuer, 'authorization server issuer', requiredArgs.guard); return true; }
        catch { return false; }
    });
    // Stand-alone providers often share the resource origin; use it if no safe issuer was advertised.
    for (const issuer of issuers.length > 0 ? issuers : [resource.origin]) {
        try {
            const server = await fetchAuthorizationServerMetadata({ ...requiredArgs, issuer }, optionalArgs);
            return { server, resourceScopes, resource: metadata?.resource ?? undefined };
        } catch (error) {
            if (isTerminalDiscoveryFailure(error)) throw error;
        }
    }
    throw noMetadataError(resource.host);
}

/** Narrow only after the caller has applied issuer policy to the unmodified document. */
function projectAuthorizationServerMetadata({ document, requiredArgs }: {
    document: Record<string, unknown>; requiredArgs: OAuthDiscoveryDeps & { readonly issuer: string };
}): DiscoveredAuthorizationServer | null {
    const tokenEndpoint = readDiscoveredEndpoint(document, 'token_endpoint', requiredArgs.guard);
    if (tokenEndpoint === null) return null;
    return {
        issuer: readOptionalString(document.issuer) ?? requiredArgs.issuer, tokenEndpoint,
        authorizationEndpoint: readDiscoveredEndpoint(document, 'authorization_endpoint', requiredArgs.guard),
        deviceAuthorizationEndpoint: readDiscoveredEndpoint(document, 'device_authorization_endpoint', requiredArgs.guard),
        registrationEndpoint: readDiscoveredEndpoint(document, 'registration_endpoint', requiredArgs.guard),
        scopesSupported: readStringArray(document.scopes_supported), grantTypesSupported: readStringArray(document.grant_types_supported),
        codeChallengeMethodsSupported: readStringArray(document.code_challenge_methods_supported),
        tokenEndpointAuthMethodsSupported: readStringArray(document.token_endpoint_auth_methods_supported),
    };
}

function selectResourceScopes({ scopes, metadata }: {
    scopes: readonly string[]; metadata: DiscoveredProtectedResource | null;
}): readonly string[] {
    return scopes.length > 0 ? scopes : metadata?.scopesSupported ?? [];
}
