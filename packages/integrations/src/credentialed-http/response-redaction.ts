/**
 * Response redaction for credentialed requests: strips credential-bearing headers and scrubs the
 * injected secrets out of provider text before anything reaches the caller or the model.
 * Module-internal: not re-exported from the credentialed-http barrel.
 */
// Echo endpoints and provider cookies must not return credential-bearing headers to the model,
// even when a value is too short to identify safely by substring matching.
const FORBIDDEN_RESPONSE_HEADER_NAMES: ReadonlySet<string> = new Set(["authorization", "proxy-authorization", "set-cookie", "cookie"]);

// A visible marker explains removal; silently splicing bytes out could alter the response's meaning.
const REDACTED_MARKER = "[REDACTED]";

// Very short tokens can match ordinary words ("ab" inside "abacus"); scrubbing would silently
// mangle unrelated content. The eight-character floor retains normal long API-token responses
// while withholding pathological ones. Dropping a whole response header needs no such floor.
const MIN_SAFE_BODY_REDACTION_TOKEN_LENGTH = 8;

// Withhold the body rather than leak the secret or make unrelated content look like provider output;
// the request still ran, and the marker lets a caller distinguish display limits from auth failure.
const BODY_WITHHELD_SHORT_TOKEN_MARKER = "[body withheld: credential too short to redact safely]";

// Match secrets embedded in diagnostic header values too, not just values equal to a full secret.
// Whole-header removal has no partial-mangling failure mode and therefore applies at any length.
export function redactResponseHeaders(headers: Readonly<Record<string, string>>, secrets: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const forbidden = FORBIDDEN_RESPONSE_HEADER_NAMES.has(key.trim().toLowerCase());
    if (forbidden || secrets.some((secret) => secret !== "" && value.includes(secret))) continue;
    result[key] = value;
  }
  return result;
}

// Reflecting responses must not send injected credentials back through the model; retain all other
// provider text instead of replacing the provider's answer with an authentication diagnosis.
export function redactSecretSubstrings(text: string, secrets: readonly string[]): string {
  return secrets.reduce((acc, secret) => (secret === "" ? acc : acc.split(secret).join(REDACTED_MARKER)), text);
}

// One-to-three-character suffix matches are too ambiguous to identify a cut-off secret. This
// four-character partial-tail floor gates a different risk from the full-token length floor above.
const MIN_SAFE_TRUNCATED_TAIL_PREFIX_LENGTH = 4;

// A size cap can cut a reflected secret mid-token, so whole-secret replacement alone leaks its
// prefix. Use the longest matching suffix across all secrets to remove the whole fragment; only
// truncated bodies qualify, since matching complete bodies could remove innocent trailing text.
export function redactTruncatedTail(body: string, secrets: readonly string[]): string {
  let longestMatch = 0;
  for (const secret of secrets) {
    for (let len = Math.min(secret.length, body.length); len >= MIN_SAFE_TRUNCATED_TAIL_PREFIX_LENGTH; len--) {
      if (body.endsWith(secret.slice(0, len))) {
        longestMatch = Math.max(longestMatch, len);
        break;
      }
    }
  }
  return longestMatch === 0 ? body : body.slice(0, body.length - longestMatch) + REDACTED_MARKER;
}

// Gate on the raw token: a scheme-prefixed header is longer and cannot make a short token safe.
// The second pass is conditional because a complete response has no cap-cut fragment to repair.
export function resolveRedactedResponseBody(bodyText: string, token: string, secrets: readonly string[], bodyTruncated: boolean): string {
  if (token.length < MIN_SAFE_BODY_REDACTION_TOKEN_LENGTH) return BODY_WITHHELD_SHORT_TOKEN_MARKER;
  const redacted = redactSecretSubstrings(bodyText, secrets);
  return bodyTruncated ? redactTruncatedTail(redacted, secrets) : redacted;
}

/** Opt-in JSON release boundary: decode escaped strings before using the same credential-secret
 * owner. Scrubbing only serialized bytes misses a provider echo such as `\u0073ecret-token`.
 * Callers must reject truncated responses first. Malformed JSON or secrets in keys/numbers throw;
 * short tokens withhold the whole body under the existing rule. The reviver visits decoded keys
 * and values at every depth. @complexity O(n * s), bounded body and secrets. */
export function redactJsonResponseBody(
  { bodyText, token, secrets }: { bodyText: string; token: string; secrets: readonly string[] },
  _options: Record<string, never> = {},
): string {
  if (token.length < MIN_SAFE_BODY_REDACTION_TOKEN_LENGTH) return BODY_WITHHELD_SHORT_TOKEN_MARKER;
  const decoded: unknown = JSON.parse(bodyText, (key, value: unknown) => {
    // Refuse rather than rename fields or change numeric types in the provider's data.
    if (secrets.some(secret => secret !== "" && key.includes(secret))) throw new TypeError("JSON response key contains a credential");
    if (typeof value === "number" && secrets.some(secret => secret !== "" && String(value).includes(secret))) throw new TypeError("JSON response number contains a credential");
    if (typeof value === "string") return redactSecretSubstrings(value, secrets);
    return value;
  });
  return JSON.stringify(decoded);
}
