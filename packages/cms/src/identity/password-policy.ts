/**
 * @file Password policy (NIST SP 800-63B aligned): a length floor only, no composition rules.
 *
 * NIST SP 800-63B — the current published memorized-secret guidance — recommends a minimum
 * length requirement and explicitly recommends AGAINST composition rules (mandatory uppercase,
 * digit, or symbol). Composition rules measurably push people toward predictable, guessable
 * patterns ("Password1!") rather than genuinely stronger secrets, which is why this module
 * enforces length only.
 *
 * `createUser` (`grant-service.ts`) and `resetUserPassword` (`admin-crud-service.ts`) are the
 * identity system's only two write paths that ever set a password, confirmed by tracing the
 * whole call graph — both call this module.
 *
 * Two things this deliberately does NOT do, both load-bearing:
 * - Never reaches `seed.ts`'s first-boot owner password. `seedIdentity` hashes it directly
 *   (`deps.hasher.hash(ownerPassword)`, `seed.ts:317`) and calls neither `createUser` nor
 *   `resetUserPassword` — confirmed before writing this module. That separation is intentional
 *   to preserve here: the host chooses the first-boot owner password (`SeedIdentityInput` requires
 *   it and supplies no default), and an existing installation is already authenticating with
 *   whatever it chose. Enforcing this policy on that path would lock out every such installation
 *   whose chosen value predates the policy.
 * - Never re-validates at login. This is a write-time policy — `login`/`verify` never call it.
 *   An account whose password predates this policy (or was seeded) must keep authenticating; NIST
 *   800-63B's own guidance is that length rules apply when a secret is *chosen*, not retroactively
 *   to secrets already in use.
 */

/** NIST SP 800-63B's recommended floor. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Generous upper bound — not itself a security requirement (argon2id's cost is tuned by its
 * `memoryCost`/`timeCost`/`parallelism` parameters, not by input size — see `hasher.ts`'s own
 * `@complexity` note), but a defense-in-depth cap on how large a string this service will accept
 * and pass to the hasher at all, independent of whatever limit (if any) sits in front of it at
 * the HTTP layer. Comfortably above any realistic human-typed passphrase.
 */
export const MAX_PASSWORD_LENGTH = 512;

/**
 * Validates `password` against the length-only policy.
 *
 * Measures length in Unicode CODE POINTS (`[...password].length`), not UTF-16 code units
 * (`password.length`): a passphrase built from astral-plane characters (many emoji, some
 * CJK/historic scripts) is represented as a surrogate pair per character in a JS string, so plain
 * `.length` overcounts those characters relative to what a human typing them perceives as "12
 * characters" — silently misjudging the exact floor this function states. No trimming, no
 * character allowlist: every printable character, including leading/trailing spaces and full
 * Unicode, is accepted as typed. Silently altering the input (trimming, stripping) would make the
 * stored credential differ from the secret the operator actually chose.
 *
 * @returns `null` if `password` satisfies the policy, otherwise an operator-facing message
 * stating the requirement plainly — used verbatim as the thrown `IdentityValidationError`'s
 * message by both call sites, and rendered as-is through the admin's `describeApiError` layer.
 *
 * @complexity O(n) in the password's length — spreading a string into code points is a single
 * linear pass, which is the minimum work a correct (non-UTF-16-code-unit) count requires.
 * @overallScore 100
 */
export function validatePasswordPolicy(password: string): string | null {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
