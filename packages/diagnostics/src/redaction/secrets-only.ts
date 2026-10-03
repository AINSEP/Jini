import { SECRET_SHAPE_PATTERNS } from "@jini-ai/core";

// Paths and network addresses are useful failure diagnostics and are not credential values.
// Share the vendor credential catalog so adding a vendor cannot leave a second redaction list stale.
/** Secret-only error-display policy. Preserves paths, network addresses, emails, timestamps,
 * tool IDs and ordinary prose. Ordered rules are idempotent; product formats come from policy. */

/** One (text in, text + count out) redaction pass. `redactions` is the number of values blanked —
 *  zero for text with nothing secret-shaped in it. */
export interface SecretRedaction {
  readonly text: string;
  readonly redactions: number;
}

/** One ordered rule: a global pattern and how to rebuild its replacement from the match's capture
 *  groups. Private — callers only ever see {@link redactSecretShapes}'s aggregate result. */
export interface RedactionRule {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly replacement: (required: { match: readonly (string | undefined)[] }) => string;
}

/** Adds the `g` flag when a source pattern (e.g. one of {@link SECRET_SHAPE_PATTERNS}, authored for a
 *  single `RegExp.exec` caller) does not already carry it — `String.replace` only replaces every
 *  match when the pattern is global. Mirrors `secret-scan-guard.ts`'s own `scanTextForSecrets`. */
function withGlobalFlag(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

/** {@link SECRET_SHAPE_PATTERNS} reused for redaction — see this file's header. Each vendor pattern is
 *  wrapped in the same `RedactionRule` shape as every rule below, so the loop in
 *  {@link redactSecretShapes} treats them identically. */
const REUSED_CREDENTIAL_RULES: readonly RedactionRule[] = SECRET_SHAPE_PATTERNS.map((vendor) => ({
  kind: "credential",
  pattern: new RegExp(vendor.pattern.source, withGlobalFlag(vendor.pattern.flags)),
  replacement: () => "[REDACTED:credential]",
}));

/** Labels a bare `label=value`, `"label":"value"`, or `?label=value` assignment may carry — see
 *  this file's header's Must NOT change list for why a bare prose colon (`password: must be...`)
 *  is deliberately excluded from all three shapes below. */
const LABELED_SECRET_LABELS =
  "password|passwd|pwd|secret|client_secret|api_key|apikey|access_token|refresh_token|id_token|auth_token|token|private_key|secret_access_key|signing_secret|webhook_secret";

/**
 * Every rule this module applies, in order. Order matters: `private_key` must run before the
 * reused header-only PEM pattern (inside {@link REUSED_CREDENTIAL_RULES}) so a full block is
 * blanked as one unit rather than leaving its header re-matched separately; `auth_header` must run
 * before the bare `bearer_token` rule so a header's own scheme+token is not ALSO caught by the
 * looser bare-token rule.
 */
const REDACTION_RULES: readonly RedactionRule[] = [
  {
    kind: "private_key",
    // Matches a full PEM block, including a truncated one with no `-----END-----` line (the
    // `$` alternative). `\1` backreferences the captured key type (e.g. "RSA ") so a
    // "BEGIN RSA PRIVATE KEY" block cannot be closed by an unrelated "END EC PRIVATE KEY" line.
    pattern: /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/g,
    replacement: () => "[REDACTED:private_key]",
  },
  {
    kind: "auth_header",
    // The value is ONE token after an optional known scheme, never the rest of the line — a
    // rest-of-line value would eat a trailing IP/cause in a message like `request failed
    // (Authorization: Bearer <tok>): connect ECONNREFUSED 10.0.4.7:443`.
    //
    // Split into two non-overlapping alternatives (scheme+value vs. no-scheme+value) rather than
    // one optional scheme group, for idempotency: with a single optional group, a second pass over
    // already-redacted text (`Authorization: Bearer [REDACTED:auth_header]`) would fail the
    // `(?!\[REDACTED)` lookahead on the "with scheme" attempt, backtrack the optional group away,
    // and then match the bare word "Bearer" itself as the "value" — corrupting already-redacted
    // text. The second alternative's own `(?!(?:Bearer|...)\s)` explicitly refuses to start on a
    // scheme keyword, so when the first alternative's lookahead fails there is no fallback left to
    // backtrack into, and the whole rule correctly finds no match on a second pass.
    pattern:
      /(?<![A-Za-z0-9-])((?:proxy-)?authorization|x-api-key|api-key|x-goog-api-key|x-auth-token)(\s*["']?\s*[:=]\s*["']?)(?:((?:Bearer|Basic|Token|Digest|ApiKey)\s+)(?!\[REDACTED)[^\s"'),;]+|(?!\[REDACTED)(?!(?:Bearer|Basic|Token|Digest|ApiKey)\s)[^\s"'),;]+)/gi,
    replacement: ({ match: m }) => `${m[1]}${m[2]}${m[3] ?? ""}[REDACTED:auth_header]`,
  },
  {
    kind: "auth_header",
    pattern: /(?<![A-Za-z0-9-])((?:set-)?cookie)(\s*[:=]\s*)(?!\[REDACTED)[^\s"'),;]+(?:;\s*[^\s"'),;]+)*/gi,
    replacement: ({ match: m }) => `${m[1]}${m[2]}[REDACTED:auth_header]`,
  },
  {
    kind: "url_credentials",
    // Host, port, IP and path all stay — only the `user:pass@` half is replaced. The password class
    // ADMITS `@` and backtracks to the LAST one before the authority ends (2026-09-16 security
    // review): a password that was never percent-encoded — `postgres://u:p@ss4@host/db` — otherwise
    // matched only up to its FIRST `@`, leaving the tail (`ss4`) of the password in the output.
    // `?` is excluded so a query string's own `@` cannot drag the match past the authority.
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)(?!\[REDACTED)[^\s/@:]+:[^\s/?]+@/gi,
    replacement: ({ match: m }) => `${m[1]}[REDACTED:url_credentials]@`,
  },
  ...REUSED_CREDENTIAL_RULES,
  {
    kind: "stripe_key",
    pattern: /(?<![A-Za-z0-9_])(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g,
    replacement: () => "[REDACTED:stripe_key]",
  },
  {
    kind: "stripe_key",
    pattern: /(?<![A-Za-z0-9_])whsec_[A-Za-z0-9]{24,}/g,
    replacement: () => "[REDACTED:stripe_key]",
  },
  {
    kind: "github_token",
    // Covers `ghs_`/`ghu_`/`ghr_` and lengths the exact-length SECRET_SHAPE_PATTERNS entries miss.
    pattern: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,}/g,
    replacement: () => "[REDACTED:github_token]",
  },
  {
    kind: "openai_key",
    pattern: /(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
    replacement: () => "[REDACTED:openai_key]",
  },
  {
    kind: "anthropic_key",
    // SECRET_SHAPE_PATTERNS' own `sk-ant-` entry needs 90+ trailing characters, which is right for the
    // repo-wide static check (a committed key is whole) but wrong here (2026-09-16 security review):
    // an upstream 401 often echoes a TRUNCATED key, and `sk-[A-Za-z0-9]{40,}` cannot cover it either
    // because `sk-ant-api03-` carries hyphens. The prefix alone is specific enough at this length.
    pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: () => "[REDACTED:anthropic_key]",
  },
  {
    kind: "google_api_key",
    pattern: /(?<![A-Za-z0-9_.-])AQ\.[A-Za-z0-9_-]{20,}/g,
    replacement: () => "[REDACTED:google_api_key]",
  },
  {
    kind: "aws_access_key",
    pattern: /(?<![0-9A-Z])ASIA[0-9A-Z]{16}(?![0-9A-Z])/g,
    replacement: () => "[REDACTED:aws_access_key]",
  },
  {
    kind: "jwt",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: () => "[REDACTED:jwt]",
  },
  {
    kind: "bearer_token",
    // Bare scheme outside a header line. The value must be at least 16 characters AND contain a
    // digit, so ordinary prose ("Bearer token", "Basic authentication is not supported") is
    // untouched.
    pattern: /\b(Bearer|Basic|Token)\s+(?!\[REDACTED)(?=[A-Za-z0-9._~+/=:-]*\d)[A-Za-z0-9._~+/=:-]{16,}/g,
    replacement: ({ match: m }) => `${m[1]} [REDACTED:bearer_token]`,
  },
  {
    kind: "labeled_secret",
    // Assignment form only — never a bare prose colon (`password: must be...` is untouched).
    pattern: new RegExp(`(?<![A-Za-z0-9])(${LABELED_SECRET_LABELS})(\\s*=\\s*)(?!\\[REDACTED)([^\\s"'&,;})]+)`, "gi"),
    replacement: ({ match: m }) => `${m[1]}${m[2]}[REDACTED:labeled_secret]`,
  },
  {
    kind: "labeled_secret",
    // JSON form: `"label":"value"`.
    pattern: new RegExp(`"(${LABELED_SECRET_LABELS})"(\\s*:\\s*)"(?!\\[REDACTED)[^"]+"`, "gi"),
    replacement: ({ match: m }) => `"${m[1]}"${m[2]}"[REDACTED:labeled_secret]"`,
  },
  {
    kind: "labeled_secret",
    // Colon form: `api_key: <value>`, `{ api_key: 'value' }`, `\"api_key\":\"value\"` (2026-09-16
    // security review). The `=` and double-quoted-JSON rules above miss every one of these, and they
    // are the shapes a real failure arrives in most often — `util.inspect` of a request config, a
    // YAML/pretty-printed body, or a JSON error body embedded inside ANOTHER JSON string, where the
    // escaped `\"` defeats the plain JSON rule.
    //
    // Prose is kept out by the VALUE's own shape rather than by banning the colon: a quoted value is
    // always taken, an unquoted one only when it is a single ≥12-character token. That is what keeps
    // this file's Must NOT change list intact — `password: must be at least 8 characters` stops at
    // the 4-character `must`, and `token expired at ...` has no colon at all.
    pattern: new RegExp(
      `(?<![A-Za-z0-9])(${LABELED_SECRET_LABELS})(\\\\?["']?\\s*:\\s*)(?:(\\\\?["'])(?!\\[REDACTED)[^"'\\\\\\r\\n]+\\3|(?!\\[REDACTED)[^\\s"',;}]{12,})`,
      "gi",
    ),
    replacement: ({ match: m }) => `${m[1]}${m[2]}${m[3] ?? ""}[REDACTED:labeled_secret]${m[3] ?? ""}`,
  },
  {
    kind: "labeled_secret",
    // Query-string form: `?key=value` / `&token=value`.
    pattern: /([?&](?:key|api_key|api-key|token|access_token|sig|signature)=)(?!\[REDACTED)[^&#\s"']+/gi,
    replacement: ({ match: m }) => `${m[1]}[REDACTED:labeled_secret]`,
  },
];

/**
 * Blanks every secret-shaped VALUE in `text`, leaving everything else — including IPs, absolute
 * paths, emails, tool ids, and ordinary prose — untouched.
 *
 * @param required - Text and the caller's redaction policy. The text is arbitrary error text. Never re-interpreted as anything other than plain text (no
 *   parsing, no partial JSON awareness).
 * @returns The redacted text plus how many values were blanked. `redactions: 0` means nothing
 *   secret-shaped was found — the returned `text` is then reference-identical in content (though
 *   not necessarily the same string instance) to the input.
 * @complexity O(r*n): each of the fixed, small rule count `r` makes one linear pass over the
 *   (at most `n`-length) text. Rules only ever shrink or hold text length steady, so the total work
 *   is bounded by `r` passes over the original length.
 * @example
 * redactSecretShapes({ text: "password=hunter2hunter2", policy: {} }); // { text: "password=[REDACTED:labeled_secret]", redactions: 1 }
 * @overallScore 100
 */
export interface RedactionPolicy {
  /** Rules for caller-owned formats, applied after vendor/JWT rules and before bearer/labeled rules. Must be idempotent. */
  readonly additionalRules?: readonly RedactionRule[];
}

/** Redacts credential values with a required policy; returns text and replacement count. */
export function redactSecretShapes({ text, policy }: { text: string; policy: RedactionPolicy }): SecretRedaction {
  if (text.length === 0) return { text, redactions: 0 };

  let redactions = 0;
  let result = text;
  // Preserve the original policy slot: vendor/JWT matches take precedence over host formats.
  const applicationRuleSlot = REDACTION_RULES.findIndex(rule => rule.kind === "bearer_token");
  const rules = [
    ...REDACTION_RULES.slice(0, applicationRuleSlot),
    ...(policy.additionalRules ?? []),
    ...REDACTION_RULES.slice(applicationRuleSlot),
  ];
  for (const rule of rules) {
    result = result.replace(new RegExp(rule.pattern.source, withGlobalFlag(rule.pattern.flags)), (...args: unknown[]) => {
      redactions += 1;
      return rule.replacement({ match: args as readonly (string | undefined)[] });
    });
  }
  return { text: result, redactions };
}

// Preserve the public scanner vocabulary while core owns the single pattern catalog.
export { SECRET_SHAPE_PATTERNS as SECRET_PATTERNS, PEM_PATTERN_NAME, type SecretShapePattern as SecretPattern } from "@jini-ai/core";
