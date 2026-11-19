import { SECRET_SHAPE_PATTERNS } from './secret-shapes.js';
import { PATTERNS, CATEGORY, CARD_CANDIDATE, API_KEY_HEADER, API_KEY_QUERY, SHORT_BEARER_RE, BASIC_AUTH_RE, COOKIE_HEADER_RE, PROVIDER_API_KEY_QUERY, URL_CREDENTIALS_RE, SIGNED_QUERY_RE, URL_SECRET_PARAM_RE, LABELED_URL_PARAM_NAME_RE, OPAQUE_TOKEN_RE, NON_SECRET_TOKEN_RE, isMaskedValue, type SecretRedactionPattern, type SecretRedactionOptions } from './redaction-patterns.js';
import { collectMatches, trailingValue, type Span, type AddSpan, type SpanPass } from './redaction-spans.js';
import { collectLabeledSecrets, emptyAssignmentRanges, collectEmptyQuotedAssignments } from './redaction-labels.js';
import { collectExactSecrets } from './redaction-exact-secrets.js';

// The length guard and the per-digit `d < 0 || d > 9` guard from the origin
// were both dropped here (a documented deviation from the otherwise-verbatim
// port — see archived provenance ledger): `isLuhnValid` is private with exactly one call
// site (the `CARD_CANDIDATE.replace` callbacks below), and `CARD_CANDIDATE`'s
// own regex (`\b(?:\d[ -]?){12,18}\d\b`) already guarantees any string
// reaching here is 13-19 characters, and the preceding `match.replace(/\D/g,
// '')` strip guarantees every character is an ASCII digit — so both guards
// were provably unreachable, not speculative.
function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Every rule's spans over the original text, in rule-precedence order (see {@link mergeSpans}). */
export function collectSpans({ text }: { text: string }, options: SecretRedactionOptions): Span[] {
  const spans: Span[] = [];
  const add: AddSpan = (start, end, category, suffix) => {
    if (end > start || (end === start && suffix !== undefined)) spans.push({ start, end, category, suffix });
  };
  if (options.policy === 'exact-only') {
    collectExactSecrets({ text, add, secrets: options.exactSecrets ?? [] }, { literalOnly: true });
    return spans;
  }
  collectExactSecrets({ text, add, secrets: options.exactSecrets ?? [] });
  // Whole PEM blocks use the existing shared vocabulary; every rule sees their original delimiters.
  collectEmptyQuotedAssignments({ text, add });
  collectUrlCredentials({ text, add });
  collectPatterns({ text, add, patterns: credentialPatterns(options.extraPatterns ?? []) });
  collectKeyedCredentials({ text, add });
  collectLabeledSecrets({ text, add }, spans);
  if (options.policy === 'aggressive') collectOpaqueTokens({ text, add }, new Set(options.diagnosticToolIds));
  if (options.redactPii !== false) collectPii({ text, add }, spans);
  return spans;
}

// PII rules are collected last (after credential and opt-in opaque rules) and only when PII
// redaction is on; splitting once keeps each list in PATTERNS order.
const PII_PATTERN_NAMES: readonly string[] = ['email', 'ipv4', 'phone'];
const NON_PII_PATTERNS = PATTERNS.filter((pattern) => !PII_PATTERN_NAMES.includes(pattern.name));
const PII_PATTERNS = PATTERNS.filter((pattern) => PII_PATTERN_NAMES.includes(pattern.name));

/** Built-in credential rules, then the static-scan shapes (labeled `credential`), then the caller's extra rules. */
function credentialPatterns(extraPatterns: readonly SecretRedactionPattern[]): SecretRedactionPattern[] {
  return [
    ...NON_PII_PATTERNS,
    ...SECRET_SHAPE_PATTERNS.map((shape) => ({ name: CATEGORY.credential, regex: shape.pattern })),
    ...extraPatterns,
  ];
}

function collectPatterns({ text, add, patterns }: SpanPass & { patterns: readonly SecretRedactionPattern[] }): void {
  for (const { name, regex } of patterns) {
    collectMatches({ text, add }, regex, (match, index) => ({ start: index, end: index + match[0].length, category: name }));
  }
}

/** URL userinfo and signed query values: credentials recognized by their URL context. */
function collectUrlCredentials(pass: SpanPass): void {
  collectMatches(pass, URL_CREDENTIALS_RE, (match, index) => {
    const userinfo = match[1] ?? '';
    if (isMaskedValue(userinfo)) return undefined;
    const start = index + '//'.length;
    return { start, end: start + userinfo.length, category: CATEGORY.urlCredentials };
  });
  collectMatches(pass, SIGNED_QUERY_RE, trailingValue(CATEGORY.signedQuery, 2));
}

/** Values named by a header, query parameter or bearer prefix. Each rule matches the original
 * text, so overlapping rules (the provider query rule includes a fragment the core rule stops
 * before) merge into one span instead of one leaving a credential suffix beside the other's marker. */
function collectKeyedCredentials(pass: SpanPass): void {
  collectApiKeyHeaders(pass);
  collectMatches(pass, PROVIDER_API_KEY_QUERY, trailingValue(CATEGORY.apiKeyQuery, 2));
  collectMatches(pass, API_KEY_QUERY, (match, index) => {
    const start = index + (match[1] ?? '').length;
    const end = index + match[0].length;
    return isMaskedValue(match[0].slice(start - index)) ? undefined : { start, end, category: CATEGORY.apiKeyQuery };
  });
  collectMatches(pass, SHORT_BEARER_RE, (match, index) => {
    const start = index + match[0].length;
    return { start, end: start + (match[1] ?? '').length, category: CATEGORY.bearerToken };
  });
  collectMatches(pass, BASIC_AUTH_RE, trailingValue(CATEGORY.labeledSecret, 1));
  collectMatches(pass, COOKIE_HEADER_RE, trailingValue(CATEGORY.labeledSecret, 1));
  collectUrlSecretParams(pass);
}

/** Header values stop at their quotes; an empty quoted hint cannot borrow the next field.
 * @complexity O(n) over input characters, no I/O. */
function collectApiKeyHeaders(pass: SpanPass): void {
  const hints = emptyAssignmentRanges(pass.text);
  collectMatches(pass, API_KEY_HEADER, (match, index) => {
    const labelStart = index + (match[1] ?? '').length;
    if (hints.has(labelStart)) return undefined;
    const value = match[5] ?? '';
    if (isMaskedValue(value)) return undefined;
    const end = index + match[0].length;
    // A quoted value keeps its quotes around the marker.
    const quoted = /^["']/.test(value) ? 1 : 0;
    return { start: end - value.length + quoted, end: end - quoted, category: CATEGORY.apiKeyHeader };
  });
}

/** Secret-named URL query/fragment values; values already masked keep their category. */
function collectUrlSecretParams(pass: SpanPass): void {
  collectMatches(pass, URL_SECRET_PARAM_RE, (match, index) => {
    const separator = match[0].indexOf('=') + 1;
    if (isMaskedValue(match[0].slice(separator))) return undefined;
    const category = LABELED_URL_PARAM_NAME_RE.test(match[1] ?? '') ? CATEGORY.labeledSecret : CATEGORY.urlSecretParam;
    return { start: index + separator, end: index + match[0].length, category };
  });
}

/** Opt-in bare opaque runs; whole trusted dotted IDs and non-secret diagnostic tokens stay readable. */
function collectOpaqueTokens({ text, add }: SpanPass, trustedIds: ReadonlySet<string>): void {
  for (const token of text.matchAll(/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g)) {
    if (trustedIds.has(token[0])) continue;
    for (const run of token[0].matchAll(OPAQUE_TOKEN_RE)) {
      if (NON_SECRET_TOKEN_RE.test(run[0])) continue;
      const start = (token.index ?? 0) + (run.index ?? 0);
      add(start, start + run[0].length, CATEGORY.opaqueToken);
    }
  }
}

/** Email/IPv4/phone rules, then Luhn-checked card candidates. The email rule retains alphabetic TLDs so versioned paths stay readable. An "email" whose `@` ends URL userinfo
 * (`scheme://user:pw@host`) is skipped: its local part is already the credential span, and
 * merging it would mask the host, which stays readable for debugging. */
function collectPii(pass: SpanPass, earlier: readonly Span[]): void {
  const userinfoEnds = new Set(earlier.filter(({ category }) => category === CATEGORY.urlCredentials).map(({ end }) => end));
  for (const { name, regex } of PII_PATTERNS) {
    collectMatches(pass, regex, (match, index) => name === 'email' && userinfoEnds.has(index) ? undefined
      : { start: index - (match.groups?.local?.length ?? 0), end: index + match[0].length, category: name });
  }
  collectMatches(pass, CARD_CANDIDATE, (match, index) =>
    isLuhnValid(match[0].replace(/\D/g, '')) ? { start: index, end: index + match[0].length, category: CATEGORY.creditCard } : undefined);
}
