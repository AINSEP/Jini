export interface SecretRedactionPattern {
  name: string;
  regex: RegExp;
}

// Order matters: list specific rules before more general ones. Langfuse
// keys (`sk-lf-...`) would otherwise be eaten by the generic `sk-...`
// rule and labeled as a generic OpenAI-style key.
// One IPv4 octet, 0-255, so junk shapes like 999.1.1.1 do not count.
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)';
// Optional +country code, then a bare or parenthesized area code, with optional separators.
const PHONE_SEPARATOR = '[\\s.-]?';
const PHONE_COUNTRY_CODE = /(?:\+?\d{1,3}[\s.-]?)?/;
const PHONE_AREA_CODE = /(?:\(\d{3}\)|\d{3})/;

export const PATTERNS: readonly SecretRedactionPattern[] = [
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
  { name: 'jwt', regex: /(?<!\w)(?<!(?<!\w)eyJ[A-Za-z0-9_-]*?)eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },

  // Bearer tokens in HTTP Authorization header copy/paste. We only match
  // the value, not the literal 'Bearer ', so the marker stays readable in
  // the redacted output ("Authorization: Bearer [REDACTED:bearer_token]").
  // The leading lookahead only lets the lookbehind run where a value can start, so a long
  // whitespace run is not rescanned from every position inside it.
  { name: 'bearer_token', regex: /(?=[A-Za-z0-9._~+/-])(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{16,}={0,2}/g },

  // Email addresses. Conservative enough to require a TLD-like trailer. The local part is
  // bounded at the RFC 5321 limit of 64: an unbounded run rescanned the suffix from every word
  // boundary, so `'a.'.repeat(20000)` blocked ~3 s on a large tool response. Matching starts at
  // the `@` and reads the local part in a lookbehind (captured as `local`): starting at every word
  // boundary still cost up to 64 steps per position, ~2.5 s on 10 MiB of `'eyJ-'`.
  // Alphabetic TLDs preserve versioned package paths in error stacks (e.g. pkg@1.2.3).
  { name: 'email', regex: /@(?<=\b(?<local>[\w.+-]{1,64})@)(?:[\w-]+\.)+[A-Za-z]{2,}\b/g },

  // IPv4. Reject all-zero / 255.255.255.255-ish junk shapes by gating on
  // each octet being 0-255.
  {
    name: 'ipv4',
    regex: new RegExp(`\\b(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}\\b`, 'g'),
  },

  // Phone numbers. Tight US-leaning shape; a global PII detector would
  // need a real lib. We keep this so US-based test prompts ('call me at
  // (415) 555-...') don't ship. Note: no leading \b — '(' isn't a word
  // char, so a starting boundary would refuse to match `(415)`. Reject
  // adjacent word characters or hyphens so digit segments of UUIDs,
  // hashes and identifiers stay readable; separators within phones still match.
  {
    name: 'phone',
    regex: new RegExp(`(?<![\\w-])${PHONE_COUNTRY_CODE.source}${PHONE_AREA_CODE.source}${PHONE_SEPARATOR}\\d{3}${PHONE_SEPARATOR}\\d{4}(?![\\w-])`, 'g'),
  },
];

// Categories the pipeline names directly; pattern rules carry their own names. Masked-value
// checks and exact-secret masking derive the set of markers redact can generate from these
// plus the pattern names.
export const CATEGORY = {
  exactSecret: 'exact_secret',
  credential: 'credential',
  urlCredentials: 'url_credentials',
  signedQuery: 'signed_query',
  apiKeyHeader: 'api_key_header',
  apiKeyQuery: 'api_key_query',
  bearerToken: 'bearer_token',
  labeledSecret: 'labeled_secret',
  urlSecretParam: 'url_secret_param',
  opaqueToken: 'opaque_token',
  creditCard: 'credit_card',
} as const;

// Only markers redact itself generates count as masked: arbitrary `[REDACTED:<text>]` would let
// echoed input such as `[REDACTED:<secret>]` keep the real secret. A fixed category alternation
// also bounds each marker attempt; `[^\]]*` rescanned the suffix after every unterminated
// `[REDACTED:`, which was quadratic on large tool responses.
const GENERATED_CATEGORIES: readonly string[] = [...PATTERNS.map(({ name }) => name), ...Object.values(CATEGORY)];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerSource(categories: Iterable<string>): string {
  return `\\[REDACTED:(?:${[...new Set(categories)].map(escapeRegExp).join('|')})\\]`;
}

export const GENERATED_MARKER = markerSource(GENERATED_CATEGORIES);
/** Every marker redact can generate from its built-in categories; consumers normalize only these. */
export const GENERATED_MARKER_RE = new RegExp(GENERATED_MARKER, 'g');

// Credit card sweep is special: a naive 13-19 digit run matches a lot of
// non-card numbers (timestamps, IDs, hashes). We isolate the candidate
// then run a Luhn check before redacting.
export const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;
// Inspect/JSON credentials can contain spaces and escaped quotes; consume the entire value.
export const QUOTED_SECRET_VALUE = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
export const API_KEY_HEADER =
  new RegExp(`(^|[^?&\\w])(["']?)(x-api-key|api-key|x-goog-api-key)\\2(\\s*[:=]\\s*)(${QUOTED_SECRET_VALUE}|[^\\s,;"'#}]+)`, 'gi');
export const API_KEY_QUERY = /([?&](?:key|api_key|api-key)=)[^&#\s,;"']+/gi;

/** Optional caller-owned secrets and named lexical rules, without ambient credential lookup. */
export interface SecretRedactionOptions {
  /** Diagnostic text can retain addresses/numbers while using the same credential rules. Default true. */
  redactPii?: boolean;
  /** Exact trusted registration IDs; credential patterns always take precedence. */
  diagnosticToolIds?: readonly string[];
  /** Conservative by default; aggressive masks opaque runs; exact-only replaces only supplied secrets. */
  policy?: 'conservative' | 'aggressive' | 'exact-only';
  /** Literal replacement under exact-only. Defaults to '[REDACTED:exact_secret]'; ignored otherwise. */
  marker?: string;
  exactSecrets?: ReadonlyArray<string | undefined | null>;
  extraPatterns?: readonly SecretRedactionPattern[];
}

// A labeled credential has its value masked even when too short to have a vendor token shape.
// Bare long opaque runs are opt-in CLI heuristics: UUIDs, hashes, model IDs and path segments
// share that alphabet, so the default telemetry policy must leave them readable. Whole
// correlation IDs, UPPER_SNAKE diagnostic codes and the delegated-tool route stay readable even in aggressive mode;
// appending secret characters defeats that exception. The host's ERR-XXXX-XXXX-XXXX-XXXX
// correlation ID uses uppercase hex and is meant to reach the model and be quoted to an
// operator; delegated-tool-calls is the route segment named in delegated tool failures.
// Matching the ENTIRE run keeps a secret glued onto either spelling redactable.
const SECRET_LABELS = 'authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|cookie';
// Keep historical URL categories and the bounded sanitizer's vocabulary stable.
const SERIALIZED_SECRET_LABELS = `${SECRET_LABELS}|x[-_](?:goog[-_])?api[-_]?key|api key|token|set[-_]cookie|private[-_]?key`;
export const EMPTY_QUOTED_ASSIGNMENT_RE = new RegExp(`\\b(?:${SERIALIZED_SECRET_LABELS})\\s*[:=]\\s*$`, 'i');
export const LABELED_SECRET_RE = new RegExp(`\\b(${SECRET_LABELS})\\b\\s*[:=]\\s*\\S+`, 'gi');
export const OPAQUE_TOKEN_RE = /[A-Za-z0-9_-]{20,}/g;
// Pattern parts, only ever used inside the anchored NON_SECRET_TOKEN_RE.
const CORRELATION_ID = 'ERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}';
const UPPER_SNAKE_DIAGNOSTIC = '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+';
export const NON_SECRET_TOKEN_RE = new RegExp(`^(?:${CORRELATION_ID}|delegated-tool-calls|${UPPER_SNAKE_DIAGNOSTIC})$`);
// Runtime markers must survive a second pass; the bounded sanitizer deliberately retains
// its historical lowercase marker contract and uses the unmodified lexical vocabulary.
// Reject a masked header/query value before matching, so a following field's credential
// remains available to the global scan rather than being consumed beside the marker.
// Only the value's first character is matched; forward-only finders supply its end (see
// labelValueExtents). Matching `\S+` and rewinding to skip a covered field rescanned the rest of
// the run per label: quadratic on `'api-key=x;'.repeat(n)`.
// Bare URL key/token parameters already have owners; leave their empty values and categories
// to those collectors instead of treating the following `&page=...` as a label's value.
const RUNTIME_SECRET_LABELS = `${SERIALIZED_SECRET_LABELS}|(?<![?&])(?:key)`;
export const MASK_AWARE_LABELED_SECRET_RE = new RegExp(
  `(?<![\\w-])(["']?)(${RUNTIME_SECRET_LABELS})\\1\\s*[:=]\\s*`
    + `(?!Bearer\\s+\\S)(?!${GENERATED_MARKER}[;&])((?!&)\\S)`,
  'gi',
);
// A label can name another label; resume at it instead of consuming `token:` and leaking its value.
export const CHAINED_LABEL_RE = new RegExp(`(?:${RUNTIME_SECRET_LABELS})\\b["']?\\s*[:=]\\s*(?=\\S)`, 'iy');
// Provider failures also echo short bearer values. Exclude our own marker on subsequent passes.
// The value is read in a lookahead so the scan resumes at it (`Bearer Bearer x` masks both),
// as the earlier lookbehind form did, without a lookbehind test at every position.
// Quotes and field delimiters end the value; punctuation such as `!` remains credential text.
export const SHORT_BEARER_RE = new RegExp(`Bearer\\s+["']?(?!${GENERATED_MARKER}(?=$|[\\s"',;<>}]))(?=([^\\s"',;<>}]+))`, 'gi');
export const BASIC_AUTH_RE = /\bauthorization["']?\s*[:=]\s*["']?(Basic\s+[^\s"',;}]+)/gi;
// Cookie pairs belong to one header value, including pairs after a semicolon and a space.
export const COOKIE_HEADER_RE = /\bcookie\s*:\s*([^\r\n]+)/gi;
export const PROVIDER_API_KEY_QUERY = /([?&]key=)([^&\s"']+)/gi;
// URL userinfo and signed query values have explicit credential context; unlike opaque runs,
// they are safe to recognize in the conservative policy. Keep scheme/host and query names
// readable for debugging without exposing credentials that authorize access to the resource.
// Matching starts at `//` and reads the userinfo forward to `@` within the authority. No scheme
// scan is needed, so a scheme of any length (glued text included) cannot hide its userinfo:
// an unbounded scheme run rescanned the suffix from every start
// (`'a.'.repeat(20000)` blocked ~3.6 s), trying a bounded scheme at every position cost ~2 s on
// 10 MiB of `'eyJ-'`, and a 32-character scheme lookbehind missed longer schemes.
// The same authority syntax also appears in scheme-relative URLs (`//user:pw@host`).
export const URL_CREDENTIALS_RE = /\/\/([^/\s?#@]+)@/g;
export const SIGNED_QUERY_RE = /([?&](?:signature|sig|x-amz-signature|x-goog-signature|access_token|refresh_token)=)([^&#\s,;"']+)/gi;
// A secret word must END a name segment (split at . _ - or the name's end): api_key, apiKey,
// authtoken, X-Amz-Signature and custom.Token-value are masked, while author, keyword, design,
// signup and page stay readable. Names that merely end in a secret word (zipcode, error_code,
// monkey) are masked too; over-masking a URL value is the cheaper failure. Empty values stay.
// Match through a trailing fragment; field separators (&/;), quotes, parentheses or whitespace end it.
// Both name runs are bounded so a long separator-free run costs linear time, not quadratic.
const URL_SECRET_WORDS = 'token|key|secret|signature|sig|code|password|passwd|pwd|auth|authorization|credential';
export const URL_SECRET_PARAM_RE = new RegExp(
  `[?&#;]([\\w.-]{0,128}?(?:${URL_SECRET_WORDS})s?(?=[._=-])[\\w.-]{0,128})=[^&;\\s"'<>()]+`,
  'gi',
);
// A parameter the labeled rule already names (password, client_secret, ...) keeps that category.
export const LABELED_URL_PARAM_NAME_RE = new RegExp(`(?:^|[.-])(?:${SECRET_LABELS})$`, 'i');

// Only an entire generated marker is already masked. A secret glued onto marker-like text still
// needs masking; a substring check would preserve credential suffixes in echoed header/query values.
const MASKED_VALUE_RE = new RegExp(`^["']?${GENERATED_MARKER}["']?$`);
export function isMaskedValue(value: string): boolean {
  return MASKED_VALUE_RE.test(value);
}
