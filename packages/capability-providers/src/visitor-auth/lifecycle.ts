import type { VisitorAuthProviderDefinition } from './definitions.js';
import type {
  VisitorAuthAuthorizationServer,
  VisitorAuthClientRegistration,
  VisitorAuthSecurityArtifacts,
  VisitorAuthTokenExchangeRequest,
  VisitorAuthTransaction,
  VisitorAuthVerifiedIdTokenClaims,
} from './ports.js';

const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const MAX_TRANSACTION_TTL_MS = 15 * 60 * 1000;
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const OPAQUE_SECURITY_VALUE = /^[A-Za-z0-9._~-]{32,512}$/;
const SAFE_PROVIDER_ERROR = /^[A-Za-z0-9._-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const RESERVED_AUTHORIZATION_PARAMETERS = new Set([
  'client_id',
  'code_challenge',
  'code_challenge_method',
  'nonce',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
]);

export type VisitorAuthConfigurationErrorCode =
  | 'invalid-input'
  | 'insecure-url'
  | 'provider-mismatch'
  | 'pkce-s256-required'
  | 'reserved-parameter';

export class VisitorAuthConfigurationError extends Error {
  readonly code: VisitorAuthConfigurationErrorCode;

  constructor(code: VisitorAuthConfigurationErrorCode, message: string) {
    super(message);
    this.name = 'VisitorAuthConfigurationError';
    this.code = code;
  }
}

export interface VisitorAuthAuthorizationPlan {
  readonly authorizationUrl: string;
  readonly transaction: VisitorAuthTransaction;
}

function parsedSecureUrl(value: string, label: string, allowLoopbackHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VisitorAuthConfigurationError('invalid-input', `${label} must be an absolute URL`);
  }

  const secure = isSecureProtocol(url, allowLoopbackHttp);
  if (!secure || url.username || url.password || url.hash) {
    throw new VisitorAuthConfigurationError(
      'insecure-url',
      `${label} must use HTTPS without credentials or a fragment`,
    );
  }
  return url;
}

function isSecureProtocol(url: URL, allowLoopbackHttp: boolean): boolean {
  if (url.protocol === 'https:') return true;
  return allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new VisitorAuthConfigurationError('invalid-input', `${label} must not be empty`);
  }
}

function assertProviderAlignment(required: {
  readonly provider: VisitorAuthProviderDefinition;
  readonly server: VisitorAuthAuthorizationServer;
  readonly registration: VisitorAuthClientRegistration;
}): void {
  if (
    required.provider.id !== required.server.providerId ||
    required.provider.id !== required.registration.providerId
  ) {
    throw new VisitorAuthConfigurationError(
      'provider-mismatch',
      'provider definition, authorization server, and client registration must match',
    );
  }
}

function validatedTransactionTtl(ttlMs: number | undefined): number {
  const resolved = ttlMs ?? DEFAULT_TRANSACTION_TTL_MS;
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > MAX_TRANSACTION_TTL_MS) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      `ttlMs must be an integer between 1 and ${MAX_TRANSACTION_TTL_MS}`,
    );
  }
  return resolved;
}

function assertPlanContext(required: {
  readonly registration: VisitorAuthClientRegistration;
  readonly flowBinding: string;
  readonly nowMs: number;
}): void {
  assertNonEmpty(required.registration.tenantId, 'tenantId');
  assertNonEmpty(required.registration.clientId, 'clientId');
  assertNonEmpty(required.flowBinding, 'flowBinding');
  if (required.registration.clientSecretRef) {
    assertNonEmpty(required.registration.clientSecretRef.id, 'clientSecretRef.id');
  }
  if (!Number.isFinite(required.nowMs)) {
    throw new VisitorAuthConfigurationError('invalid-input', 'nowMs must be finite');
  }
}

function validatedOidcNonce(
  protocol: VisitorAuthProviderDefinition['protocol'],
  security: VisitorAuthSecurityArtifacts,
): string | undefined {
  if (!OPAQUE_SECURITY_VALUE.test(security.state)) {
    throw new VisitorAuthConfigurationError('invalid-input', 'state is malformed or too short');
  }
  if (!PKCE_VALUE.test(security.codeVerifier) || !PKCE_VALUE.test(security.codeChallenge)) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      'PKCE verifier and S256 challenge must be 43-128 URL-safe characters',
    );
  }
  if (protocol !== 'oidc') return undefined;

  const nonce = security.nonce;
  if (!nonce || !OPAQUE_SECURITY_VALUE.test(nonce)) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      'OIDC authorization requires a strong nonce',
    );
  }
  return nonce;
}

function assertAuthorizationServerSecurity(required: {
  readonly provider: VisitorAuthProviderDefinition;
  readonly server: VisitorAuthAuthorizationServer;
}): void {
  if (!required.server.supportsPkceS256) {
    throw new VisitorAuthConfigurationError(
      'pkce-s256-required',
      'visitor-auth requires authorization servers that support PKCE S256',
    );
  }
  if (required.provider.protocol === 'oidc' && !required.server.issuer) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      'OIDC authorization server metadata must declare an issuer',
    );
  }
  if (required.server.requiresAuthorizationResponseIssuer && !required.server.issuer) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      'authorization response issuer validation requires a configured issuer',
    );
  }
}

function configuredAuthorizationUrl(required: {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly security: VisitorAuthSecurityArtifacts;
  readonly oidcNonce?: string;
  readonly extraParameters?: Readonly<Record<string, string>>;
}): string {
  const authorizationUrl = parsedSecureUrl(
    required.authorizationEndpoint,
    'authorizationEndpoint',
    false,
  );
  for (const key of authorizationUrl.searchParams.keys()) {
    if (RESERVED_AUTHORIZATION_PARAMETERS.has(key)) {
      throw new VisitorAuthConfigurationError(
        'reserved-parameter',
        `authorizationEndpoint must not preconfigure reserved parameter "${key}"`,
      );
    }
  }
  for (const [key, value] of Object.entries(required.extraParameters ?? {})) {
    if (RESERVED_AUTHORIZATION_PARAMETERS.has(key)) {
      throw new VisitorAuthConfigurationError(
        'reserved-parameter',
        `extraParameters must not override reserved parameter "${key}"`,
      );
    }
    authorizationUrl.searchParams.set(key, value);
  }

  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', required.clientId);
  authorizationUrl.searchParams.set('redirect_uri', required.redirectUri);
  authorizationUrl.searchParams.set('scope', required.scopes.join(' '));
  authorizationUrl.searchParams.set('state', required.security.state);
  authorizationUrl.searchParams.set('code_challenge', required.security.codeChallenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  if (required.oidcNonce) authorizationUrl.searchParams.set('nonce', required.oidcNonce);
  return authorizationUrl.toString();
}

/**
 * Produces a side-effect-free authorization plan. The host persists the
 * returned transaction before redirecting and must later consume it through
 * `VisitorAuthTransactionStorePort` exactly once.
 *
 * @param required - Trusted provider/server/registration metadata, browser binding, and fresh security artifacts.
 * @param optional - Bounded transaction lifetime and non-reserved provider parameters.
 * @returns A redirect URL and the sensitive transaction the host must seal before redirecting.
 * @throws {VisitorAuthConfigurationError} When configuration or security material fails closed.
 * @complexity Time and space: O(s + p), where s is scope count and p is extra parameters.
 */
export function planVisitorAuthAuthorization(
  required: {
    readonly provider: VisitorAuthProviderDefinition;
    readonly server: VisitorAuthAuthorizationServer;
    readonly registration: VisitorAuthClientRegistration;
    readonly redirectUri: string;
    readonly flowBinding: string;
    readonly security: VisitorAuthSecurityArtifacts;
    readonly nowMs: number;
  },
  optional: {
    readonly ttlMs?: number;
    readonly extraParameters?: Readonly<Record<string, string>>;
  } = {},
): VisitorAuthAuthorizationPlan {
  assertProviderAlignment(required);
  assertPlanContext(required);
  assertAuthorizationServerSecurity(required);
  const ttlMs = validatedTransactionTtl(optional.ttlMs);
  const oidcNonce = validatedOidcNonce(required.provider.protocol, required.security);
  const tokenEndpoint = parsedSecureUrl(required.server.tokenEndpoint, 'tokenEndpoint', false);
  const redirectUri = parsedSecureUrl(required.redirectUri, 'redirectUri', true).toString();
  const authorizationUrl = configuredAuthorizationUrl({
    authorizationEndpoint: required.server.authorizationEndpoint,
    clientId: required.registration.clientId,
    redirectUri,
    scopes: required.provider.defaultScopes,
    security: required.security,
    ...(oidcNonce ? { oidcNonce } : {}),
    ...(optional.extraParameters ? { extraParameters: optional.extraParameters } : {}),
  });

  return {
    authorizationUrl,
    transaction: Object.freeze({
      tenantId: required.registration.tenantId,
      providerId: required.provider.id,
      flowBinding: required.flowBinding,
      protocol: required.provider.protocol,
      state: required.security.state,
      ...(oidcNonce ? { nonce: oidcNonce } : {}),
      codeVerifier: required.security.codeVerifier,
      redirectUri,
      clientId: required.registration.clientId,
      ...(required.registration.clientSecretRef
        ? { clientSecretRef: required.registration.clientSecretRef }
        : {}),
      tokenEndpoint: tokenEndpoint.toString(),
      ...(required.server.issuer ? { expectedIssuer: required.server.issuer } : {}),
      requiresAuthorizationResponseIssuer:
        required.server.requiresAuthorizationResponseIssuer ?? false,
      createdAtMs: required.nowMs,
      expiresAtMs: required.nowMs + ttlMs,
    }),
  };
}

export interface VisitorAuthCallbackParameters {
  readonly state?: string;
  readonly code?: string;
  readonly issuer?: string;
  readonly error?: string;
  readonly errorDescription?: string;
}

export type VisitorAuthCallbackRejectionReason =
  | 'expired'
  | 'flow-binding-mismatch'
  | 'issuer-mismatch'
  | 'missing-code'
  | 'provider-error'
  | 'state-mismatch'
  | 'tenant-mismatch';

export type VisitorAuthCallbackDecision =
  | {
      readonly decision: 'exchange';
      readonly request: VisitorAuthTokenExchangeRequest;
    }
  | {
      readonly decision: 'reject';
      readonly reason: VisitorAuthCallbackRejectionReason;
      /** Provider error code only; descriptions are intentionally not propagated. */
      readonly providerError?: string;
    };

function callbackContextRejection(required: {
  readonly transaction: VisitorAuthTransaction;
  readonly tenantId: string;
  readonly flowBinding: string;
  readonly nowMs: number;
}): VisitorAuthCallbackRejectionReason | undefined {
  if (required.transaction.tenantId !== required.tenantId) return 'tenant-mismatch';
  if (required.transaction.flowBinding !== required.flowBinding) return 'flow-binding-mismatch';
  if (!Number.isFinite(required.nowMs)) return 'expired';
  if (required.nowMs >= required.transaction.expiresAtMs) return 'expired';
  return undefined;
}

function callbackProtocolRejection(required: {
  readonly transaction: VisitorAuthTransaction;
  readonly callback: VisitorAuthCallbackParameters;
}): VisitorAuthCallbackRejectionReason | undefined {
  if (!required.callback.state || required.callback.state !== required.transaction.state) {
    return 'state-mismatch';
  }
  if (required.transaction.requiresAuthorizationResponseIssuer && !required.callback.issuer) {
    return 'issuer-mismatch';
  }
  if (
    required.callback.issuer &&
    required.callback.issuer !== required.transaction.expectedIssuer
  ) {
    return 'issuer-mismatch';
  }
  return undefined;
}

function safeProviderError(value: string): string | undefined {
  return SAFE_PROVIDER_ERROR.test(value) ? value : undefined;
}

/**
 * Evaluates an already atomically consumed transaction. It produces a token
 * exchange request only after every browser, tenant, expiry, state, and issuer
 * binding succeeds; it performs no HTTP and creates no identity/session.
 *
 * @param required - Consumed transaction, parsed callback fields, current tenant/browser binding, and injected time.
 * @returns A discriminated exchange or rejection decision; expected callback failures never throw.
 * @complexity Time and space: O(1).
 */
export function evaluateVisitorAuthCallback(required: {
  readonly transaction: VisitorAuthTransaction;
  readonly callback: VisitorAuthCallbackParameters;
  readonly tenantId: string;
  readonly flowBinding: string;
  readonly nowMs: number;
}): VisitorAuthCallbackDecision {
  const { transaction, callback } = required;
  const rejection =
    callbackContextRejection(required) ?? callbackProtocolRejection({ transaction, callback });
  if (rejection) return { decision: 'reject', reason: rejection };
  if (callback.error) {
    const providerError = safeProviderError(callback.error);
    return {
      decision: 'reject',
      reason: 'provider-error',
      ...(providerError ? { providerError } : {}),
    };
  }
  if (!callback.code) {
    return { decision: 'reject', reason: 'missing-code' };
  }

  return {
    decision: 'exchange',
    request: {
      tenantId: transaction.tenantId,
      providerId: transaction.providerId,
      clientId: transaction.clientId,
      ...(transaction.clientSecretRef
        ? { clientSecretRef: transaction.clientSecretRef }
        : {}),
      tokenEndpoint: transaction.tokenEndpoint,
      authorizationCode: callback.code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: transaction.redirectUri,
    },
  };
}

export type VisitorAuthIdentityClaimsRejectionReason =
  | 'audience-mismatch'
  | 'authorized-party-mismatch'
  | 'expired'
  | 'issuer-mismatch'
  | 'malformed-claims'
  | 'nonce-mismatch'
  | 'subject-missing';

export type VisitorAuthIdentityClaimsDecision =
  | {
      readonly decision: 'accept';
      readonly identity: {
        readonly providerId: string;
        readonly subject: string;
        readonly email?: string;
        readonly emailVerified?: boolean;
      };
    }
  | {
      readonly decision: 'reject';
      readonly reason: VisitorAuthIdentityClaimsRejectionReason;
    };

function validatedClockSkew(clockSkewSeconds: number | undefined): number {
  const skew = clockSkewSeconds ?? 60;
  if (!Number.isFinite(skew) || skew < 0 || skew > 300) {
    throw new VisitorAuthConfigurationError(
      'invalid-input',
      'clockSkewSeconds must be between 0 and 300',
    );
  }
  return skew;
}

function validateClaimAudience(required: {
  readonly audience: string | readonly string[];
  readonly authorizedParty: string | undefined;
  readonly clientId: string;
}): VisitorAuthIdentityClaimsRejectionReason | undefined {
  const audiences = typeof required.audience === 'string' ? [required.audience] : required.audience;
  if (audiences.length === 0) return 'malformed-claims';
  if (audiences.some((audience) => !audience.trim())) return 'malformed-claims';
  if (!audiences.includes(required.clientId)) return 'audience-mismatch';
  if (audiences.length > 1 && required.authorizedParty !== required.clientId) {
    return 'authorized-party-mismatch';
  }
  return undefined;
}

function validateClaimTiming(required: {
  readonly expiresAtSeconds: number;
  readonly nowSeconds: number;
  readonly skewSeconds: number;
}): VisitorAuthIdentityClaimsRejectionReason | undefined {
  if (!Number.isFinite(required.nowSeconds)) return 'malformed-claims';
  if (!Number.isFinite(required.expiresAtSeconds)) return 'malformed-claims';
  if (required.expiresAtSeconds <= required.nowSeconds - required.skewSeconds) return 'expired';
  return undefined;
}

function validateClaimIdentityBinding(required: {
  readonly transaction: VisitorAuthTransaction;
  readonly claims: VisitorAuthVerifiedIdTokenClaims;
}): VisitorAuthIdentityClaimsRejectionReason | undefined {
  if (!required.claims.subject.trim()) return 'subject-missing';
  if (!required.transaction.expectedIssuer) return 'issuer-mismatch';
  if (required.claims.issuer !== required.transaction.expectedIssuer) return 'issuer-mismatch';
  if (!required.transaction.nonce) return 'nonce-mismatch';
  if (required.claims.nonce !== required.transaction.nonce) return 'nonce-mismatch';
  return undefined;
}

function acceptedIdentityDecision(required: {
  readonly providerId: string;
  readonly claims: VisitorAuthVerifiedIdTokenClaims;
}): VisitorAuthIdentityClaimsDecision {
  return {
    decision: 'accept',
    identity: {
      providerId: required.providerId,
      subject: required.claims.subject,
      ...(required.claims.email ? { email: required.claims.email } : {}),
      ...(required.claims.emailVerified === undefined
        ? {}
        : { emailVerified: required.claims.emailVerified }),
    },
  };
}

/**
 * Applies OIDC semantic checks to claims returned by
 * `VisitorAuthIdTokenVerifierPort` after cryptographic verification.
 *
 * @param required - The consumed OIDC transaction, verified claims, and injected epoch time.
 * @param optional - A bounded clock-skew allowance (default 60 seconds, maximum 300).
 * @returns A provider-subject identity only after issuer, audience, expiry, and nonce checks pass.
 * @throws {VisitorAuthConfigurationError} When the caller supplies an invalid skew policy.
 * @complexity Time: O(a); space: O(a), where a is the number of audiences.
 */
export function validateVisitorAuthIdentityClaims(
  required: {
    readonly transaction: VisitorAuthTransaction;
    readonly claims: VisitorAuthVerifiedIdTokenClaims;
    readonly nowSeconds: number;
  },
  optional: { readonly clockSkewSeconds?: number } = {},
): VisitorAuthIdentityClaimsDecision {
  const { transaction, claims } = required;
  const skew = validatedClockSkew(optional.clockSkewSeconds);
  const timingRejection = validateClaimTiming({
    expiresAtSeconds: claims.expiresAtSeconds,
    nowSeconds: required.nowSeconds,
    skewSeconds: skew,
  });
  const identityRejection = validateClaimIdentityBinding({ transaction, claims });
  const audienceRejection = validateClaimAudience({
    audience: claims.audience,
    authorizedParty: claims.authorizedParty,
    clientId: transaction.clientId,
  });
  const rejection = timingRejection ?? identityRejection ?? audienceRejection;
  if (rejection) return { decision: 'reject', reason: rejection };
  return acceptedIdentityDecision({ providerId: transaction.providerId, claims });
}
