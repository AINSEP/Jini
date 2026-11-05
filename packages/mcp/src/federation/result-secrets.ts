import { redactSecrets } from "@jini-ai/core";

/** Scrub decoded JSON strings, including object keys, before successful tool-call results leave the transport.
 * Parsing each string before redaction preserves JSON syntax for short or escaped credentials.
 * @param required - Parsed tool-result JSON and only this connection's known credentials.
 * @returns The JSON value with exact credential occurrences masked; no input mutation or I/O.
 * @complexity O(s*b) time for s secrets and b response bytes; O(b) space. Callers enforce transport caps.
 */
export function scrubFederatedResponseValue({ value, secrets }: { value: unknown; secrets: readonly string[] }, _options: Record<string, never> = {}): unknown {
  if (value === undefined || secrets.length === 0) return value;
  const serialized = JSON.stringify(value);
  return JSON.parse(serialized.replace(/"(?:[^"\\]|\\.)*"/g, literal => JSON.stringify(
    redactSecrets({ input: JSON.parse(literal) as string }, { exactSecrets: secrets, policy: "exact-only" }),
  )));
}
