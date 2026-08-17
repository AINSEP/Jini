import type { VisitorAuthProtocol, VisitorAuthProviderDefinition } from './definitions.js';

export interface VisitorAuthClientSecretRef {
  /** Opaque host-owned handle. Never a plaintext secret. */
  readonly id: string;
}

export interface VisitorAuthClientRegistration {
  readonly tenantId: string;
  readonly providerId: string;
  readonly clientId: string;
  readonly clientSecretRef?: VisitorAuthClientSecretRef;
}

/** Resolves public client metadata plus an opaque reference to sealed secret material. */
export interface VisitorAuthClientRegistrationPort {
  resolve(required: {
    readonly tenantId: string;
    readonly providerId: string;
  }): Promise<VisitorAuthClientRegistration | undefined>;
}

export interface VisitorAuthAuthorizationServer {
  readonly providerId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly issuer?: string;
  readonly supportsPkceS256: boolean;
  /** RFC 9207 response issuer is required when the adapter advertises it. */
  readonly requiresAuthorizationResponseIssuer?: boolean;
}

/** Resolves trusted, host-pinned server metadata; it is not user-supplied callback data. */
export interface VisitorAuthAuthorizationServerPort {
  resolve(required: {
    readonly provider: VisitorAuthProviderDefinition;
  }): Promise<VisitorAuthAuthorizationServer>;
}

export interface VisitorAuthSecurityArtifacts {
  readonly state: string;
  readonly nonce?: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/** CSPRNG and SHA-256 seam. Implementations must generate fresh artifacts per attempt. */
export interface VisitorAuthSecurityPort {
  createAuthorizationArtifacts(required: {
    readonly protocol: VisitorAuthProtocol;
  }): Promise<VisitorAuthSecurityArtifacts>;
}

export interface VisitorAuthTransaction {
  readonly tenantId: string;
  readonly providerId: string;
  /** Host-minted binding to the initiating browser/session; carries no authority itself. */
  readonly flowBinding: string;
  readonly protocol: VisitorAuthProtocol;
  readonly state: string;
  readonly nonce?: string;
  /** Sensitive PKCE material: stores must seal this value and never log it. */
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecretRef?: VisitorAuthClientSecretRef;
  readonly tokenEndpoint: string;
  readonly expectedIssuer?: string;
  readonly requiresAuthorizationResponseIssuer: boolean;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * One-time transaction persistence. `consume` must atomically remove or mark
 * the tenant-scoped state as consumed before returning it, including on a
 * later callback rejection, so concurrent/replayed callbacks cannot reuse it.
 */
export interface VisitorAuthTransactionStorePort {
  save(required: { readonly transaction: VisitorAuthTransaction }): Promise<void>;
  consume(required: {
    readonly tenantId: string;
    readonly state: string;
  }): Promise<VisitorAuthTransaction | undefined>;
}

export interface VisitorAuthTokenExchangeRequest {
  readonly tenantId: string;
  readonly providerId: string;
  readonly clientId: string;
  readonly clientSecretRef?: VisitorAuthClientSecretRef;
  readonly tokenEndpoint: string;
  readonly authorizationCode: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface VisitorAuthTokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresInSeconds?: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly grantedScopes?: readonly string[];
}

/** Provider adapter seam; core lifecycle logic never dereferences secret handles or performs HTTP. */
export interface VisitorAuthTokenExchangePort {
  exchange(required: VisitorAuthTokenExchangeRequest): Promise<VisitorAuthTokenSet>;
  refresh(required: {
    readonly tenantId: string;
    readonly providerId: string;
    readonly clientId: string;
    readonly clientSecretRef?: VisitorAuthClientSecretRef;
    readonly refreshToken: string;
  }): Promise<VisitorAuthTokenSet>;
  revoke(required: {
    readonly tenantId: string;
    readonly providerId: string;
    readonly token: string;
  }): Promise<void>;
}

export interface VisitorAuthVerifiedIdTokenClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string | readonly string[];
  readonly authorizedParty?: string;
  readonly expiresAtSeconds: number;
  readonly nonce?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
}

/**
 * Cryptographic verification seam. It must verify signature, algorithm,
 * trusted key provenance, and token shape before returning these claims.
 */
export interface VisitorAuthIdTokenVerifierPort {
  verify(required: {
    readonly providerId: string;
    readonly idToken: string;
    readonly expectedIssuer: string;
  }): Promise<VisitorAuthVerifiedIdTokenClaims>;
}
