/**
 * @file Username normalization (behavior.spec §5.1).
 *
 * A `users` row is a duplicate within a workspace iff its `username` equals an
 * existing user's after case-insensitive comparison and Unicode NFC
 * normalization. Normalizing once at every write/lookup site (seed, login,
 * future CREATE_USER) makes that comparison a direct equality check rather
 * than a repeated ad hoc string transform.
 */

/** NFC-normalize, trim, and lowercase a username for storage/lookup. */
export function normalizeUsername(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}
