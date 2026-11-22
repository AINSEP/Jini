/**
 * @file The per-request context a host's `authenticate` port binds for the owner-auth routes. It is
 * the host-injected response policy: cookies, cache headers, the shared login limiter, session
 * revocation and the sign-in signal all stay host code, so these routes name no cookie, header or
 * framework. Every refusal is thrown as a `RouteRefusalError`; the host's `onError` writes its body.
 */
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

/** Request metadata recorded on every ordinary session. */
export interface AuthSessionOptions { readonly ip?: string | undefined; readonly userAgent?: string | undefined; readonly sessionTtlMs: number }
/** A freshly minted bearer and when it expires. */
export interface AuthSessionIssue { readonly rawToken: string; readonly expiresAtIso: string }
export interface AuthPrincipal { readonly id: string; readonly kind?: string; readonly displayName?: string | null }
/** The outcome of redeeming a one-time boot token; see `redeemBootSession`. */
export type BootRedemption =
  | { readonly kind: 'refused' }
  | { readonly kind: 'mfa'; readonly body: unknown }
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'session'; readonly principal: AuthPrincipal; readonly setCookies: readonly string[] };
export interface AuthRequest {
  /** The client key the shared login limiter counts against. */
  readonly clientKey: string;
  sessionOptions(): AuthSessionOptions;
  /** The registration's single limiter, shared with the recovery, MFA and passkey routes. */
  readonly rateLimit: { check(): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }> };
  currentPrincipal(): Promise<AuthPrincipal | null>;
  /** Revokes every bearer this request carried; runs before a replacement cookie is set. */
  revokeSessions(): Promise<void>;
  readonly cookies: {
    /** Sets the session cookie and returns the `Set-Cookie` values in the order they were written. */
    replaceSession(required: AuthSessionIssue, optional?: { readonly name?: string }): readonly string[];
    clearSessions(): readonly string[];
  };
  noStore(): void;
  retryAfter(seconds: number): void;
  /** Fire-and-forget: never awaited, and its failure never changes the response. */
  signedIn(required: { readonly principalId: string }): void;
  readonly loopback: boolean;
  readonly localOwnerSignIn: { readonly enabled: boolean; acceptsCapability(): boolean; allowsRequest(): boolean };
  redeemBootSession(required: { readonly token: unknown }, optional?: { readonly mintLocal?: boolean }): Promise<BootRedemption>;
}

/** The mount binds a context on every request; a missing one is a wiring fault, not a caller error. */
export function requireAuthRequest({ context }: { context: AuthRequest | undefined }, _optional: Record<string, never> = {}): AuthRequest {
  if (!context) throw new Error('owner-auth route mounted without an authenticate port');
  return context;
}

/** A flat-body refusal for the host's `onError` to write verbatim. */
export function refuse({ status, body }: { status: number; body: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): never {
  throw new RouteRefusalError({ status, body });
}

/** A JSON body as a record, or an empty one; missing and non-object bodies read as empty. */
export function bodyRecord({ body }: { body: unknown }, _optional: Record<string, never> = {}): Readonly<Record<string, unknown>> {
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
}

/** A deliberate sign-in failure the host answers with its redacted auth-failure envelope for
 * `operation`. Anything else a route throws (a repository fault, say) takes the host's ordinary
 * error path instead, so the two are told apart by type, never by message. */
export class OwnerAuthFailure extends Error {
  readonly operation: string;
  constructor({ error, operation }: { error: unknown; operation: string }, _optional: Record<string, never> = {}) {
    super('owner sign-in could not finish', { cause: error });
    this.operation = operation;
  }
}
