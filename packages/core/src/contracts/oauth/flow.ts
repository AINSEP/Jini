/**
 * @file Type-only signature closure of the OAuth flow operations, moved from `@jini-ai/oauth`
 * (args.ts, pending-authorizations.ts, sealed-state.ts, authorization-code.ts, token-endpoint.ts,
 * device-code.ts, discovery-policy.ts, discovery.ts, refresh.ts, registration.ts, registry.ts at
 * Jini 6ab1d818) so a consumer can depend on the operations through an injected value without
 * importing the OAuth runtime. `@jini-ai/oauth` re-exports every name it exported before.
 */
import type { Clock, ISODateTime } from '../../primitives/index.js';
import type { DeviceAuthorization, DiscoveredOAuthConfiguration, OAuthEmptyArgs, OAuthProviderRegistry, AuthorizationCallbackParams } from './details.js';
import type { OAuthAppOptions, OAuthClient, OAuthClientAuthMethod, OAuthHttpPorts, OAuthProviderDescriptor, OAuthRandomBytes, OAuthResource,
  OAuthSleep, OAuthTokenSet, OAuthUrlGuard, RegisteredOAuthClient, TokenRefreshPort } from '../oauth.js';

/**
 * Host-replaceable neutral OAuth copy; `@jini-ai/oauth` `defaultOAuthMessages` is the stock value.
 * @agent-note Fulfilled by the host or by `defaultOAuthMessages`; message text never changes protocol identity or error codes.
 */
export interface OAuthMessages {
    readonly reservedAuthorizationParameter: ({ parameter }: { readonly parameter: string }) => string;
    readonly reservedAuthorizationParameterAction: string;
    readonly registrationRejectedAction: string;
}
/** Separate required inputs from optional settings on every public operation. */
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export type OAuthRequiredArgs<T> = Pick<T, {
    [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T]>;
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export type OAuthOptionalArgs<T> = Pick<T, {
    [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T]>;
/** Keep codeVerifier secret and preserve redirectUri and optional resource binding verbatim. */
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface PendingAuthorization {
    readonly state: string;
    readonly ownerKey: string;
    readonly providerId: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
    readonly scopes: readonly string[];
    readonly resource?: OAuthResource;
    readonly createdAt: ISODateTime;
    readonly expiresAt: ISODateTime;
}
/** take must atomically consume across processes and use the same error for every redemption failure. */
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface PendingAuthorizationStore {
    put(requiredArgs: OAuthRequiredArgs<Omit<PendingAuthorization, "state" | "createdAt" | "expiresAt">>, optionalArgs?: OAuthOptionalArgs<Omit<PendingAuthorization, "state" | "createdAt" | "expiresAt">>): Promise<PendingAuthorization>;
    take(input: {
        state: string;
        ownerKey: string;
    }): Promise<PendingAuthorization>;
    size(requiredArgs: OAuthEmptyArgs): Promise<number>;
}
/** Host adapter uses its existing authenticated sealer and context AAD; no crypto lives here. */
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface AuthorizationStateCodec {
    seal(requiredArgs: { plaintext: string }, optionalArgs?: Record<string, never>): Promise<string>;
    open(requiredArgs: { state: string }, optionalArgs?: Record<string, never>): Promise<string>;
}
type AuthorizationEntry = Omit<PendingAuthorization, 'state' | 'createdAt' | 'expiresAt'>;
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface SealedAuthorizationState {
    seal(requiredArgs: { entry: AuthorizationEntry }, optionalArgs?: Record<string, never>): Promise<PendingAuthorization>;
    open(requiredArgs: { state: string; ownerKey: string; providerId: string; redirectUri: string }, optionalArgs?: Record<string, never>): Promise<PendingAuthorization>;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface BeginAuthorizationCodeDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
    readonly randomBytesFn: OAuthRandomBytes;
    readonly guard: OAuthUrlGuard;
    readonly options: OAuthAppOptions;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface BeginAuthorizationCodeInput {
    readonly messages?: OAuthMessages;
    readonly ownerKey: string;
    readonly client: OAuthClient;
    readonly redirectUri: string;
    readonly resource?: OAuthResource;
    readonly scopes?: readonly string[];
    readonly extraAuthorizationParams?: Readonly<Record<string, string>>;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface BeginAuthorizationCodeResult {
    readonly authorizationUrl: string;
    readonly state: string;
    readonly expiresAt: string;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export type BeginAuthorizationCodeArgs = OAuthRequiredArgs<Omit<BeginAuthorizationCodeDeps, 'pending'> & BeginAuthorizationCodeInput>
    & ({ pending: PendingAuthorizationStore } | { stateless: SealedAuthorizationState });
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface CompleteAuthorizationCodeDeps extends TokenRequestDeps {
    readonly provider: OAuthProviderDescriptor;
    readonly pending: PendingAuthorizationStore;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface CompleteAuthorizationCodeInput {
    readonly ownerKey: string;
    readonly client: OAuthClient;
    readonly params: AuthorizationCallbackParams;
    readonly timeoutMs?: number;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export type CompleteAuthorizationCodeArgs = OAuthRequiredArgs<Omit<CompleteAuthorizationCodeDeps, 'pending'> & CompleteAuthorizationCodeInput>
    & ({ pending: PendingAuthorizationStore } | { stateless: SealedAuthorizationState; redirectUri: string });
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface TokenRequestDeps extends OAuthHttpPorts { readonly clock: Clock }
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface DeviceAuthorizationDeps extends OAuthHttpPorts {
    readonly provider: OAuthProviderDescriptor;
    readonly clock: Clock;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface BeginDeviceAuthorizationInput {
    readonly resource?: OAuthResource;
    readonly client: OAuthClient;
    readonly scopes?: readonly string[];
    readonly timeoutMs?: number;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface PollDeviceAuthorizationInput {
    readonly resource?: OAuthResource;
    readonly client: OAuthClient;
    readonly deviceCode: string;
    readonly expiresAt: ISODateTime;
    readonly timeoutMs?: number;
}
/** A host chooses its metadata trust policy separately from its outbound URL policy. */
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface OAuthDiscoveryPolicy {
  assertMetadata(requiredArgs: { issuer: string; document: Readonly<Record<string, unknown>> }): void;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface OAuthDiscoveryDeps extends OAuthHttpPorts {}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface DiscoverAuthorizationServerInput {
    readonly resourceUrl: string;
    readonly wwwAuthenticate?: string;
    /** Origin-wide fallback is opt-in so a tenant cannot silently select another issuer. */
    readonly allowOriginFallback?: boolean;
    readonly timeoutMs?: number;
    readonly metadataPolicy?: OAuthDiscoveryPolicy | 'none';
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface TokenRefresherDeps {
    readonly clock: Clock;
    readonly port: TokenRefreshPort;
    readonly refreshSkewMs?: number;
    readonly leaseWaitMs?: number;
    readonly leasePollMs?: number;
    readonly sleep: OAuthSleep;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface TokenRefresher {
    getAccessToken(requiredArgs: {
        readonly key: string;
    }): Promise<string>;
    inFlightCount(requiredArgs: OAuthEmptyArgs): number;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface RefreshAccessTokenInput {
    readonly tokenEndpoint: string;
    readonly client: OAuthClient;
    readonly refreshToken: string;
    readonly scopes?: readonly string[];
    readonly resource?: OAuthResource;
    readonly timeoutMs?: number;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface DynamicClientRegistrationDeps extends OAuthHttpPorts {
    readonly options: OAuthAppOptions;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface DynamicClientRegistrationInput {
    readonly messages?: OAuthMessages;
    readonly registrationEndpoint: string;
    readonly scopes: readonly string[];
    readonly grantTypes?: readonly string[];
    readonly responseTypes?: readonly string[];
    readonly tokenEndpointAuthMethod?: OAuthClientAuthMethod;
    readonly authMethodsSupported?: readonly string[];
    readonly initialAccessToken?: string;
    readonly timeoutMs?: number;
}
/** @agent-note Moved from `@jini-ai/oauth` unchanged (it re-exports this name); part of the `OAuthFlowOperations` signature closure, fulfilled by `@jini-ai/oauth` or a conforming host implementation. */
export interface OperatorOAuthProviderInput {
    readonly providerId: string;
    readonly label: string;
    readonly tokenEndpoint: string;
    readonly authorizationEndpoint?: string;
    readonly deviceAuthorizationEndpoint?: string;
    readonly scopes?: readonly string[];
    readonly clientAuth?: OAuthProviderDescriptor["clientAuth"];
}

/**
 * The eleven OAuth flow operations a host binds as ONE value (`@jini-ai/oauth` `oauthFlowOperations`).
 * @agent-note Fulfilled by the host from `@jini-ai/oauth`'s `oauthFlowOperations` (one value per composition, `satisfies` this type);
 * consumers call only the members they need and never re-implement PKCE, state, pending storage or refresh leases. Errors thrown
 * are the OAuth package's real `OAuthError` instances (identity, codes and retryability preserved); classify them only through a
 * host-injected classifier bound to that class.
 */
export interface OAuthFlowOperations {
    beginAuthorizationCode(requiredArgs: BeginAuthorizationCodeArgs, optionalArgs?: OAuthOptionalArgs<BeginAuthorizationCodeDeps & BeginAuthorizationCodeInput>): Promise<BeginAuthorizationCodeResult>;
    beginDeviceAuthorization(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput>, optionalArgs?: OAuthOptionalArgs<DeviceAuthorizationDeps & BeginDeviceAuthorizationInput>): Promise<DeviceAuthorization>;
    buildOperatorOAuthProvider(requiredArgs: OAuthRequiredArgs<OperatorOAuthProviderInput> & { readonly guard: OAuthUrlGuard }, optionalArgs?: OAuthOptionalArgs<OperatorOAuthProviderInput>): OAuthProviderDescriptor;
    completeAuthorizationCode(requiredArgs: CompleteAuthorizationCodeArgs, optionalArgs?: OAuthOptionalArgs<CompleteAuthorizationCodeDeps & CompleteAuthorizationCodeInput>): Promise<OAuthTokenSet>;
    createSealedAuthorizationState(requiredArgs: { clock: Clock; codec: AuthorizationStateCodec; workspaceId: string; serverId: string }, optionalArgs?: { principalId?: string }): SealedAuthorizationState;
    createTokenRefresher(deps: OAuthRequiredArgs<TokenRefresherDeps>, optionalArgs?: OAuthOptionalArgs<TokenRefresherDeps>): TokenRefresher;
    discoverAuthorizationServer(requiredArgs: OAuthRequiredArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput>, optionalArgs?: OAuthOptionalArgs<OAuthDiscoveryDeps & DiscoverAuthorizationServerInput>): Promise<DiscoveredOAuthConfiguration>;
    createOAuthProviderRegistry(deps: { readonly guard: OAuthUrlGuard }): OAuthProviderRegistry;
    refreshAccessToken(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & RefreshAccessTokenInput>, optionalArgs?: OAuthOptionalArgs<TokenRequestDeps & RefreshAccessTokenInput>): Promise<OAuthTokenSet>;
    pollDeviceAuthorizationOnce(requiredArgs: OAuthRequiredArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput>, optionalArgs?: OAuthOptionalArgs<DeviceAuthorizationDeps & TokenRequestDeps & PollDeviceAuthorizationInput>): Promise<OAuthTokenSet>;
    registerOAuthClientDynamically(requiredArgs: OAuthRequiredArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput>, optionalArgs?: OAuthOptionalArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput>): Promise<RegisteredOAuthClient>;
}
