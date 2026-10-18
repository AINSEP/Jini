import { redactSecrets, LABELED_SECRET_RE, OPAQUE_TOKEN_RE, NON_SECRET_TOKEN_RE } from "../redact.js";
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
export function stripControlSequences({ text }: { text: string }): string {
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

/** Exact diagnostic vocabulary only: unknown spellings and glued suffixes remain opaque. */
const DIAGNOSTIC_TOKENS = new Set([
  'additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems',
  'dependentRequired', 'dependentSchemas', 'exclusiveMinimum', 'exclusiveMaximum',
  'minContains', 'maxContains', 'patternProperties', 'propertyNames', 'prefixItems',
  'contentEncoding', 'contentMediaType', 'contentSchema',
]);

/** Mask credentials before preserving complete trusted IDs; redact opaque spans everywhere else. */
function redactSecretLike({ text, diagnosticToolIds }: { text: string; diagnosticToolIds: ReadonlySet<string> }): string {
  return redactSecrets({ input: text }, { redactPii: false })
    .replace(LABELED_SECRET_RE, match => match.replace(/([:=]\s*)\S+$/, '$1[redacted]'))
    .replace(/\[REDACTED:[^\]\r\n]+\]/g, '[redacted]')
    // Trust whole dotted IDs so their components cannot become a general redaction bypass.
    .replace(/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, token => diagnosticToolIds.has(token) ? token
      : token.replace(OPAQUE_TOKEN_RE, match => NON_SECRET_TOKEN_RE.test(match) || DIAGNOSTIC_TOKENS.has(match) ? match : '[redacted]'));
}

export interface SanitizeTextOptions {
  /** Exact IDs from trusted registration metadata, never inferred from error text or arguments.
   * Credential rules still run first; prefixes and glued suffixes are never exempted. */
  diagnosticToolIds?: readonly string[];
  /** Maximum output length; longer input is truncated with a trailing marker. Defaults to 500. */
  maxLength?: number;
}

/**
 * Strip terminal control sequences, redact anything that looks like a secret, and cap the
 * length of `text` — the one function every boundary that surfaces daemon/network-derived text
 * to stderr/stdout should route through first.
 * Trusted diagnosticToolIds exempt complete IDs (including dots) only, after credential masking.
 * @complexity O(n + t) local time/space for n text bytes and t trusted ID bytes.
 */
export function sanitizeUntrustedText({ text }: { text: string }, options: SanitizeTextOptions = {}): string {
  const requestedLength = options.maxLength ?? DEFAULT_MAX_EXCERPT_LENGTH;
  const maxLength = Number.isFinite(requestedLength) ? Math.max(0, Math.floor(requestedLength)) : DEFAULT_MAX_EXCERPT_LENGTH;
  const sanitized = redactSecretLike({ text: stripControlSequences({ text }), diagnosticToolIds: new Set(options.diagnosticToolIds) });
  if (sanitized.length <= maxLength) return sanitized;
  // The marker is part of the output budget, including when the budget cannot fit the full marker.
  const marker = '… [truncated]';
  if (maxLength < marker.length) return marker.slice(0, maxLength);
  return `${sanitized.slice(0, maxLength - marker.length)}${marker}`;
}
