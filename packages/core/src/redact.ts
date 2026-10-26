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

/** Broad token shapes for agent-failure text; consumers retain their plain [REDACTED] pipeline. */
// The JWT shape skips an `eyJ` start when an earlier start sits in the same `[\w-]` run (see the
// `jwt` rule below): matches are unchanged, but `'eyJ-'.repeat(n)` no longer rescans the run per start.
export const AGENT_FAILURE_SECRET_SHAPE_RE = /\b(?:AIza[\w-]+|AQ\.[\w.\/-]+|sk-[\w.-]+|gh[pousr]_[\w]+|github_pat_[\w]+|ya29\.[\w.-]+|(?<!\beyJ[\w-]*?)eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?)/g;

/**
 * Exact path SEGMENT names refused at any depth, matched case-insensitively against each segment
 * of the caller-supplied path (never a substring — a directory named `not-secrets-actually` is not
 * a match). `secrets` is the owner's explicit example: whatever a site or app tree names its
 * credentials folder (`sites/**\/secrets/`, `apps/admin/**\/secrets/`, or anywhere else), it never
 * becomes reachable through this domain. A denied segment is refused by the guarded reader
 * AND skipped entirely by the `fs_list_files` walk — its contents are never even enumerated,
 * not merely refused once named. Besides `secrets`, the set names the
 * well-known credential-store directories a home-directory `custom` root can expose: `.aws`
 * (`credentials`), `.docker` (`config.json` with registry auth), `.kube` (`config`), and
 * `gcloud`/`gh` for `.config/gcloud/application_default_credentials.json` and
 * `.config/gh/hosts.yml`. Denied by SEGMENT rather than by leaf filename on purpose: `config`,
 * `config.json`, and `hosts.yml` are generic names that appear harmlessly elsewhere, so denying the
 * directory is the narrower of the two mistakes.
 *
 * A host's install-wide site-key directory (2026-09-24) needs the same protection; the host appends it.
 * Production stores it beside individual site folders on a durable volume; local/dev stores
 * it below the home directory, reachable through an operator-set `custom` root. Its key backs
 * site-key administration, webhook/newsletter signing secrets, and permission checks, so the
 * agent must never read it from disk. Denying the whole directory segment, rather than only
 * a generated key filename, also prevents `fs_list_files` from enumerating its contents — the
 * same "never even advertise it" property `secrets` gets above.
 */
// Generic credential-store segments only. A host adds its own product-specific key directory
// (e.g. its install-wide site-key folder) when it builds its deny-list; core stays product-neutral.
export const CREDENTIAL_FILE_DENY_SEGMENTS: readonly string[] = ["secrets", ".aws", ".docker", ".kube", "gcloud", "gh"];

// A local tunnel has a loopback socket and may rewrite Host; refuse marker presence, even empty.
export const LOCAL_OWNER_PROXY_MARKER_PREFIXES: readonly string[] = ["x-forwarded-", "x-envoy-", "x-ms-"];
export const LOCAL_OWNER_PROXY_MARKER_HEADERS: readonly string[] = [
  "forwarded", "x-real-ip", "via", "cf-connecting-ip", "true-client-ip", "x-original-host",
  "x-client-ip", "x-cluster-client-ip", "fastly-client-ip", "tailscale-user-login", "x-original-forwarded-for",
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
  // A match starts where `\b` would allow (`-eyJ...` included), but only at the FIRST such start in
  // its segment run. With `\b` alone, `'eyJ-'.repeat(n)` started at every `eyJ` and rescanned the
  // whole run each time (quadratic; bounding each segment to 8192 still took ~3 s at 160 KB). All
  // starts inside one run share its end, so the first is the only one that can match. The lazy
  // lookbehind stops at the nearest earlier start, so each run position is read back at most once.
  { name: 'jwt', regex: /(?<!\w)(?<!(?<!\w)eyJ[A-Za-z0-9_-]*?)eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },

  // Bearer tokens in HTTP Authorization header copy/paste. We only match
  // the value, not the literal 'Bearer ', so the marker stays readable in
  // the redacted output ("Authorization: Bearer [REDACTED:bearer_token]").
  { name: 'bearer_token', regex: /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{16,}={0,2}/g },

  // Email addresses. Conservative enough to require a TLD-like trailer. The local part is
  // bounded at the RFC 5321 limit of 64: an unbounded run rescanned the suffix from every word
  // boundary, so `'a.'.repeat(20000)` blocked ~3 s on a large tool response. Matching starts at
  // the `@` and reads the local part in a lookbehind (captured as `local`): starting at every word
  // boundary still cost up to 64 steps per position, ~2.5 s on 10 MiB of `'eyJ-'`.
  { name: 'email', regex: /@(?<=\b(?<local>[\w.+-]{1,64})@)[\w-]+\.[\w.-]+\b/g },

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

// Categories the pipeline names directly; pattern rules carry their own names. Masked-value
// checks and exact-secret masking derive the set of markers redact can generate from these
// plus the pattern names.
const CATEGORY = {
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

const GENERATED_MARKER = markerSource(GENERATED_CATEGORIES);
/** Every marker redact can generate from its built-in categories; consumers normalize only these. */
export const GENERATED_MARKER_RE = new RegExp(GENERATED_MARKER, 'g');

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
// site (the `CARD_CANDIDATE` span callback in `collectPii` below), and `CARD_CANDIDATE`'s
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

/** Optional caller-owned secrets and named lexical rules, without ambient credential lookup. */
export interface SecretRedactionOptions {
  /** Diagnostic text can retain addresses/numbers while using the same credential rules. Default true. */
  redactPii?: boolean;
  /** Exact trusted registration IDs; credential patterns always take precedence. */
  diagnosticToolIds?: readonly string[];
  /** Conservative by default; aggressive also masks bare 20+ character opaque runs. */
  policy?: 'conservative' | 'aggressive';
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
export const LABELED_SECRET_RE = new RegExp(`\\b(${SECRET_LABELS})\\b\\s*[:=]\\s*\\S+`, 'gi');
export const OPAQUE_TOKEN_RE = /[A-Za-z0-9_-]{20,}/g;
export const NON_SECRET_TOKEN_RE = /^(?:ERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}|delegated-tool-calls|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;
// Runtime markers must survive a second pass; the bounded sanitizer deliberately retains
// its historical lowercase marker contract and uses the unmodified lexical vocabulary.
// Reject a masked header/query value before matching, so a following field's credential
// remains available to the global scan rather than being consumed beside the marker.
// `Authorization: Bearer <token>` names the bearer rule's value, not a label value `Bearer`.
// Only the value's first character is matched; forward-only finders supply its end (see
// labelValueExtents). Matching `\S+` and rewinding to skip a covered field rescanned the rest of
// the run per label: quadratic on `'api-key=x;'.repeat(n)`.
const MASK_AWARE_LABELED_SECRET_RE = new RegExp(
  LABELED_SECRET_RE.source.replace(/\\S\+$/,
    `(?!Bearer\\s+(?:[A-Za-z0-9_.+/=-]|${GENERATED_MARKER}(?:\\s|$)))(?!${GENERATED_MARKER}[;&])(\\S)`),
  LABELED_SECRET_RE.flags,
);
// Provider failures also echo short bearer values. Exclude our own marker on subsequent passes.
// The value is read in a lookahead so the scan resumes at it (`Bearer Bearer x` masks both),
// as the earlier lookbehind form did, without a lookbehind test at every position.
const SHORT_BEARER_RE = /Bearer\s+(?=([A-Za-z0-9_\-.+/=]+))/gi;
const PROVIDER_API_KEY_HEADER = /(x-api-key|api-key|x-goog-api-key)\s*[:=]\s*([^\s,;"']+)/gi;
const PROVIDER_API_KEY_QUERY = /([?&]key=)([^&\s]+)/gi;
// URL userinfo and signed query values have explicit credential context; unlike opaque runs,
// they are safe to recognize in the conservative policy. Keep scheme/host and query names
// readable for debugging without exposing credentials that authorize access to the resource.
// Matching starts at `://` and reads the userinfo forward to `@` within the authority. Only the
// scheme character right before `://` is checked, so a scheme of any length (glued text included)
// cannot hide its userinfo: an unbounded scheme run rescanned the suffix from every start
// (`'a.'.repeat(20000)` blocked ~3.6 s), trying a bounded scheme at every position cost ~2 s on
// 10 MiB of `'eyJ-'`, and a 32-character scheme lookbehind missed longer schemes.
const URL_CREDENTIALS_RE = /:\/\/(?<=[a-z0-9+.-]:\/\/)([^/\s?#@]+)@/gi;
const SIGNED_QUERY_RE = /([?&](?:signature|sig|x-amz-signature|x-goog-signature|access_token|refresh_token)=)([^&#\s,;"']+)/gi;
// A secret word must END a name segment (split at . _ - or the name's end): api_key, apiKey,
// authtoken, X-Amz-Signature and custom.Token-value are masked, while author, keyword, design,
// signup and page stay readable. Names that merely end in a secret word (zipcode, error_code,
// monkey) are masked too; over-masking a URL value is the cheaper failure. Empty values stay.
// Match through a trailing fragment; only '&', quotes, parentheses or whitespace end the value.
// Both name runs are bounded so a long separator-free run costs linear time, not quadratic.
const URL_SECRET_PARAM_RE =
  /[?&#;]([\w.-]{0,128}?(?:token|key|secret|signature|sig|code|password|passwd|pwd|auth|authorization|credential)s?(?=[._=-])[\w.-]{0,128})=[^&\s"'<>()]+/gi;
// A parameter the labeled rule already names (password, client_secret, ...) keeps that category.
const LABELED_URL_PARAM_NAME_RE = new RegExp(`(?:^|[.-])(?:${SECRET_LABELS})$`, 'i');

// Only an entire generated marker is already masked. A secret glued onto marker-like text still
// needs masking; a substring check would preserve credential suffixes in echoed header/query values.
const MASKED_VALUE_RE = new RegExp(`^["']?${GENERATED_MARKER}["']?$`);
function isMaskedValue(value: string): boolean {
  return MASKED_VALUE_RE.test(value);
}

/**
 * Returns `input` with every recognised secret / PII pattern replaced by a
 * `[REDACTED:<kind>]` marker. Lexical rules are idempotent: re-running on already redacted
 * text only matches new tokens. An exact secret is masked wherever it occurs, including
 * inside marker text. Defaults to conservative; `{ policy: 'aggressive' }`
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
 * Every rule matches the ORIGINAL input and contributes value spans; overlapping or adjacent
 * spans merge, and one left-to-right pass writes one marker per merged span. Sequential
 * substitution passes leaked in every order tried: each pass saw text an earlier pass had
 * changed. Exact secrets run first split labels (`a` inside `password=hunter2` left `hunter2`) and
 * lost context (`note password=` left `hunter2`); run last, a lexical rule that stopped partway
 * (the label rule at whitespace, vendor/query rules at `.`, `;`, `&`, `!` or quotes) left the rest
 * of a known secret visible; protecting spans exempted secrets overlapping a marker; and
 * overlapping secrets left a tail behind. Opt-in aggressive opaque
 * rules are collected before PII rules so a numeric token keeps the opaque category when tied.
 * @complexity O(n·(r + e) + s + k log k) for n input chars, r rules, e exact-secret needles, s needle
 * chars and k spans.
 */
export function redactSecretsWithCounts({ input }: { input: string }, options: SecretRedactionOptions = {}): {
  redacted: string;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  if (!input) return { redacted: input, counts };
  const spans = mergeSpans(collectSpans({ text: input }, options));
  let redacted = '';
  let cursor = 0;
  for (const { start, end, category } of spans) {
    counts[category] = (counts[category] ?? 0) + 1;
    redacted += `${input.slice(cursor, start)}[REDACTED:${category}]`;
    cursor = end;
  }
  return { redacted: redacted + input.slice(cursor), counts };
}

/** A half-open `[start, end)` range of the original input that one rule masks. */
interface Span {
  start: number;
  end: number;
  category: string;
}

/** Records a span; empty ranges are dropped. */
type AddSpan = (start: number, end: number, category: string) => void;

interface SpanPass {
  text: string;
  add: AddSpan;
}

/** Every rule's spans over the original text, in rule-precedence order (see {@link mergeSpans}). */
function collectSpans({ text }: { text: string }, options: SecretRedactionOptions): Span[] {
  const spans: Span[] = [];
  const add: AddSpan = (start, end, category) => {
    if (end > start) spans.push({ start, end, category });
  };
  collectUrlCredentials({ text, add });
  collectPatterns({ text, add, patterns: credentialPatterns(options.extraPatterns ?? []) });
  collectKeyedCredentials({ text, add });
  collectLabeledSecrets({ text, add }, spans);
  if (options.policy === 'aggressive') collectOpaqueTokens({ text, add }, new Set(options.diagnosticToolIds));
  if (options.redactPii !== false) collectPii({ text, add }, spans);
  collectExactSecrets({ text, add, secrets: options.exactSecrets ?? [] });
  return spans;
}

interface MergedSpan extends Span {
  rank: number;
  categoryLength: number;
}

/** Sorts spans and merges overlapping or adjacent ones; masking whole merged runs means no rule's
 * leftover can expose part of another rule's value.
 * Category rule: the longest constituent span names the merged span; on a tie the earlier rule in
 * {@link collectSpans} wins, so a lexical rule labels a known secret it matches exactly
 * (`Bearer <secret>` stays `bearer_token`) and the exact-secret category marks what only it covers.
 * @complexity O(k log k) time, O(k) space for k spans. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const ordered = spans.map((span, rank) => ({ ...span, rank })).sort((a, b) => a.start - b.start);
  const merged: MergedSpan[] = [];
  for (const span of ordered) {
    const length = span.end - span.start;
    const last = merged.at(-1);
    if (!last || span.start > last.end) {
      merged.push({ ...span, categoryLength: length });
      continue;
    }
    last.end = Math.max(last.end, span.end);
    if (length > last.categoryLength || (length === last.categoryLength && span.rank < last.rank)) {
      Object.assign(last, { category: span.category, rank: span.rank, categoryLength: length });
    }
  }
  return merged;
}

/** Adds one span per match of `regex`; `spanOf` maps a match to its value range, or skips it. */
function collectMatches(
  { text, add }: SpanPass,
  regex: RegExp,
  spanOf: (match: RegExpMatchArray, index: number) => Span | undefined,
): void {
  // Clone so a caller-owned or shared regex never carries lastIndex state across requests;
  // non-global extra patterns use the same every-occurrence contract as the built-ins.
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  for (const match of text.matchAll(new RegExp(regex.source, flags))) {
    const span = spanOf(match, match.index ?? 0);
    if (span) add(span.start, span.end, span.category);
  }
}

/** Span of the match's trailing capture `group`, unless that value is already a generated marker
 * (already masked values are not new credentials and should not inflate the audit count). */
function trailingValue(category: string, group: number) {
  return (match: RegExpMatchArray, index: number): Span | undefined => {
    const value = match[group] ?? '';
    if (isMaskedValue(value)) return undefined;
    const end = index + match[0].length;
    return { start: end - value.length, end, category };
  };
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
    const start = index + '://'.length;
    return { start, end: start + userinfo.length, category: CATEGORY.urlCredentials };
  });
  collectMatches(pass, SIGNED_QUERY_RE, trailingValue(CATEGORY.signedQuery, 2));
}

/** Values named by a header, query parameter or bearer prefix. Each rule matches the original
 * text, so overlapping rules (the provider query rule includes a fragment the core rule stops
 * before) merge into one span instead of one leaving a credential suffix beside the other's marker. */
function collectKeyedCredentials(pass: SpanPass): void {
  collectMatches(pass, API_KEY_HEADER, (match, index) => {
    const value = match[5] ?? '';
    if (isMaskedValue(value)) return undefined;
    const end = index + match[0].length;
    // A quoted value keeps its quotes around the marker.
    const quoted = value.startsWith('"') ? 1 : 0;
    return { start: end - value.length + quoted, end: end - quoted, category: CATEGORY.apiKeyHeader };
  });
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
  collectMatches(pass, PROVIDER_API_KEY_HEADER, trailingValue(CATEGORY.apiKeyHeader, 2));
  collectUrlSecretParams(pass);
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

/** Label values (`password=...`): only the value is masked, so the label stays readable
 * even when no whitespace separates it; a glued credential suffix fails the complete-marker check.
 * A label whose value an earlier rule already masks (see {@link isCoveredField}) is skipped and the
 * scan resumes at the value, so `api-key=x;password=y` and `?password=x&page=2` keep the following
 * field instead of masking it beside the first value. A masked value resumes the scan past its end.
 * @complexity O(n + k) for n chars and k earlier spans; each skip resumes past the label and value
 * ends come from forward-only finders, so no run is rescanned. */
function collectLabeledSecrets({ text, add }: SpanPass, earlier: readonly Span[]): void {
  // Per earlier span start: the furthest end, and whether some span from it ends on a `;`/`&`
  // (scalars rather than per-start end lists: dense fields yield millions of spans).
  const furthest = new Map<number, number>();
  const separatorEnds = new Set<number>();
  for (const { start, end } of earlier) {
    furthest.set(start, Math.max(furthest.get(start) ?? end, end));
    if (text[end] === ';' || text[end] === '&') separatorEnds.add(start);
  }
  const extentOf = labelValueExtents(text);
  const regex = new RegExp(MASK_AWARE_LABELED_SECRET_RE.source, MASK_AWARE_LABELED_SECRET_RE.flags);
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    const start = match.index + match[0].length - 1;
    const value = extentOf(start);
    const at = !value.quoted || furthest.has(start) ? start : start + 1;
    if (isCoveredField(furthest.get(at), separatorEnds.has(at), value) || isMaskedValue(text.slice(start, value.end))) {
      regex.lastIndex = start;
      continue;
    }
    add(start, value.end, CATEGORY.labeledSecret);
    regex.lastIndex = value.end;
  }
}

/** Where a label value ends; `closingQuote` is -1 for an unquoted or unclosed value. */
interface LabelValue {
  end: number;
  closingQuote: number;
  quoted: boolean;
}

/** True when an earlier span starting at the label value (inside its opening quote, for a quoted
 * value) masks it: `reach` is the furthest such span end and `separator` says one ends on `;`/`&`.
 * Inside quotes only the closing quote ends the value (`;` and `&` are value text:
 * `password="sk-...;hunter2"` once left `hunter2`); an unquoted value is covered through its end or
 * up to a `;`/`&` field separator. */
function isCoveredField(reach: number | undefined, separator: boolean, { end, closingQuote, quoted }: LabelValue): boolean {
  const target = closingQuote === end - 1 ? closingQuote : end;
  return (reach ?? -1) >= target || (!quoted && separator);
}

/** Extent finder for label values whose starts increase between calls. An unquoted value runs to
 * whitespace. A quoted value runs through its closing quote and any text glued after it, or to the
 * line end when the quote never closes, so spaces, `;` and `&` inside quotes stay in the value; a
 * value never ends before the old `\S+` end.
 * @complexity Amortized O(1) per call; all calls together scan the text once per finder. */
function labelValueExtents(text: string): (start: number) => LabelValue {
  const runEnd = forwardFinder(text, /\s/);
  const lineEnd = forwardFinder(text, /[\r\n]/);
  const closers = new Map([['"', forwardFinder(text, /"/)], ["'", forwardFinder(text, /'/)]]);
  return (start) => {
    const whitespace = runEnd(start);
    const closer = closers.get(text[start] ?? '');
    if (!closer) return { end: whitespace, closingQuote: -1, quoted: false };
    const closing = closer(start + 1);
    const line = lineEnd(start);
    return closing < line
      ? { end: Math.max(whitespace, closing + 1), closingQuote: closing, quoted: true }
      : { end: line, closingQuote: -1, quoted: true };
  };
}

/** `find(from)`: the first index at or after `from` matching `pattern`, or `text.length`. `from` must
 * not decrease between calls: one search answers every later `from` up to its result, since nothing
 * matched between the earlier `from` and that result.
 * @complexity O(n) over all calls for n chars. */
function forwardFinder(text: string, pattern: RegExp): (from: number) => number {
  const regex = new RegExp(pattern.source, 'g');
  let found = -1;
  return (from) => {
    if (from > found) {
      regex.lastIndex = from;
      found = regex.exec(text)?.index ?? text.length;
    }
    return found;
  };
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

/** Email/IPv4/phone rules, then Luhn-checked card candidates. The email rule matches from its `@`
 * with the local part in its `local` lookbehind group. An "email" whose `@` ends URL userinfo
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

/** Each usable secret plus its JSON-escaped spelling (`ab"cd` echoed inside JSON as `ab\"cd`). */
function exactNeedles(secrets: ReadonlyArray<string | undefined | null>): Set<string> {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    needles.add(secret);
    needles.add(JSON.stringify(secret).slice(1, -1));
  }
  return needles;
}

/** Caller-supplied secrets as plain substrings at any length and every occurrence, overlapping
 * ones included (a secret glued into other text stays masked). Matching the original text means
 * a short secret can no longer break a label or prefix before that rule sees it; it can only split
 * a label word visually, which is accepted because every value is still covered. Occurrences arrive
 * in start order and each one either extends the current run or starts the next, so the runs are
 * exactly the union of all occurrences.
 * @complexity O(e·n + s) for e needles, n text chars and s needle chars; consecutive overlapping
 * hits of one needle share a span. */
function collectExactSecrets({ text, add, secrets }: SpanPass & { secrets: ReadonlyArray<string | undefined | null> }): void {
  for (const needle of exactNeedles(secrets)) {
    let runStart = -1;
    let runEnd = -1;
    forEachOccurrence(text, needle, (at) => {
      if (at > runEnd) {
        add(runStart, runEnd, CATEGORY.exactSecret);
        runStart = at;
      }
      runEnd = at + needle.length;
    });
    add(runStart, runEnd, CATEGORY.exactSecret);
  }
}

/** Calls `visit` with the start of every occurrence of `needle` in order, overlapping ones included.
 * Knuth-Morris-Pratt: after a hit the scan keeps the needle's longest border instead of retrying one
 * character later (which cost Θ(n·m) on long overlapping needles), so no text character is read
 * twice; while no partial match is pending, native indexOf skips to the next occurrence.
 * @complexity O(n + m) time, O(m) space for n text and m needle chars. */
function forEachOccurrence(text: string, needle: string, visit: (start: number) => void): void {
  const border = borderTable(needle);
  let matched = 0;
  let at = text.indexOf(needle);
  while (at !== -1 && at < text.length) {
    const char = text.charCodeAt(at);
    while (matched > 0 && char !== needle.charCodeAt(matched)) matched = border[matched - 1] ?? 0;
    if (char === needle.charCodeAt(matched)) matched += 1;
    if (matched === needle.length) {
      visit(at + 1 - needle.length);
      matched = border[matched - 1] ?? 0;
    }
    at = matched === 0 ? text.indexOf(needle, at + 1) : at + 1;
  }
}

/** KMP failure table: `border[i]` is the length of the longest proper prefix of `needle[0..i]` that
 * is also its suffix. @complexity O(m) time and space. */
function borderTable(needle: string): Int32Array {
  const border = new Int32Array(needle.length);
  let length = 0;
  for (let i = 1; i < needle.length; i += 1) {
    const char = needle.charCodeAt(i);
    while (length > 0 && char !== needle.charCodeAt(length)) length = border[length - 1] ?? 0;
    if (char === needle.charCodeAt(length)) length += 1;
    border[i] = length;
  }
  return border;
}
