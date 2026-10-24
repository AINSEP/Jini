/** Pure email-challenge primitives. Hosts own persistence, delivery and atomic consumption. */
import type { PasswordHasherPort } from "../core/ports.js";
import type { SessionTokenPort } from "../core/runtime-ports.js";

/** Persisted metadata only; raw link tokens and codes must never enter this record. */
export interface AuthChallengeRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly realm: string;
  readonly purpose: string;
  readonly tokenHash: string;
  /** Null for legacy link-only challenges. */
  readonly codeHash: string | null;
  readonly expiresAt: string;
  readonly consumedAt?: string | null;
  /**
   * Code attempts spent. Each is reserved before its code is verified, and a correct code
   * consumes the challenge, so on a live challenge every counted attempt failed or is in flight.
   */
  readonly failedAttempts: number;
}

export interface ChallengeScope {
  readonly workspaceId: string;
  readonly realm: string;
  readonly purpose: string;
}

/**
 * Storage contract only: implementations live in the host. Reads are scope-bound.
 * Link completion: findByTokenHash -> decideChallenge -> consume.
 * Code completion: findById -> decideChallenge -> reserveCodeAttempt -> verifyChallengeCode -> consume.
 * Any false or "invalid" step gives the caller the same uniform failure.
 */
export interface ChallengeStorePort {
  save(record: AuthChallengeRecord): Promise<void>;
  findById(input: ChallengeScope & { id: string }): Promise<AuthChallengeRecord | null>;
  findByTokenHash(input: ChallengeScope & { tokenHash: string }): Promise<AuthChallengeRecord | null>;
  /**
   * Atomically (lock/CAS) increment failedAttempts while decideChallenge is "ok" on current
   * state; false when none remain. It runs BEFORE the code is verified, so parallel guesses
   * cannot each read a stale counter and outrun the limit. Never resets the counter.
   */
  reserveCodeAttempt(input: ChallengeScope & { id: string; nowIso: string; maxAttempts?: number }): Promise<boolean>;
  /**
   * Atomically stamp consumedAt while in scope, unconsumed and unexpired; link and code share
   * this one stamp. Attempts are not rechecked: link completion checked them in decideChallenge
   * and code completion already spent one. Returns false if another completion won.
   */
  consume(input: ChallengeScope & { id: string; nowIso: string }): Promise<boolean>;
}

export interface ChallengeSecretDependencies {
  /** Inject NodeSessionTokens (32 cryptographic random bytes, SHA-256 digest), or equivalent. */
  readonly tokens: SessionTokenPort;
  /** Inject crypto.randomInt via ({ min, max }) => randomInt(min, max); max is exclusive. */
  readonly randomInt: (input: { min: number; max: number }) => number;
}

export interface ChallengeSecrets {
  readonly token: string;
  readonly tokenHash: string;
  readonly code: string;
}

/**
 * Generate one 256-bit link bearer and uniform six-digit code through injected entropy.
 * Only tokenHash and hashChallengeCode's result may be persisted. No clock or I/O is read.
 * @throws RangeError if the supplied random-integer adapter violates its bounds.
 * @complexity O(1), with one token generation/digest and one bounded integer draw.
 */
export function newChallengeSecrets(
  { tokens, randomInt }: ChallengeSecretDependencies,
  _options: Record<string, never> = {},
): ChallengeSecrets {
  const value = randomInt({ min: 0, max: 1_000_000 });
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000) {
    throw new RangeError("Challenge entropy must be an integer in [0, 1000000).");
  }
  const token = tokens.newToken({});
  return { token, tokenHash: tokens.hashToken({ rawToken: token }), code: String(value).padStart(6, "0") };
}

/** Exact ASCII shape; without the m flag, $ also refuses trailing line terminators. O(1). */
function isChallengeCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

/**
 * Hash the low-entropy code using the existing password hasher, never a fast digest.
 * @throws RangeError for malformed codes; hashing adapter errors propagate.
 * @complexity O(1) adapter calls; hashing cost belongs to PasswordHasherPort.
 */
export function hashChallengeCode(
  { code, hasher }: { code: string; hasher: PasswordHasherPort },
  _options: Record<string, never> = {},
): Promise<string> {
  if (!isChallengeCode(code)) throw new RangeError("Challenge code must contain exactly six ASCII digits.");
  return hasher.hash({ password: code });
}

/**
 * Verify through PasswordHasherPort's timing-safe verifier (Argon2PasswordHasher in Node).
 * Legacy link-only hashes and malformed codes return false. Adapter errors propagate.
 * @complexity O(1) adapter calls; no repository access or attempt mutation.
 */
export async function verifyChallengeCode(
  { code, hash, hasher }: { code: string; hash: string | null; hasher: PasswordHasherPort },
  _options: Record<string, never> = {},
): Promise<boolean> {
  if (!hash || !isChallengeCode(code)) return false;
  return hasher.verify({ hash, password: code });
}

/** Invalid counters or limits deny access; O(1), without changing the stored counter. */
function hasAttemptsRemaining(failedAttempts: number, maxAttempts: number): boolean {
  return Number.isSafeInteger(failedAttempts) && failedAttempts >= 0
    && Number.isSafeInteger(maxAttempts) && maxAttempts > 0 && failedAttempts < maxAttempts;
}

/**
 * Decide metadata eligibility only; callers must also verify the token/code and use the
 * store's atomic steps above. nowIso is the caller's injected clock value. Expiry is exclusive.
 * Every denial returns the same result, including malformed timestamps/counters.
 * @complexity O(1) for fixed-size metadata; no I/O, clock reads or input mutation.
 */
export function decideChallenge(
  { record, workspaceId, realm, purpose, nowIso, maxAttempts = 5 }: ChallengeScope & {
    record: AuthChallengeRecord | null;
    nowIso: string;
    maxAttempts?: number;
  },
  _options: Record<string, never> = {},
): "ok" | "invalid" {
  if (!record) return "invalid";
  if (record.workspaceId !== workspaceId || record.realm !== realm || record.purpose !== purpose) return "invalid";
  if (record.consumedAt != null) return "invalid";
  if (!hasAttemptsRemaining(record.failedAttempts, maxAttempts)) return "invalid";
  const now = Date.parse(nowIso);
  const expires = Date.parse(record.expiresAt);
  // Invalid dates parse to NaN, so the comparison also denies malformed timestamps.
  return expires > now ? "ok" : "invalid";
}
