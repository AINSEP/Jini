/**
 * `@jini-ai/capability-providers/adapters/jwt-auth` — the one real,
 * production-quality `AuthProvider` adapter this package ships: self-contained
 * HS256 JWT session tokens signed with a host-supplied secret, `node:crypto`
 * `scrypt` password hashing, no external auth-service dependency (no
 * Auth0/Clerk/Supabase Auth call).
 *
 * Lives at this separate entry point (not the package's main
 * `@jini-ai/capability-providers` barrel) so importing the port
 * interface/types/DI tokens never drags `node:crypto` in — that single import
 * is what made the whole root barrel Node-only, unusable from a browser or edge
 * runtime that only wanted the `AuthProvider` interface to implement itself.
 * Import from here only when you actually want this concrete adapter.
 *
 * The in-memory reference implementation (`createInMemoryAuthProvider`) is a
 * separate, non-production stub under `src/unsafe-reference/` — see that
 * directory's `index.ts` header for the full warning.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthCredentials, AuthProvider, AuthSession, AuthUser } from '../../auth.js';

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

/** Hashes `password` with `scrypt` under a fresh random salt, returned as a `<saltHex>:<hashHex>` string. */
function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verifies `password` against a `<saltHex>:<hashHex>` string previously produced by
 * {@link hashPassword}. `stored` is always this class's own `hashPassword` output — nothing
 * external ever writes to a user's `passwordHash` field — so both halves are trusted to be
 * well-formed hex by construction; no defensive "malformed stored hash" branch is needed (there
 * is no real caller path that could exercise one).
 */
function verifyPassword(password: string, stored: string): boolean {
  const separatorIndex = stored.indexOf(':');
  const salt = Buffer.from(stored.slice(0, separatorIndex), 'hex');
  const expected = Buffer.from(stored.slice(separatorIndex + 1), 'hex');
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

/** The claims this adapter puts in every session JWT. */
interface SessionJwtPayload {
  /** Subject — the `AuthUser.id`. */
  readonly sub: string;
  /** JWT ID — a random per-session identifier, so `signOut` can revoke one session without invalidating every other session for the same user. */
  readonly jti: string;
  /** Issued-at, Unix seconds. */
  readonly iat: number;
  /** Expiry, Unix seconds. */
  readonly exp: number;
}

/** Signs `payload` as an HS256 JWT (`base64url(header).base64url(payload).base64url(hmacSha256Signature)`). */
function signSessionJwt(payload: SessionJwtPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = base64url(createHmac('sha256', secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

type SessionJwtVerifyResult = { readonly ok: true; readonly payload: SessionJwtPayload } | { readonly ok: false };

/**
 * Verifies an HS256 session JWT's signature and claim shape against `secret`. Deliberately does
 * NOT check expiry or revocation — those are session-store concerns (`revokedJti`, `now()`) that
 * `JwtAuthProvider.verifySession` layers on top, so this stays a pure "is this token
 * authentically signed and well-formed" check reusable by both `verifySession` and `signOut`.
 */
function verifySessionJwt(token: string, secret: string): SessionJwtVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false };
  // Array destructuring can't narrow past noUncheckedIndexedAccess; the length check above
  // guarantees all three are real strings, not undefined.
  const headerPart = parts[0]!;
  const payloadPart = parts[1]!;
  const signaturePart = parts[2]!;

  const expectedSignature = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  const actualSignature = base64urlToBuffer(signaturePart);
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlToBuffer(payloadPart).toString('utf8'));
  } catch {
    return { ok: false };
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).sub !== 'string' ||
    typeof (parsed as Record<string, unknown>).jti !== 'string' ||
    typeof (parsed as Record<string, unknown>).exp !== 'number'
  ) {
    return { ok: false };
  }
  return { ok: true, payload: parsed as SessionJwtPayload };
}

export interface JwtAuthProviderOptions {
  /** HMAC-SHA256 signing secret for session tokens. Required and explicit — never read from an environment variable inside this adapter. */
  readonly secret: string;
  /** Session lifetime in ms. Defaults to 1 hour, matching the in-memory reference adapter's default. */
  readonly sessionTtlMs?: number;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

interface StoredUser extends AuthUser {
  readonly passwordHash: string;
}

/**
 * `AuthProvider` adapter using self-signed HS256 JWTs as session tokens — no external
 * auth-service dependency (no Auth0/Clerk/Supabase Auth call), just `node:crypto` and a
 * host-supplied `secret`. Real password hashing (`scrypt` + per-user random salt +
 * constant-time comparison), unlike the in-memory reference adapter's plaintext storage.
 *
 * Two deliberate, documented scope limits:
 *
 * 1. **User storage is in-process memory, not durable.** `AuthProvider`'s interface has no
 *    concept of user persistence beyond what `signUp`/`signIn`/`verifySession` need — pair this
 *    with `SqliteDbProvider`/`BlobStorageProvider` at the binding site (per `source-map.md`'s
 *    "composition happens at the binding site, not in this package" design decision) if a host
 *    needs users to survive a process restart. A session JWT signed by one `JwtAuthProvider`
 *    instance verifies its *signature* successfully against any instance sharing the same
 *    `secret` (including a fresh instance after a restart), but `verifySession` still returns
 *    `null` for it once the signing instance's in-memory `usersById` no longer has that user —
 *    tested explicitly below.
 * 2. **Revocation is an in-memory deny-list, not a JWT property.** JWTs are stateless by design;
 *    `signOut` records the session's `jti` in a process-local `Set` so `verifySession` can reject
 *    it before expiry. Like (1), this deny-list does not survive a process restart — a signed-out
 *    token is memory-safe under normal operation but session revocation is not honored across a
 *    restart of the process holding the deny-list.
 */
export class JwtAuthProvider implements AuthProvider {
  private readonly secret: string;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;
  private readonly usersByEmail = new Map<string, StoredUser>();
  private readonly usersById = new Map<string, StoredUser>();
  private readonly revokedJti = new Set<string>();
  private nextId = 1;

  constructor(options: JwtAuthProviderOptions) {
    if (!options.secret) {
      throw new Error('JwtAuthProvider requires a non-empty options.secret');
    }
    this.secret = options.secret;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async signUp(credentials: AuthCredentials): Promise<AuthUser> {
    if (this.usersByEmail.has(credentials.email)) {
      throw new Error(`email already registered: ${credentials.email}`);
    }
    const user: StoredUser = {
      id: `user-${this.nextId++}`,
      email: credentials.email,
      createdAt: this.now(),
      passwordHash: hashPassword(credentials.password),
    };
    this.usersByEmail.set(credentials.email, user);
    this.usersById.set(user.id, user);
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthSession> {
    const user = this.usersByEmail.get(credentials.email);
    if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
      throw new Error('invalid email or password');
    }
    const nowMs = this.now();
    const expiresAt = nowMs + this.sessionTtlMs;
    const token = signSessionJwt(
      {
        sub: user.id,
        jti: randomBytes(16).toString('hex'),
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(expiresAt / 1000),
      },
      this.secret,
    );
    return { token, userId: user.id, expiresAt };
  }

  async signOut(token: string): Promise<void> {
    const result = verifySessionJwt(token, this.secret);
    if (result.ok) {
      this.revokedJti.add(result.payload.jti);
    }
  }

  async verifySession(token: string): Promise<AuthUser | null> {
    const result = verifySessionJwt(token, this.secret);
    if (!result.ok) return null;
    if (this.revokedJti.has(result.payload.jti)) return null;
    if (result.payload.exp * 1000 <= this.now()) return null;
    const user = this.usersById.get(result.payload.sub);
    if (!user) return null;
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }
}
