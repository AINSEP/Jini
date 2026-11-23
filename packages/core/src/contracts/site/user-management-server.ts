/**
 * @file Server-side identity seams: a member-login provider and the authentication service's
 * dependency bag.
 *
 * Additive verbatim copy of `LoginProvider`/`LoginProviderPreset` (`server/login-types.ts`),
 * `AuthServiceDeps` (`server/auth-service.ts`) and its small structural closure
 * (`core/runtime-ports.ts`'s `SessionTokenPort`/`UsernameChangePort`, `server/mfa/ports.ts`'s
 * `MfaStore` and scope rows) from `@jini-ai/user-management/server`; user-management keeps its
 * identical declarations and exports until the paired cutover. `IdentityRepos` and
 * `PasswordHasherPort` are referenced from the sibling `user-management` contract rather than
 * copied a second time.
 */
import type { OAuthClientAuthMethod, OidcSigningAlgorithm } from "../oauth.js";
import type { Clock, IdGenerator } from "../../primitives/index.js";
import type { IdentityRepos, PasswordHasherPort } from "./user-management.js";

// ---- Member login (`server/login-types.ts`) ----

/** Immutable, bundled preset. Never construct one from callback claims or site-local plugins. */
export interface LoginProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly scopes: readonly string[];
  readonly signingAlgorithm: OidcSigningAlgorithm;
  readonly clientAuthentication: OAuthClientAuthMethod;
  readonly credentialLabel: string;
  readonly credentialCardTarget: string;
  readonly pkce: "S256";
  readonly authoritativeEmailDomains?: readonly string[];
  readonly hostedDomainClaim?: string;
}

export interface LoginProvider extends LoginProviderPreset {
  readonly pluginId: string;
  /** Fingerprint binds an in-flight redirect to the current preset and client. */
  readonly configurationVersion: string;
}

// ---- Authentication service dependencies (`server/auth-service.ts` and its closure) ----

/** Host-supplied session bearer generation and storage digest strategy. */
export interface SessionTokenPort {
  newToken(required: Record<string, never>): string;
  hashToken(required: { rawToken: string }): string;
}

/** Host lifecycle for renames. Audit writes must join the identity transaction. */
export interface UsernameChangePort {
  /** A host can refuse a rename that its bootstrap identity cannot safely survive. */
  assertSupported?: ((required: { workspaceId: string; principalId: string }, optional?: Record<string, never>) => Promise<void>) | undefined;
  isInTrash(required: { workspaceId: string; principalId: string }, optional?: Record<string, never>): Promise<boolean>;
  record(required: {
    workspaceId: string; principalId: string; callerPrincipalId: string;
    previousUsername: string; username: string; occurredAt: string;
  }, optional?: Record<string, never>): Promise<void>;
}

export type MfaScope = { workspaceId: string; principalId: string };
export type MfaFactor = MfaScope & { sealedSecret: string; lastStep: number };
export type MfaPending = MfaScope & {
  purpose: 'login' | 'enroll' | 'passkey-enroll' | 'passkey-login'; tokenHash: string; expiresAt: number; attempts: number;
  sealedSecret?: string;
};
/** All methods join auth.repos.transactions; at most one pending row per scope/purpose.
 * Mutations and guard reads must serialize with all other identity writers.
 */
export interface MfaStore {
  factor(scope: MfaScope): Promise<MfaFactor | null>;
  saveFactor(factor: MfaFactor): Promise<void>;
  pending(input: { workspaceId: string; tokenHash: string }): Promise<MfaPending | null>;
  savePending(pending: MfaPending): Promise<void>;
  clearPending(scope: MfaScope): Promise<void>;
  clear(scope: MfaScope): Promise<void>;
}

export interface AuthServiceDeps {
  mfaStore?: MfaStore;
  repos: IdentityRepos;
  hasher: PasswordHasherPort;
  clock: Clock;
  idGen: IdGenerator;
  tokens: SessionTokenPort;
  /** Additive: legacy email updates need no rename lifecycle; renames require it. */
  usernameChanges?: UsernameChangePort | undefined;
}
