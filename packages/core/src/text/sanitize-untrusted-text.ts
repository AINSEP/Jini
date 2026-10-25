import { redactSecrets, GENERATED_MARKER_RE, LABELED_SECRET_RE, OPAQUE_TOKEN_RE, NON_SECRET_TOKEN_RE, type SecretRedactionOptions } from "../redact.js";
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

/** True when position `j` starts an OSC terminator: BEL, or ST (`ESC \\`). */
function isOscTerminatorAt(text: string, j: number): boolean {
  const code = text.charCodeAt(j);
  return code === BEL || (code === ESC && text.charCodeAt(j + 1) === BACKSLASH);
}

/** Index of a CSI's final byte at or after `from`, or `text.length` when the CSI is truncated. */
function csiEnd(text: string, from: number): number {
  let j = from;
  while (j < text.length && !isCsiFinalByte(text.charCodeAt(j))) j++;
  return j;
}

/** Index of the last code unit of an OSC body starting at `from`: the BEL, the `\\` of ST, or the
 * final code unit when the OSC is never terminated. */
function oscEnd(text: string, from: number): number {
  let j = from;
  while (j < text.length && !isOscTerminatorAt(text, j)) j++;
  // charCodeAt past the end is NaN, so a truncated OSC never matches BEL here.
  if (text.charCodeAt(j) === BEL) return j;
  return Math.min(j + 1, text.length - 1);
}

/** Index of the last code unit consumed by the escape sequence whose ESC sits at `start`. */
function escapeSequenceEnd(text: string, start: number): number {
  const next = text.charCodeAt(start + 1);
  if (next === CSI_OPEN) return csiEnd(text, start + 2);
  if (next === OSC_OPEN) return oscEnd(text, start + 2);
  return start; // bare ESC (or an unrecognized ESC-prefixed byte): drop just the ESC byte
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
      i = escapeSequenceEnd(text, i); // land on the last consumed byte; the loop's i++ steps past it
      continue;
    }
    if (!isOtherControlCode(code)) out += text[i];
  }
  return out;
}

/** Exact diagnostic vocabulary only: unknown spellings and glued suffixes remain opaque. */
const DIAGNOSTIC_TOKENS: ReadonlySet<string> = new Set([
  'additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems',
  'dependentRequired', 'dependentSchemas', 'exclusiveMinimum', 'exclusiveMaximum',
  'minContains', 'maxContains', 'patternProperties', 'propertyNames', 'prefixItems',
  'contentEncoding', 'contentMediaType', 'contentSchema',
]);

/** Short lowercase slugs with at least one letter-only segment and two separators.
 * Bound both segments and total length so long passphrases do not become diagnostic exemptions.
 * UUIDs, numeric-only runs, mixed case and letter+digit segments never qualify.
 * @complexity O(n) in token length; pure. */
function isIdentifierShaped({ token }: { token: string }): boolean {
  return token.length <= 31 && /[a-z]/.test(token)
    && /^(?:[a-z]{1,15}|[0-9]{1,15})(?:[-_](?:[a-z]{1,15}|[0-9]{1,15})){2,}$/.test(token);
}

/** Mask credentials before preserving trusted IDs and UPPER_SNAKE diagnostics; redact opaque spans elsewhere.
 * `keepIdentifiers` additionally exempts identifier-shaped runs (see {@link isIdentifierShaped}).
 * @complexity Local scans of text plus core's exact-secret replacements; no I/O. */
function redactSecretLike({ text }: { text: string }, options: SanitizeTextOptions = {}): string {
  const diagnosticToolIds = new Set(options.diagnosticToolIds);
  const keepOpaque = (match: string): boolean => NON_SECRET_TOKEN_RE.test(match) || DIAGNOSTIC_TOKENS.has(match)
    || (options.keepIdentifiers === true && isIdentifierShaped({ token: match }));
  return redactSecrets({ input: text }, { redactPii: false, exactSecrets: options.exactSecrets ?? [] })
    .replace(LABELED_SECRET_RE, match => match.replace(/([:=]\s*)\S+$/, '$1[redacted]'))
    // Only markers redact generates: a bounded category alternation, where `[^\]]+` rescanned the
    // rest of the text after every unterminated `[REDACTED:` (quadratic on large responses).
    .replace(GENERATED_MARKER_RE, '[redacted]')
    // Trust whole dotted IDs so their components cannot become a general redaction bypass.
    .replace(/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, token => diagnosticToolIds.has(token) ? token
      : token.replace(OPAQUE_TOKEN_RE, match => keepOpaque(match) ? match : '[redacted]'));
}

export interface SanitizeTextOptions {
  /** Model-facing error paths keep slugs/tool IDs that would otherwise read as opaque tokens. Default false. */
  keepIdentifiers?: boolean;
  /** Known credentials forwarded to core's exact-secret redactor. */
  exactSecrets?: SecretRedactionOptions['exactSecrets'];
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
 * keepIdentifiers exempts only identifier-shaped opaque runs; every other opaque run stays masked.
 * @complexity O(n + t) local time/space for n text bytes and t trusted ID bytes,
 * plus core's exact-secret replacements when supplied.
 */
export function sanitizeUntrustedText({ text }: { text: string }, options: SanitizeTextOptions = {}): string {
  const requestedLength = options.maxLength ?? DEFAULT_MAX_EXCERPT_LENGTH;
  const maxLength = Number.isFinite(requestedLength) ? Math.max(0, Math.floor(requestedLength)) : DEFAULT_MAX_EXCERPT_LENGTH;
  const sanitized = redactSecretLike({ text: stripControlSequences({ text }) }, options);
  if (sanitized.length <= maxLength) return sanitized;
  // The marker is part of the output budget, including when the budget cannot fit the full marker.
  const marker = '… [truncated]';
  if (maxLength < marker.length) return marker.slice(0, maxLength);
  return `${sanitized.slice(0, maxLength - marker.length)}${marker}`;
}
