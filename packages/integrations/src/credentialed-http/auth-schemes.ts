

export interface CredentialSchemeRule {
  readonly id: string;
  readonly prefix: string;
  readonly scheme: string;
}

export interface SelfDescribingTokenMatch {
  readonly scheme: string;
  readonly value: string;
}

export interface CredentialSchemeRegistry {
  readonly rules: readonly CredentialSchemeRule[];
  readonly refusals: readonly string[];
}

const RULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// An HTTP authentication scheme is an RFC 9110 token, not arbitrary header text.
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_FIELD_LENGTH = 64;
const MAX_RULES = 32;

// A leading scheme prefix must leave a credential value: an exact-prefix token or a prefix
// appearing later in the token falls through to ordinary Bearer/Basic handling. First match
// wins, so rule prefixes should be disjoint. Infer from token content because proxy URLs need
// not identify the token's provider.
/** Match self-describing tokens in supplied rule order; no host or vendor inference. */
export function detectSelfDescribingAuthScheme(required: { token: string; rules: readonly CredentialSchemeRule[] }): SelfDescribingTokenMatch | null {
  const { token, rules } = required;
  for (const rule of rules) {
    if (token.startsWith(rule.prefix) && token.length > rule.prefix.length) {
      return { scheme: rule.scheme, value: token.slice(rule.prefix.length) };
    }
  }
  return null;
}

/** Parse schema-v1 rule data, rejecting malformed or duplicate entries atomically. */
export function parseCredentialSchemesFile(required: { raw: string }): { readonly ok: true; readonly rules: readonly CredentialSchemeRule[] } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(required.raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.schemes) || value.schemes.length > MAX_RULES) return { ok: false, reason: `schemes must be an array of at most ${MAX_RULES} rules` };

  const rules: CredentialSchemeRule[] = [];
  for (const [index, entry] of value.schemes.entries()) {
    const rule = parseRule(entry, `schemes[${index}]`);
    if (typeof rule === "string") return { ok: false, reason: rule };
    if (rules.some((seen) => seen.id === rule.id)) return { ok: false, reason: `schemes[${index}].id '${rule.id}' is declared twice` };
    rules.push(rule);
  }
  return { ok: true, rules };
}

function parseRule(entry: unknown, at: string): CredentialSchemeRule | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, prefix, scheme } = entry;
  if (typeof id !== "string" || id.length > MAX_FIELD_LENGTH || !RULE_ID_PATTERN.test(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > MAX_FIELD_LENGTH || !HTTP_TOKEN_PATTERN.test(prefix)) {
    return `${at}.prefix must be a non-empty run of HTTP token characters`;
  }
  if (typeof scheme !== "string" || scheme.length > MAX_FIELD_LENGTH || !HTTP_TOKEN_PATTERN.test(scheme)) return `${at}.scheme must be an HTTP auth-scheme name`;
  return { id, prefix, scheme };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
