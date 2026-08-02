/**
 * `AuthProvider` — a swappable identity/session port. Speculative
 * port-design exploration (see `source-map.md`): Zana and a fleet orchestrator each
 * independently built an explicit capability-provider layer with auth as one
 * of the swappable capabilities (Supabase/sqlite-backed) — this is the
 * engine-level shape that convergence points at, not a lift from either.
 *
 * This file defines the port's stable interface/type surface and nothing else —
 * it has no imports at all, so a consumer implementing `AuthProvider`
 * themselves installs nothing. The one real, production-quality adapter
 * (`JwtAuthProvider`, self-contained HS256 JWT sessions over `node:crypto`)
 * lives at the separate `@jini-ai/capability-providers/adapters/jwt-auth`
 * entry point; the non-production in-memory reference stub
 * (`createInMemoryAuthProvider`) lives under `src/unsafe-reference/`,
 * exported only from `@jini-ai/capability-providers/unsafe-reference`.
 */

export interface AuthCredentials {
  readonly email: string;
  readonly password: string;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly createdAt: number;
}

export interface AuthSession {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: number;
}

export interface AuthProvider {
  /** Creates a new user. Rejects if `credentials.email` is already registered. */
  signUp(credentials: AuthCredentials): Promise<AuthUser>;
  /** Exchanges valid credentials for a new session. Rejects on an unknown email or wrong password. */
  signIn(credentials: AuthCredentials): Promise<AuthSession>;
  /** Invalidates a session token. A no-op on an already-invalid/unknown token. */
  signOut(token: string): Promise<void>;
  /** Resolves a session token to its user, or `null` if the token is unknown, invalidated, or expired. */
  verifySession(token: string): Promise<AuthUser | null>;
}
