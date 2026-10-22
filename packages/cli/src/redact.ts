/**
 * @module redact
 *
 * Bounded, redacted rendering of text that ultimately traces back to an
 * untrusted network peer — a daemon's error body, a `fetch()` rejection's
 * cause message — rather than to this process's own code. Three problems
 * are addressed together because a hostile or merely buggy daemon can
 * combine them: an unbounded body can be enormous, an arbitrary body can
 * contain terminal control/ANSI escape sequences that manipulate the
 * user's terminal when printed verbatim, and it can echo back secrets (an
 * `Authorization` header, an API key, a bearer/refresh token) that were
 * present in the request or in an upstream provider's own error.
 *
 * Added per CR-004 / SEC-RB-009 (`ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`,
 * `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`):
 * `http.ts` and `errors.ts` previously wrote raw fetch-cause messages,
 * arbitrary daemon JSON, or complete non-JSON response bodies straight to
 * the terminal.
 */

import { sanitizeUntrustedText } from '@jini-ai/core/text';

/** Recursion/branching caps for {@link sanitizeUnknownDeep} — bounds the work done on an arbitrary parsed-JSON tree. */
const MAX_SANITIZE_DEPTH = 4;
const MAX_SANITIZE_ENTRIES = 50;

/**
 * Recursively sanitize an arbitrary parsed-JSON value (the shape a daemon error envelope's
 * `data`/`details` field can legitimately be): every string leaf is passed through
 * {@link sanitizeUntrustedText}, and both array length and object key count are capped per
 * level so a maliciously wide or deep payload can't blow up the work done here. Depth beyond
 * the cap is replaced with a placeholder rather than silently dropped, so truncation is visible
 * instead of looking like an empty/missing value.
 */
export function sanitizeUnknownDeep({ value }: { value: unknown }, { depth = 0 }: { depth?: number } = {}): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[omitted: nested too deeply]';
  if (typeof value === 'string') return sanitizeUntrustedText({ text: value });
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SANITIZE_ENTRIES).map((item) => sanitizeUnknownDeep({ value: item }, { depth: depth + 1 }));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value).slice(0, MAX_SANITIZE_ENTRIES)) {
      out[sanitizeUntrustedText({ text: key }, { maxLength: 100 })] = sanitizeUnknownDeep({ value: val }, { depth: depth + 1 });
    }
    return out;
  }
  // numbers, booleans, null, undefined: nothing to sanitize.
  return value;
}
