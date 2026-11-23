/**
 * @file Shared request-field parsing for the two BYOK execution-probe routes (`list-models.ts`,
 * `test-connection.ts`) — both read the same protocol/baseUrl/apiKey/apiVersion shape off an
 * untyped body and validate the same provider allowlist. Factored out once both needed it.
 */

export const SUPPORTED_EXECUTION_PROTOCOLS = ["anthropic", "openai", "azure", "google"] as const;
export type SupportedExecutionProtocol = (typeof SUPPORTED_EXECUTION_PROTOCOLS)[number];

/**
 * Reads a body field as a string, or `fallback` if it isn't one — the routes' shared
 * undefined/wrong-type-means-"use the fallback" coercion.
 *
 * @complexity O(1).
 */
export function readOptionalString<F>({ value, fallback }: { value: unknown; fallback: F }, _optional = {}): string | F {
  return typeof value === "string" ? value : fallback;
}

/**
 * `null` if `protocol` is one of `SUPPORTED_EXECUTION_PROTOCOLS`, else the 400 body to send.
 *
 * @complexity O(1).
 */
export function validateSupportedProtocol({ protocol }: { protocol: string }, _optional = {}): { error: string; code: "VALIDATION_ERROR" } | null {
  if (SUPPORTED_EXECUTION_PROTOCOLS.includes(protocol as SupportedExecutionProtocol)) {
    return null;
  }
  return { error: `protocol must be one of ${SUPPORTED_EXECUTION_PROTOCOLS.join("|")}`, code: "VALIDATION_ERROR" };
}
