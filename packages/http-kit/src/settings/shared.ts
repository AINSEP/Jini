import type { Response } from "express";

export interface SettingsErrorMapping {
  readonly matches: (error: unknown) => boolean; readonly status: number; readonly code: string;
}
/** Write the first matching status/code, or a fixed 500 that does not disclose unknown errors.
 * @complexity O(mapping count) time, O(1) space; response write effect.
 * @example respondToSettingsError({ response, error, mappings });
 */
export function respondToSettingsError(required: {
  response: Pick<Response, "status" | "json">; error: unknown; mappings: readonly SettingsErrorMapping[];
}): void {
  const { response, error, mappings } = required;
  const message = error instanceof Error ? error.message : String(error);
  for (const mapping of mappings) {
    if (mapping.matches(error)) { response.status(mapping.status).json({ error: message, code: mapping.code }); return; }
  }
  response.status(500).json({ error: "internal error", code: "INTERNAL_ERROR" });
}
