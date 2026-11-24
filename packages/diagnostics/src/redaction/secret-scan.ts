import { SECRET_PATTERNS } from "../core/secrets-only.js";

export interface SecretScanHit {
  readonly patternName: string;
  /** Character offset within the scanned text where the match starts. */
  readonly index: number;
  /** The exact matched substring — the allowlist is scoped to this, not just (file, patternName),
   *  so a NEW different secret matching the same pattern in an already-allowlisted file is still
   *  caught (see file header's Allowlist section). */
  readonly value: string;
}

/** Core scanner, unit-testable directly against synthetic text (no filesystem, no git).
 *  @complexity O(p*n), p = pattern count (fixed, small), n = text length. */
export function scanTextForSecrets({ text }: { text: string }, _optional = {}): SecretScanHit[] {
  const hits: SecretScanHit[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      hits.push({ patternName: name, index: match.index, value: match[0] });
      if (match[0].length === 0) re.lastIndex += 1; // guard against zero-length matches looping
    }
  }
  return hits;
}
