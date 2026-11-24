/**
 * The one refusal type of site share/backup. It is a class, so callers tell an expected, caller-safe
 * refusal from an unexpected failure with `instanceof`; the process must hold exactly one copy of it.
 */
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
