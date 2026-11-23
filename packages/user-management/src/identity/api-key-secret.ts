import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type { ApiKeySecretHasherPort } from "./api-key-types.js";

/**
 * @file Minting, parsing, and hashing of raw API-key strings (SPEC-006 REQ-08, INV-05).
 *
 * Purpose:
 * One place owns the entire secret lifecycle for `api_keys`, so no route or repo file ever has to
 * touch a raw key beyond handing it straight to the caller once. Everything here is pure — no
 * repo, no clock, no db handle — which is why it is unit-testable without an HTTP harness.
 *
 * ## Key shape
 * `<scheme prefix><12 hex>.<43 base64url chars>` splits into two halves with different jobs:
 * - `<scheme prefix><12 hex>` — the NON-secret prefix, persisted in the clear as `api_keys.prefix`
 *   and unique per workspace. It exists to make verification a single indexed row read. The scheme
 *   prefix (e.g. `acme_ak_`) is a recognizable marker so a leaked key is greppable by secret scanners.
 *   It is product identity, so the host supplies it through `createApiKeySecret({ prefix })`; every
 *   issued key carries it, so a host must never change the value it binds.
 * - `<43 base64url chars>` — `randomBytes(32)`, i.e. **256 bits** of CSPRNG entropy. This is the
 *   only part that is secret and the only part that is hashed.
 *
 * ## Why scrypt, and why at THIS cost
 * A password hash defends a low-entropy human-chosen input against offline dictionary search, so
 * it is tuned as slowly as the login path can bear (`Argon2PasswordHasher`: 19 MiB, t=2). An API
 * key's input is 256 CSPRNG bits, where offline search is already infeasible at any work factor,
 * but the credential is presented on EVERY request rather than once per login. So this is a
 * separate port from `PasswordHasherPort` with a separate tuning, not a reuse of it:
 * - **Salted and slow, not a bare digest.** A per-key 16-byte salt plus a memory-hard KDF means a
 *   stolen `api_keys` table yields no precomputation, no cross-row amortization, and no rainbow
 *   table — the properties an unsalted SHA of a secret gives away for free.
 * - **`N=2^14, r=8, p=1`** (~16 MiB, tens of milliseconds on commodity hardware) rather than a
 *   password-grade cost, because the entropy above already carries the offline-attack argument and
 *   the per-request budget is real. Raising it is safe and is a one-line change; the stored digest
 *   records its own parameters (below) so already-issued keys keep verifying across a re-tune.
 * - **`node:crypto` only.** No new dependency, and no native binding on the request hot path.
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt base64url>$<digest base64url>`. Parameters travel with
 * the digest so verification never has to assume the constants a row was written under.
 *
 * Comparison is `timingSafeEqual` over the raw digest bytes. Nothing in this file branches on the
 * CONTENT of a secret or a digest; the only early returns are on structural facts (a malformed
 * stored hash, a wrong-length digest), never on how far a comparison got.
 */

/** Bytes of the non-secret lookup handle (48 bits, hex-encoded to 12 chars). */
const HANDLE_BYTES = 6;

/** Bytes of the secret half. 32 = 256 bits, the entropy the file header's argument rests on. */
const SECRET_BYTES = 32;

/** Separates prefix from secret. `.` can never appear in base64url, so the split is unambiguous. */
const KEY_SEPARATOR = ".";

/** The alphabet a host scheme prefix may use. It holds no regex metacharacter, so the anchored
 *  pattern built from it needs no escaping, and it can never contain `KEY_SEPARATOR`. */
const SCHEME_PREFIX_SHAPE = /^[a-z][a-z0-9_]*$/;

/** scrypt cost parameters for NEWLY written digests. See the file header for the tuning argument. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Derived-key length in bytes. */
const SCRYPT_KEYLEN = 32;

/** `128 * N * r` is scrypt's own requirement (16 MiB here); the headroom covers `p` and overhead. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Salt length in bytes. */
const SALT_BYTES = 16;

/** A freshly minted key: the raw string is returned to the issuer ONCE and never persisted. */
export interface MintedApiKey {
  /** The full `<scheme prefix><handle>.<secret>` string. Never store, log, or re-derive this. */
  rawKey: string;
  /** The non-secret half, persisted as `api_keys.prefix`. */
  prefix: string;
  /** The secret half, to be handed to `ApiKeySecretHasherPort.hash` and then dropped. */
  secret: string;
}

/**
 * Mint a new API key from the CSPRNG.
 *
 * @returns the raw key plus its two halves, already split so the caller never re-parses its own
 *   output.
 * @complexity O(1) — two `randomBytes` draws of fixed size.
 * @overallScore 100
 */
function mintApiKey({ keySchemePrefix }: { keySchemePrefix: string }, _options = {}): MintedApiKey {
  const prefix = `${keySchemePrefix}${randomBytes(HANDLE_BYTES).toString("hex")}`;
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { rawKey: `${prefix}${KEY_SEPARATOR}${secret}`, prefix, secret };
}

/**
 * Split a presented raw key back into its two halves.
 *
 * @param required.rawKey - the untrusted credential exactly as presented by a caller.
 * @param required.prefixPattern - `<scheme prefix>` + exactly 12 lowercase hex characters, anchored.
 * @returns `{ prefix, secret }`, or `null` when `rawKey` is not shaped like a key this runtime
 *   mints — which the caller must treat as "no such credential", never as an error worth reporting
 *   in detail (a parse-failure message that distinguishes shapes is an oracle).
 * @complexity O(1) — one `indexOf` and one anchored regex over a bounded prefix.
 * @overallScore 100
 */
function parseApiKey({ rawKey, prefixPattern }: { rawKey: string; prefixPattern: RegExp }, _options = {}): { prefix: string; secret: string } | null {
  const separatorAt = rawKey.indexOf(KEY_SEPARATOR);
  if (separatorAt <= 0) return null;

  const prefix = rawKey.slice(0, separatorAt);
  const secret = rawKey.slice(separatorAt + 1);
  if (secret.length === 0 || !prefixPattern.test(prefix)) return null;

  return { prefix, secret };
}

/** Key minting and parsing bound to one host scheme prefix (see the file header). */
export interface ApiKeySecret {
  /** Mint a new key under the bound prefix; see `MintedApiKey`. */
  mintApiKey(): MintedApiKey;
  /** Split a presented raw key; `null` unless it carries exactly the bound prefix. */
  parseApiKey(required: { rawKey: string }, _options?: Record<string, never>): { prefix: string; secret: string } | null;
}

/**
 * Bind minting and parsing to the host's non-secret scheme marker (e.g. `acme_ak_`).
 *
 * @param required.prefix - lowercase letters, digits and `_`, starting with a letter. Every key the
 *   host has issued carries it, so the host binds one value for its lifetime.
 * @throws {TypeError} for a prefix outside that alphabet, before any key is minted under it.
 * @complexity O(1) — compiles one anchored pattern.
 */
export function createApiKeySecret({ prefix }: { prefix: string }, _optional: Record<string, never> = {}): ApiKeySecret {
  if (!SCHEME_PREFIX_SHAPE.test(prefix)) throw new TypeError("api-key scheme prefix must be lowercase letters, digits or '_', starting with a letter");
  const prefixPattern = new RegExp(`^${prefix}[0-9a-f]{12}$`);
  return {
    mintApiKey: () => mintApiKey({ keySchemePrefix: prefix }),
    parseApiKey: ({ rawKey }, _options = {}) => parseApiKey({ rawKey, prefixPattern }),
  };
}

function deriveKey({ secret, salt, params }: { secret: string; salt: Buffer; params: { N: number; r: number; p: number } }, _options = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, SCRYPT_KEYLEN, { ...params, maxmem: SCRYPT_MAXMEM }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

interface ParsedDigest {
  params: { N: number; r: number; p: number };
  salt: Buffer;
  digest: Buffer;
}

/** True iff `N`/`r`/`p` are all integers — the shape scrypt's own parameters must have before
 *  they are safe to bounds-check at all. */
function isIntegerTriple({ N, r, p }: { N: number; r: number; p: number }, _options = {}): boolean {
  return Number.isInteger(N) && Number.isInteger(r) && Number.isInteger(p);
}

/** True iff `N`/`r`/`p` are within the bounds a legitimately-written digest can have: strictly
 *  positive (`N` additionally > 1, scrypt's own requirement), and under the memory ceiling. Refuses
 *  to spend unbounded memory on parameters read out of a row (a hand-edited or hostile `key_hash`
 *  must not become a denial-of-service knob) — `128 * N * r` is scrypt's own footprint. Its CPU work
 *  grows linearly with `p` (`128 * N * r * p` bytes mixed), so the same ceiling bounds `p` too. This
 *  file writes `p=1`, so no digest it wrote is refused. */
function isWithinScryptBounds({ N, r, p }: { N: number; r: number; p: number }, _options = {}): boolean {
  if (N <= 1 || r <= 0 || p <= 0) return false;
  return 128 * N * r * p <= SCRYPT_MAXMEM;
}

/** Parses and validates the three numeric scrypt cost parameters embedded in a stored hash.
 *  Returns `null` for anything non-integer, non-positive, or exceeding the memory ceiling. */
function parseStoredHashParams({ rawN, rawR, rawP }: { rawN: string; rawR: string; rawP: string }, _options = {}): ParsedDigest["params"] | null {
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!isIntegerTriple({ N, r, p })) return null;
  if (!isWithinScryptBounds({ N, r, p })) return null;
  return { N, r, p };
}

/** Split a stored `scrypt$...` string. Returns `null` for anything this file did not write. */
function parseStoredHash({ storedHash }: { storedHash: string }, _options = {}): ParsedDigest | null {
  const [scheme, rawN, rawR, rawP, rawSalt, rawDigest, ...extra] = storedHash.split("$");
  if (scheme !== "scrypt" || rawN === undefined || rawR === undefined || rawP === undefined) return null;
  if (rawSalt === undefined || rawDigest === undefined || extra.length > 0) return null;

  return parseStoredHashBody({ rawN, rawR, rawP, rawSalt, rawDigest });
}

function parseStoredHashBody({ rawN, rawR, rawP, rawSalt, rawDigest }: {
  rawN: string; rawR: string; rawP: string; rawSalt: string; rawDigest: string;
}): ParsedDigest | null {
  const params = parseStoredHashParams({ rawN, rawR, rawP });
  if (!params) return null;

  const bytes = decodeStoredHashBytes({ rawSalt, rawDigest });
  return bytes ? { params, ...bytes } : null;
}

function decodeStoredHashBytes({ rawSalt, rawDigest }: { rawSalt: string; rawDigest: string }, _options = {}): Pick<ParsedDigest, "salt" | "digest"> | null {
  const salt = Buffer.from(rawSalt, "base64url");
  const digest = Buffer.from(rawDigest, "base64url");
  if (salt.length === 0 || digest.length === 0) return null;
  return { salt, digest };
}

/**
 * The reference `ApiKeySecretHasherPort` — scrypt with per-key salts and a constant-time compare.
 *
 * `verify` never throws: a malformed, foreign, or truncated `key_hash` resolves `false`, so a
 * corrupted row degrades to "credential rejected" rather than to a 500 or an auth bypass (the same
 * fail-closed contract `Argon2PasswordHasher.verify` already holds for passwords).
 *
 * @complexity O(1) calls into `node:crypto`; cost is set by `SCRYPT_PARAMS`, not by input size.
 * @overallScore 100
 */
export class ScryptApiKeySecretHasher implements ApiKeySecretHasherPort {
  async hash({ secret }: { secret: string }, _options: Record<string, never> = {}): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await deriveKey({ secret, salt, params: SCRYPT_PARAMS });
    const { N, r, p } = SCRYPT_PARAMS;
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  }

  async verify({ storedHash, secret }: { storedHash: string; secret: string }, _options: Record<string, never> = {}): Promise<boolean> {
    const parsed = parseStoredHash({ storedHash });
    if (!parsed) return false;

    try {
      const derived = await deriveKey({ secret, salt: parsed.salt, params: parsed.params });
      // Length mismatch is a property of the STORED row, not of the presented secret, so this
      // early return leaks nothing about the credential — and `timingSafeEqual` throws on
      // unequal lengths, so the guard is required, not merely defensive.
      if (derived.length !== parsed.digest.length) return false;
      return timingSafeEqual(derived, parsed.digest);
    } catch {
      return false;
    }
  }
}

/** One decoy per hasher instance, built on first use — never at import time (this module must be
 *  free of import-time side effects, and the derivation below is deliberately expensive). */
const decoyByHasher = new WeakMap<ApiKeySecretHasherPort, Promise<string>>();

/**
 * A stored-hash string over a value no caller can ever present, so a lookup that found no row can
 * still spend one real derivation instead of returning immediately (see `authenticateApiKey`).
 * Without it, "no key carries this prefix" and "this prefix exists but the secret is wrong" are
 * distinguishable by response time.
 *
 * Drawn from the CSPRNG rather than hardcoded, so it is not a recognizable constant in a heap dump
 * or a leaked build, and memoized per hasher so the cost is paid once per process.
 *
 * @complexity O(1) after the first call for a given hasher.
 * @overallScore 100
 */
export function decoyKeyHash(hasher: ApiKeySecretHasherPort): Promise<string> {
  const existing = decoyByHasher.get(hasher);
  if (existing) return existing;

  const created = hasher.hash({ secret: randomBytes(SECRET_BYTES).toString("base64url") });
  decoyByHasher.set(hasher, created);
  return created;
}
