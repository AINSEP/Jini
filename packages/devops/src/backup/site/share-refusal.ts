/** Private worker exit contract: distinguish schema refusal without exposing untrusted SQL/errors. */
export const IMPORT_SCHEMA_MISMATCH_EXIT_CODE = 2;
/** Private worker exit contract: exit 3 accompanies application-owned refusal.txt, never raw SQL errors. */
export const IMPORT_REFUSAL_EXIT_CODE = 3;

export class SiteShareRefusal extends Error {
  readonly code: string;
  constructor(required: { code: string; message: string }, { cause }: { cause?: unknown } = {}) { super(required.message, { cause }); this.code = required.code; this.name = "SiteShareRefusal"; }
}

/** Display an archive-controlled name in a refusal, never use this value for lookup.
 * Strip invisible controls before quoting, and bound each name to 120 UTF-16 units so a
 * hostile ZIP cannot flood or visually reorder a refusal. Pure; O(name.length) time/space.
 */
export function archiveRefusalName({ name }: { name: string }, _options = {}): string {
  const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, "");
  if (clean.length <= 120) return clean;
  // Do not split an astral character at the truncation boundary.
  return clean.slice(0, 119).replace(/[\uD800-\uDBFF]$/, "") + "…";
}
