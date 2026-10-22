/**
 * UNSAFE REFERENCE IMPLEMENTATION — not production code. See the header
 * comment in `src/unsafe-reference/index.ts` for the full warning; the
 * short version: `createInMemoryAuthProvider` stores plaintext passwords
 * and issues predictable, non-cryptographic session tokens. It exists only
 * to prove `AuthProvider` (defined in `../auth.ts`) is implementable and
 * unit-testable. Never wire this into anything that handles real
 * credentials.
 *
 * A real adapter (Supabase Auth, Auth0, a JWT-backed service) implements
 * the same `AuthProvider` interface without importing this file.
 */
import type { AuthCredentials, AuthProvider, AuthSession, AuthUser } from '../auth.js';

export interface InMemoryAuthProviderOptions {
  /** Session lifetime in ms. Defaults to 1 hour. */
  readonly sessionTtlMs?: number;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

interface StoredUser extends AuthUser {
  readonly password: string;
}

/** Creates the in-memory reference `AuthProvider`. No persistence — state is lost on process exit. */
export function createInMemoryAuthProvider(_required: Record<string, never>, options: InMemoryAuthProviderOptions = {}): AuthProvider {
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? Date.now;
  const usersByEmail = new Map<string, StoredUser>();
  const sessions = new Map<string, AuthSession>();
  let nextId = 1;
  let nextToken = 1;

  return {
    async signUp(credentials: AuthCredentials): Promise<AuthUser> {
      if (usersByEmail.has(credentials.email)) {
        throw new Error(`email already registered: ${credentials.email}`);
      }
      const user: StoredUser = {
        id: `user-${nextId++}`,
        email: credentials.email,
        password: credentials.password,
        createdAt: now(),
      };
      usersByEmail.set(credentials.email, user);
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    },

    async signIn(credentials: AuthCredentials): Promise<AuthSession> {
      const user = usersByEmail.get(credentials.email);
      if (!user || user.password !== credentials.password) {
        throw new Error('invalid email or password');
      }
      const session: AuthSession = {
        token: `session-${nextToken++}`,
        userId: user.id,
        expiresAt: now() + sessionTtlMs,
      };
      sessions.set(session.token, session);
      return session;
    },

    async signOut({ token }: { token: string }): Promise<void> {
      sessions.delete(token);
    },

    async verifySession({ token }: { token: string }): Promise<AuthUser | null> {
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= now()) {
        sessions.delete(token);
        return null;
      }
      // This port surface has no deleteUser, so a session's userId always
      // resolves — the non-null assertion documents that invariant rather
      // than a defensive branch with no real runtime path.
      const user = [...usersByEmail.values()].find((u) => u.id === session.userId)!;
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    },
  };
}
