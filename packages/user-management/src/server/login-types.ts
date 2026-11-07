/** Member-login preset and identity types: what a login-provider contribution declares and what a verified login yields. */
import type { OAuthClientAuthMethod, OidcSigningAlgorithm } from "@jini-ai/oauth";

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

/** Only completeOidcLogin creates this result after cryptographic verification. No raw tokens. */
export interface VerifiedLoginIdentity {
  readonly providerId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
  readonly emailAuthoritative: boolean;
}

export type MemberLoginOutcomeCode = "LOGIN_UNAVAILABLE" | "LOGIN_INVALID" | "LOGIN_BLOCKED" | "LOGIN_CONFLICT";

/** Fixed codes are safe for routes/logging; upstream OAuth exceptions can contain sensitive data. */
export class MemberLoginError extends Error {
  readonly code: MemberLoginOutcomeCode;
  constructor(required: { code: MemberLoginOutcomeCode }, _options = {}) {
    super(required.code);
    this.code = required.code;
    this.name = "MemberLoginError";
  }
}
