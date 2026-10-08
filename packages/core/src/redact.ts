/**
 * @module redact
 *
 * Lexical secret / PII scrubber for telemetry payloads. Originally a verbatim port of
 * OD's daemon redactor — no product-identity strings or hardcoded env vars in the original,
 * so no genericization was needed. The shared kernel now also covers the CLI/provider rule
 * union and accepts explicit host secrets; the original categories and rationale stay here.
 *
 * Runs before any prompt or assistant text is sent to an external
 * observability sink. The default policy is intentionally conservative:
 * each one matches a well-defined token shape with extremely low
 * false-positive rate (API keys have a fixed prefix, JWTs have the
 * "header.payload.signature" triple, credit-card matches go through a Luhn
 * check). What this file does NOT do — and any caller-facing copy must
 * reflect that — is detect names, addresses, business secrets, or anything
 * that requires understanding the meaning of the surrounding text. That's
 * an ML / LLM problem this module doesn't take on. Callers can explicitly opt
 * into `policy: 'aggressive'` to also mask bare 20+ character opaque runs;
 * that CLI-style heuristic trades identifier/path readability for broader masking
 * and must never be used by diagnostics or secret-scan guards.
 *
 * Output format: every match is replaced by `[REDACTED:<kind>]` so a
 * reviewer reading a trace can see exactly which category fired without
 * recovering the original value.
 *
 * References:
 * - Langfuse client-side masking guidance:
 *   https://langfuse.com/docs/observability/features/masking
 * - GitHub token format:
 *   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
 * - AWS access key shape: 'AKIA' + 16 uppercase alphanumerics.
 * - Luhn algorithm (credit cards): https://en.wikipedia.org/wiki/Luhn_algorithm
 */

/** Credential-shape vocabulary for secret-only redaction; no I/O or host dependencies. */

export interface SecretShapePattern {
  readonly name: string;
  readonly pattern: RegExp;
}

// Named once and reused (by SECRET_SHAPE_PATTERNS here and by the guard's ALLOWLIST) rather than repeated
// as a literal in multiple places.
export const PEM_PATTERN_NAME = "PEM private key block";

// Share data between static scans and runtime redactors without importing a CLI entry point:
// top-level argv/path handling in a scanner can crash a daemon that imports it. Keeping the
// vocabulary dependency-free also avoids making core redaction depend on feature code.
// Match each vendor's actual alphabet. Fixed-length patterns need lookaround boundaries so a
// credential-shaped substring of a longer inert value is not mistaken for a complete secret.
export const SECRET_SHAPE_PATTERNS: readonly SecretShapePattern[] = [
  { name: "Google API key (AIza)", pattern: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/ },
  { name: "Anthropic API key (sk-ant-)", pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{90,}/ },
  { name: "generic sk- secret key (OpenAI-shaped)", pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{40,}/ },
  { name: "GitHub personal access token (classic, ghp_)", pattern: /(?<!\w)ghp_\w{36}(?!\w)/ },
  { name: "GitHub OAuth token (gho_)", pattern: /(?<!\w)gho_\w{36}(?!\w)/ },
  { name: "GitHub fine-grained PAT", pattern: /(?<!\w)github_pat_\w{80,}/ },
  { name: "npm access token", pattern: /(?<!\w)npm_\w{36}(?!\w)/ },
  { name: "Slack token", pattern: /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{12,}/ },
  { name: "AWS access key ID", pattern: /(?<![0-9A-Z])AKIA[0-9A-Z]{16}(?![0-9A-Z])/ },
  { name: "Fastmail app password (fm2_)", pattern: /(?<![A-Za-z0-9+/=])fm2_[A-Za-z0-9+/=]{20,}/ },
  { name: PEM_PATTERN_NAME, pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export interface SecretRedactionPattern {
  name: string;
  regex: RegExp;
}

// Order matters: list specific rules before more general ones. Langfuse
// keys (`sk-lf-...`) would otherwise be eaten by the generic `sk-...`
// rule and labeled as a generic OpenAI-style key.
const PATTERNS: readonly SecretRedactionPattern[] = [
  // Langfuse public/secret keys (pk-lf- / sk-lf-). Must run before the
  // generic sk- rule so the more specific label wins.
  { name: 'langfuse_key', regex: /\b(?:pk|sk)-lf-[A-Za-z0-9-]{16,}\b/g },

  // Anthropic / OpenAI-style keys: 'sk-' + optional sub-prefix + base64-ish.
  // Both vendors plus a long tail of OpenAI-compatible providers (DeepSeek,
  // MiniMax, Together, etc.) ship keys in this shape, so a single rule
  // covers most "sk-..." secrets a user might paste into a prompt.
  { name: 'sk_key', regex: /\bsk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{20,}\b/g },

  // GitHub personal / OAuth / server / user-server / refresh tokens.
  { name: 'github_token', regex: /\bgh[opsur]_[A-Za-z0-9]{36,}\b/g },

  // GitHub legacy 40-hex personal access tokens that ship with no prefix
  // are indistinguishable from a sha1 hash, so we don't try to match them
  // here — false positives would be brutal in commit logs / artifact slugs.

  // AWS access key id. The matching secret access key is just 40 base64
  // chars with no fixed shape, so we cannot reliably redact it without
  // huge collateral damage; flagging the access key id at least
  // signals a paste happened.
  { name: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },

  // Google API keys — legacy AIza… (Maps / AI Studio) and service-account-
  // bound AQ.… keys AI Studio now issues. AQ. must run before the generic
  // sk_ rule would mis-label unrelated tokens.
  { name: 'google_api_key', regex: /\bAQ\.[A-Za-z0-9_-]{20,}\b/g },
  { name: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },

  // Slack tokens.
  { name: 'slack_token', regex: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g },

  // Stripe keys.
  { name: 'stripe_key', regex: /\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },

  // JSON Web Tokens. The "header.payload.signature" triple is distinctive
  // enough that false positives are rare (the literal "eyJ" prefix is the
  // base64 encoding of '{"' which is how every JOSE header starts).
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },

  // Bearer tokens in HTTP Authorization header copy/paste. We only match
  // the value, not the literal 'Bearer ', so the marker stays readable in
  // the redacted output ("Authorization: Bearer [REDACTED:bearer_token]").
  { name: 'bearer_token', regex: /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{16,}={0,2}/g },

  // Email addresses. Conservative enough to require a TLD-like trailer.
  { name: 'email', regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },

  // IPv4. Reject all-zero / 255.255.255.255-ish junk shapes by gating on
  // each octet being 0-255.
  {
    name: 'ipv4',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
  },

  // Phone numbers. Tight US-leaning shape; a global PII detector would
  // need a real lib. We keep this so US-based test prompts ('call me at
  // (415) 555-...') don't ship. Note: no leading \b — '(' isn't a word
  // char, so a starting boundary would refuse to match `(415)`. Reject
  // adjacent word characters or hyphens so digit segments of UUIDs,
  // hashes and identifiers stay readable; separators within phones still match.
  {
    name: 'phone',
    regex: /(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g,
  },
];

// Credit card sweep is special: a naive 13-19 digit run matches a lot of
// non-card numbers (timestamps, IDs, hashes). We isolate the candidate
// then run a Luhn check before redacting.
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;
const API_KEY_HEADER =
  /(^|[^?&\w-])("?)(x-api-key|api-key|x-goog-api-key)\2(\s*[:=]\s*)("[^"]*"|[^\s,;"'#}]+)/gi;
const API_KEY_QUERY = /([?&](?:key|api_key|api-key)=)[^&#\s,;"']+/gi;

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

function redactApiKeyHeaderValue(prefix: string, quote: string, name: string, separator: string, value: string): string {
  const redactedValue = value.startsWith('"') ? '"[REDACTED:api_key_header]"' : '[REDACTED:api_key_header]';
  return `${prefix}${quote}${name}${quote}${separator}${redactedValue}`;
}

/** Optional caller-owned secrets and named lexical rules, without ambient credential lookup. */
export interface SecretRedactionOptions {
  /** Conservative by default; aggressive also masks bare 20+ character opaque runs. */
  policy?: 'conservative' | 'aggressive';
  exactSecrets?: ReadonlyArray<string | undefined | null>;
  extraPatterns?: readonly SecretRedactionPattern[];
}

// A labeled credential has its value masked even when too short to have a vendor token shape.
// Bare long opaque runs are opt-in CLI heuristics: UUIDs, hashes, model IDs and path segments
// share that alphabet, so the default telemetry policy must leave them readable. Whole
// correlation IDs and the delegated-tool route stay readable even in aggressive mode;
// appending secret characters defeats that exception. The host's ERR-XXXX-XXXX-XXXX-XXXX
// correlation ID uses uppercase hex and is meant to reach the model and be quoted to an
// operator; delegated-tool-calls is the route segment named in delegated tool failures.
// Matching the ENTIRE run keeps a secret glued onto either spelling redactable.
export const LABELED_SECRET_RE =
  /\b(authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|cookie)\b\s*[:=]\s*\S+/gi;
export const OPAQUE_TOKEN_RE = /[A-Za-z0-9_-]{20,}/g;
export const NON_SECRET_TOKEN_RE = /^(?:ERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}|delegated-tool-calls)$/;
// Runtime markers must survive a second pass; the bounded sanitizer deliberately retains
// its historical lowercase marker contract and uses the unmodified lexical vocabulary.
// Reject a masked header/query value before matching, so a following field's credential
// remains available to the global scan rather than being consumed beside the marker.
const MASK_AWARE_LABELED_SECRET_RE = new RegExp(
  LABELED_SECRET_RE.source.replace(/\\S\+$/, "(?!Bearer\\s+\\[REDACTED:[^\\]]+\\](?:\\s|$))(?!\\[REDACTED:[^\\]]+\\][;&])(\\S+)"),
  LABELED_SECRET_RE.flags,
);
// Provider failures also echo short bearer values. Exclude our own marker on subsequent passes.
const SHORT_BEARER_RE = /(?<=Bearer\s+)[A-Za-z0-9_\-.+/=]+/gi;
const PROVIDER_API_KEY_HEADER = /(x-api-key|api-key|x-goog-api-key)\s*[:=]\s*([^\s,;"']+)/gi;
const PROVIDER_API_KEY_QUERY = /([?&]key=)([^&\s]+)/gi;
// URL userinfo and signed query values have explicit credential context; unlike opaque runs,
// they are safe to recognize in the conservative policy. Keep scheme/host and query names
// readable for debugging without exposing credentials that authorize access to the resource.
const URL_CREDENTIALS_RE = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s?#@]+)@/gi;
const SIGNED_QUERY_RE = /([?&](?:signature|sig|x-amz-signature|x-goog-signature|access_token|refresh_token)=)([^&#\s,;"']+)/gi;

// Only an entire marker is already masked. A secret glued onto marker-like text still needs
// masking; a substring check would preserve credential suffixes in echoed header/query values.
function isMaskedValue(value: string): boolean {
  return /^["']?\[REDACTED:[^\]]+\]["']?$/.test(value);
}

/**
 * Returns `input` with every recognised secret / PII pattern replaced by a
 * `[REDACTED:<kind>]` marker. Idempotent — re-running on already redacted
 * text only matches new tokens. Defaults to conservative; `{ policy: 'aggressive' }`
 * additionally masks bare 20+ character opaque runs. Exact secrets and extra patterns
 * are honored under either policy.
 *
 * Empty / non-string input passes through unchanged so the caller can use
 * this as a no-op on optional fields.
 */
export function redactSecrets({ input }: { input: string }, options: SecretRedactionOptions = {}): string {
  return redactSecretsWithCounts({ input }, options).redacted;
}

/**
 * Same as {@link redactSecrets} but also returns per-category counts so the
 * caller can attach an audit summary to the trace metadata ('we stripped 2
 * keys + 1 email before send').
 *
 * Exact secrets run first, longest first: lexical rules or a shorter supplied secret must not
 * split a known credential and leave a suffix behind. Opt-in aggressive opaque rules precede
 * PII rules for the same reason (a numeric token can also contain phone/card candidates).
 */
export function redactSecretsWithCounts({ input }: { input: string }, options: SecretRedactionOptions = {}): {
  redacted: string;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  if (!input) return { redacted: input, counts };
  let out = input;
  const marker = (name: string): string => {
    counts[name] = (counts[name] ?? 0) + 1;
    return `[REDACTED:${name}]`;
  };
  const applyPattern = ({ name, regex }: SecretRedactionPattern): void => {
    // Clone host/global regexes so lastIndex state never leaks across requests. Named extra
    // patterns use the same global replacement contract as the built-in vocabulary.
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    out = out.replace(new RegExp(regex.source, flags), () => marker(name));
  };
  const secrets = [...new Set((options.exactSecrets ?? []).filter(
    (secret): secret is string => typeof secret === 'string' && secret.length > 0,
  ))].sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), () => marker('exact_secret'));
  }
  out = out.replace(URL_CREDENTIALS_RE, (match, scheme: string, userinfo: string) =>
    isMaskedValue(userinfo) ? match : `${scheme}${marker('url_credentials')}@`,
  );
  out = out.replace(SIGNED_QUERY_RE, (match, prefix: string, value: string) =>
    isMaskedValue(value) ? match : `${prefix}${marker('signed_query')}`,
  );
  const piiNames = new Set(['email', 'ipv4', 'phone']);
  for (const pattern of PATTERNS) {
    if (!piiNames.has(pattern.name)) applyPattern(pattern);
  }
  for (const shape of SECRET_SHAPE_PATTERNS) applyPattern({ name: 'credential', regex: shape.pattern });
  for (const pattern of options.extraPatterns ?? []) applyPattern(pattern);

  out = out.replace(API_KEY_HEADER, (_match, prefix: string, quote: string, name: string, separator: string, value: string) => {
    // Already masked values are not new credentials and should not inflate the audit count.
    if (isMaskedValue(value)) return `${prefix}${quote}${name}${quote}${separator}${value}`;
    marker('api_key_header');
    return redactApiKeyHeaderValue(prefix, quote, name, separator, value);
  });
  // The provider rule includes a query fragment in an echoed key; mask that whole value
  // before the narrower core query rule can split it and leave a credential suffix behind.
  out = out.replace(PROVIDER_API_KEY_QUERY, (match, prefix: string, value: string) =>
    isMaskedValue(value) ? match : `${prefix}${marker('api_key_query')}`,
  );
  out = out.replace(API_KEY_QUERY, (match, prefix: string) =>
    isMaskedValue(match.slice(prefix.length)) ? match : `${prefix}${marker('api_key_query')}`,
  );
  out = out.replace(SHORT_BEARER_RE, () => marker('bearer_token'));
  out = out.replace(PROVIDER_API_KEY_HEADER, (match, name: string, value: string) =>
    isMaskedValue(value) ? match : `${name}: ${marker('api_key_header')}`,
  );
  out = out.replace(MASK_AWARE_LABELED_SECRET_RE, (match, _label: string, value: string) => {
    // Replace only the captured value, retaining labels even when no whitespace separates
    // them. Glued credential suffixes fail the complete-marker check and remain maskable.
    if (isMaskedValue(value)) return match;
    return `${match.slice(0, -value.length)}${marker('labeled_secret')}`;
  });
  if (options.policy === 'aggressive') {
    out = out.replace(OPAQUE_TOKEN_RE, (match) => NON_SECRET_TOKEN_RE.test(match) ? match : marker('opaque_token'));
  }
  for (const pattern of PATTERNS) {
    if (piiNames.has(pattern.name)) applyPattern(pattern);
  }
  out = out.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '');
    return isLuhnValid(digits) ? marker('credit_card') : match;
  });
  return { redacted: out, counts };
}
