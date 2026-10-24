import { redactSecrets } from "@jini-ai/core";

/** Provider diagnostics cross the host boundary only after Jini's secret scrubber, then a cap.
 * Exact credential values are supplied where available; redaction precedes truncation so a token
 * crossing the length boundary cannot leave a readable prefix. Mail also masks URL token parameters
 * (including fragments) through Jini's caller-owned patterns.
 * @complexity O(n) in diagnostic text for a bounded set of credential values; output <= 1000 chars.
 */
export function safeMailProviderText(
  { text }: { text: string },
  { secrets = [] }: { secrets?: readonly string[] } = {},
): string {
  return redactSecrets({ input: text }, {
    exactSecrets: secrets,
    redactPii: false,
    // Any secret-shaped URL parameter (token, key, secret, signature, code, password), not only `token=`:
    // provider errors echo whole request URLs, and the parameter name varies by provider. The value runs
    // to the next `&` so a trailing `#fragment` is masked with it.
    extraPatterns: [{ name: "url_secret_param", regex: /[?&#;][\w.-]*(?:token|key|secret|signature|sig|code|password|pwd|auth)[\w.-]*=[^&\s"'<>]+/gi }],
  }).slice(0, 1000);
}

/** The credential's string values, so exact redaction also catches keys no pattern recognises.
 * @complexity O(k) credential fields.
 */
export function credentialSecrets({ credential }: { credential: object }, _options: Record<string, never> = {}): string[] {
  return Object.values(credential).filter((value): value is string => typeof value === "string");
}
