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

/** Hard cap on how much untrusted text {@link sanitizeUntrustedText} will ever return, absent an override. */
const DEFAULT_MAX_EXCERPT_LENGTH = 500;

/** Recursion/branching caps for {@link sanitizeUnknownDeep} — bounds the work done on an arbitrary parsed-JSON tree. */
const MAX_SANITIZE_DEPTH = 4;
const MAX_SANITIZE_ENTRIES = 50;

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const OSC_OPEN = 0x5d; // ']'
const CSI_OPEN = 0x5b; // '['

function isCsiFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e; // '@'..'~'
}

function isOtherControlCode(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false; // tab / LF / CR pass through
  if (code <= 0x1f) return true; // remaining C0 controls (ESC itself is handled separately)
  if (code === 0x7f) return true; // DEL
  if (code >= 0x80 && code <= 0x9f) return true; // C1 controls
  return false;
}

/**
 * Strip ANSI/terminal escape sequences (CSI `ESC [ ... final-byte`, OSC `ESC ] ... BEL-or-ST`,
 * and bare ESC-prefixed bytes) plus other C0/C1 control characters from `text`. Written as an
 * explicit char-code scanner rather than a regex literal with hex escapes, so the pattern is
 * plain ASCII source with no embedded control bytes.
 */
export function stripControlSequences(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === ESC) {
      const next = text.charCodeAt(i + 1);
      if (next === CSI_OPEN) {
        let j = i + 2;
        while (j < text.length && !isCsiFinalByte(text.charCodeAt(j))) j++;
        i = j; // land on the final byte; the outer loop's i++ steps past it
        continue;
      }
      if (next === OSC_OPEN) {
        let j = i + 2;
        while (
          j < text.length &&
          text.charCodeAt(j) !== BEL &&
          !(text.charCodeAt(j) === ESC && text.charCodeAt(j + 1) === BACKSLASH)
        ) {
          j++;
        }
        if (j < text.length && text.charCodeAt(j) === BEL) i = j;
        else i = Math.min(j + 1, text.length - 1);
        continue;
      }
      continue; // bare ESC (or an unrecognized ESC-prefixed byte): drop just the ESC byte
    }
    if (isOtherControlCode(code)) continue;
    out += text[i];
  }
  return out;
}

// A labeled credential (`Authorization: ...`, `api-key=...`) has everything after the label
// redacted. A bare run of 20+ base64url/hex-alphabet characters is treated as a possible
// opaque token/secret and redacted outright, even with no label.
const LABELED_SECRET_RE =
  /\b(authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|cookie)\b\s*[:=]\s*\S+/gi;
const OPAQUE_TOKEN_RE = /[A-Za-z0-9_-]{20,}/g;

/**
 * Whole opaque-token runs that are known not to be secrets, kept verbatim. Matched against the
 * ENTIRE run, so a secret glued onto one of these is still one longer run and still redacted:
 * - a host's tool-failure correlation id (`ERR-XXXX-XXXX-XXXX-XXXX`, upper-case hex — Tovu's
 *   `mintToolErrorId`), which exists to be shown to the model and quoted back to an operator;
 * - `delegated-tool-calls`, the daemon route segment every delegated tool failure names in its URL.
 */
const NON_SECRET_TOKEN_RE = /^(?:ERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}|delegated-tool-calls)$/;

/** Redact labeled credentials and long opaque-token-looking substrings from `text`. */
export function redactSecretLike(text: string): string {
  return text
    .replace(LABELED_SECRET_RE, (match) => match.replace(/\S+$/, '[redacted]'))
    .replace(OPAQUE_TOKEN_RE, (match) => (NON_SECRET_TOKEN_RE.test(match) ? match : '[redacted]'));
}

export interface SanitizeTextOptions {
  /** Maximum output length; longer input is truncated with a trailing marker. Defaults to 500. */
  maxLength?: number;
}

/**
 * Strip terminal control sequences, redact anything that looks like a secret, and cap the
 * length of `text` — the one function every boundary that surfaces daemon/network-derived text
 * to stderr/stdout should route through first.
 */
export function sanitizeUntrustedText(text: string, options: SanitizeTextOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_EXCERPT_LENGTH;
  const sanitized = redactSecretLike(stripControlSequences(text));
  if (sanitized.length <= maxLength) return sanitized;
  const omitted = sanitized.length - maxLength;
  return `${sanitized.slice(0, maxLength)}… [truncated ${omitted} more characters]`;
}

/**
 * Recursively sanitize an arbitrary parsed-JSON value (the shape a daemon error envelope's
 * `data`/`details` field can legitimately be): every string leaf is passed through
 * {@link sanitizeUntrustedText}, and both array length and object key count are capped per
 * level so a maliciously wide or deep payload can't blow up the work done here. Depth beyond
 * the cap is replaced with a placeholder rather than silently dropped, so truncation is visible
 * instead of looking like an empty/missing value.
 */
export function sanitizeUnknownDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[omitted: nested too deeply]';
  if (typeof value === 'string') return sanitizeUntrustedText(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SANITIZE_ENTRIES).map((item) => sanitizeUnknownDeep(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value).slice(0, MAX_SANITIZE_ENTRIES)) {
      out[sanitizeUntrustedText(key, { maxLength: 100 })] = sanitizeUnknownDeep(val, depth + 1);
    }
    return out;
  }
  // numbers, booleans, null, undefined: nothing to sanitize.
  return value;
}
