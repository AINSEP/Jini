import type { ISODateTime } from '@jini-ai/core/primitives';
/** OAuth value types and required effect boundaries. No host or vendor types enter this module. */

export type OAuthGrantKind = "authorization_code" | "device_code";
export type OAuthClientAuthMethod = "none" | "client_secret_post" | "client_secret_basic";
/** A provider declares endpoints and grant capability; it contains no client or token secrets. */
export interface OAuthProviderDescriptor {
    readonly providerId: string;
    readonly label: string;
    readonly supportedGrants: readonly OAuthGrantKind[];
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint: string;
    readonly deviceAuthorizationEndpoint?: string;
    readonly defaultScopes: readonly string[];
    readonly usesPkce: boolean;
    readonly clientAuth: OAuthClientAuthMethod;
}
/** Per-request identity: explicit public, POST-secret or HTTP Basic authentication. */
export interface OAuthClient {
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly authMethod: OAuthClientAuthMethod;
}
/** Normalized token set. Expiry is absolute; null means the provider gave no lifetime. */
export interface OAuthTokenSet {
    readonly accessToken: string;
    /** Secret; null means the provider did not issue one. */
    readonly refreshToken: string | null;
    readonly tokenType: string;
    readonly scopes: readonly string[];
    readonly expiresAt: ISODateTime | null;
}
/** HTTP port. Must honor redirect refusal, abort signals and the application DNS/egress policy. */
export type OAuthFetch = (requiredArgs: {
    readonly url: string | URL | Request;
}, optionalArgs?: RequestInit) => Promise<Response>;
/** Cryptographic entropy port. Return exactly the requested number of bytes; never use Math.random. */
export type OAuthRandomBytes = (requiredArgs: {
    readonly byteLength: number;
}) => Uint8Array;

/** Application identity is explicit and has no library defaults. */
export interface OAuthAppOptions {
    readonly clientDisplayName: string;
    readonly redirectUris: readonly string[];
    readonly softwareId: string;
}
/** A synchronous URL policy. Connection-time DNS enforcement belongs in the paired fetch port. */
export interface OAuthUrlGuard {
    assertSafeUrl(requiredArgs: {
        readonly raw: string;
        readonly label: string;
    }): URL;
}
/** Required outbound HTTP and safety ports; callers adapt their native fetch to the object contract. */
export interface OAuthHttpPorts {
    readonly fetchFn: OAuthFetch;
    readonly guard: OAuthUrlGuard;
}
/** Injected wait operation used only by the refresh-lease coordinator. */
export type OAuthSleep = (requiredArgs: {
    readonly ms: number;
}) => Promise<void>;
/** RFC 8707 permits multiple resource indicators. These are identifiers, never fetched here. */
export type OAuthResource = string | readonly string[];
/** Application-owned token persistence, durable status transitions and optional refresh leases. */
export interface OAuthTokenStore {
    load(requiredArgs: {
        readonly key: string;
    }): Promise<OAuthTokenSet | null>;
    persist(requiredArgs: {
        readonly key: string;
        readonly tokens: OAuthTokenSet;
    }): Promise<void>;
    markNeedsReauth(requiredArgs: {
        readonly key: string;
        readonly reason: string;
    }): Promise<void>;
    tryAcquireRefreshLease?(requiredArgs: {
        readonly key: string;
    }): Promise<boolean>;
    releaseRefreshLease?(requiredArgs: {
        readonly key: string;
    }): Promise<void>;
}
/** The refresh operation and its store must use the same connection identity. */
export interface TokenRefreshPort extends OAuthTokenStore {
    refresh(requiredArgs: {
        readonly key: string;
        readonly refreshToken: string;
    }): Promise<OAuthTokenSet>;
}
/** Normalized registration data shared by registration and the host-owned cache. */
export interface RegisteredOAuthClient {
    readonly clientId: string;
    readonly clientSecret: string | null;
    readonly tokenEndpointAuthMethod: OAuthClientAuthMethod;
    readonly registrationClientUri: string | null;
    readonly clientIdIssuedAt: number | null;
    readonly clientSecretExpiresAt: number | null;
}
/** Registration values can contain client secrets; adapters must protect them accordingly. */
export interface ClientRegistrationCache {
    get(requiredArgs: {
        readonly key: string;
    }): Promise<RegisteredOAuthClient | null>;
    set(requiredArgs: {
        readonly key: string;
        readonly client: RegisteredOAuthClient;
    }): Promise<void>;
    delete(requiredArgs: {
        readonly key: string;
    }): Promise<void>;
}
