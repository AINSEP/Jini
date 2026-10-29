import type { SavedRequestDefinition, SavedRequestOutputField, SavedRequestResult } from "./types.js";
import { requireCondition, SavedRequestError, snapshot } from "./validation.js";

/** Project only declared, typed fields after credentialed-request redaction. No provider text
 * becomes an instruction or browser directive. Bad types/URLs refuse; selected arrays are bounded.
 * @complexity O(rows * fields * path depth), bounded by 50 * 32 * 8 and 16 KiB output. */
export function projectSavedRequestResponse({ bodyText, output }: { bodyText: string; output: SavedRequestDefinition["output"] }, _options: Record<string, never> = {}): SavedRequestResult {
  try {
    const selected = readPath({ value: JSON.parse(bodyText), path: output.path });
    const rows = Array.isArray(selected) ? selected.slice(0, output.maxItems) : [selected];
    const items = rows.map(row => projectRow({ row, fields: output.fields }));
    const result: SavedRequestResult = { trust: "untrusted", items };
    snapshot({ value: result, maxBytes: 16_384, code: "invalid_response" });
    return result;
  } catch { throw new SavedRequestError({ code: "invalid_response" }); }
}

function readPath({ value, path }: { value: unknown; path: readonly string[] }, _options: Record<string, never> = {}): unknown {
  for (const key of path) {
    requireCondition({ valid: typeof value === "object" && value !== null && !Array.isArray(value), code: "invalid_response" });
    requireCondition({ valid: Object.hasOwn(value as object, key), code: "invalid_response" });
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function projectRow({ row, fields }: { row: unknown; fields: SavedRequestDefinition["output"]["fields"] }, _options: Record<string, never> = {}): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const value = readPath({ value: row, path: field.path });
    checkValue({ value, field });
    return [key, value as string | number | boolean];
  }));
}

function checkValue({ value, field }: { value: unknown; field: SavedRequestOutputField }, _options: Record<string, never> = {}): void {
  const type = field.type === "url" ? "string" : field.type;
  requireCondition({ valid: typeof value === type, code: "invalid_response" });
  if (typeof value === "number") requireCondition({ valid: Number.isFinite(value), code: "invalid_response" });
  if (typeof value === "string") requireCondition({ valid: [...value].length <= field.maxLength!, code: "invalid_response" });
  if (field.type === "url") checkPublicUrl({ value: value as string, origin: field.allowedOrigin! });
}

function checkPublicUrl({ value, origin }: { value: string; origin: string }, _options: Record<string, never> = {}): void {
  const url = new URL(value);
  requireCondition({ valid: url.protocol === "https:" && url.origin === origin && !url.username && !url.password, code: "invalid_response" });
  // \s already covers \u0009-\u000d, so the control ranges skip them.
  requireCondition({ valid: !/[\s\u0000-\u0008\u000e-\u001f\u007f]/u.test(value), code: "invalid_response" });
}
