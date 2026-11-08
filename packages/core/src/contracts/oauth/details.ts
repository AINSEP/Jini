import type { ISODateTime } from '../../primitives/index.js';
import type { OAuthProviderDescriptor } from '../oauth.js';
/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/oauth`. */


export interface DeviceAuthorization {
    readonly deviceCode: string;
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete: string | null;
    readonly expiresAt: ISODateTime;
    readonly intervalSeconds: number;
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
    /** Pass to grant APIs as the RFC 8707 resource; absent when no resource metadata was found. */
    readonly resource?: string | undefined;
}


/** A new registry starts empty. Returned snapshots cannot mutate its stored configuration. */
export interface OAuthProviderRegistry {
    register(requiredArgs: {
        readonly descriptor: OAuthProviderDescriptor;
    }): void;
    list(requiredArgs: OAuthEmptyArgs): readonly OAuthProviderDescriptor[];
    get(requiredArgs: {
        readonly providerId: string;
    }): OAuthProviderDescriptor;
}


export interface AuthorizationCallbackParams {
    readonly state: string;
    readonly code?: string;
    readonly error?: string;
}

/** Explicit input for operations without values or dependencies. */
export type OAuthEmptyArgs = Readonly<Record<string, never>>;
