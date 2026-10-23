import { IntegrationError } from "../argument-error.js";

export type SavedRequestErrorCode = "invalid_definition" | "invalid_input" | "credential_changed" | "execution_failed" | "invalid_response";

/** Safe public refusal. Raw URLs, provider bodies, secrets and underlying errors never escape. */
export class SavedRequestError extends IntegrationError {
  readonly code: SavedRequestErrorCode;
  constructor(required: { code: SavedRequestErrorCode }, _options: Record<string, never> = {}) {
    super({ message: `Saved request refused: ${required.code}` });
    this.code = required.code;
  }
}

export function requireCondition({ valid, code = "invalid_definition" }: { valid: boolean; code?: SavedRequestErrorCode }, _options: Record<string, never> = {}): void {
  if (!valid) throw new SavedRequestError({ code });
}

export function record({ value }: { value: unknown }, _options: Record<string, never> = {}): Record<string, unknown> {
  requireCondition({ valid: typeof value === "object" && value !== null && !Array.isArray(value) });
  return value as Record<string, unknown>;
}

export function closed({ value, keys }: { value: Record<string, unknown>; keys: readonly string[] }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: Object.keys(value).every(key => keys.includes(key)) });
}

export function name({ value }: { value: unknown }, _options: Record<string, never> = {}): string {
  requireCondition({ valid: typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) });
  requireCondition({ valid: !["__proto__", "prototype", "constructor"].includes(value as string) });
  return value as string;
}

export function integer({ value, min = 0, max }: { value: unknown; min?: number; max: number }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max });
}

/** Bound serialized bytes before parsing/compiling. Snapshotting also prevents edits while awaiting
 * credentials or DNS from changing the reviewed definition/input. @complexity O(n) bounded bytes. */
export function snapshot({ value, maxBytes, code }: { value: unknown; maxBytes: number; code: SavedRequestErrorCode }, _options: Record<string, never> = {}): unknown {
  try {
    const json = JSON.stringify(value);
    requireCondition({ valid: typeof json === "string" && Buffer.byteLength(json, "utf8") <= maxBytes, code });
    return JSON.parse(json!);
  } catch { throw new SavedRequestError({ code }); }
}

export function httpsUrl({ value }: { value: unknown }, _options: Record<string, never> = {}): URL {
  try {
    requireCondition({ valid: typeof value === "string" });
    // No template syntax or parser normalization of control characters in persisted targets.
    requireCondition({ valid: !/[\s{}<>`\\]/u.test(decodeURIComponent(value as string)) });
    const url = new URL(value as string);
    requireCondition({ valid: url.protocol === "https:" && url.port === "" && !url.username && !url.password && !url.hash });
    return url;
  } catch { throw new SavedRequestError({ code: "invalid_definition" }); }
}

export function fieldPath({ value }: { value: unknown }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: Array.isArray(value) && value.length <= 8 });
  for (const part of value as unknown[]) name({ value: part });
}

/** Authentication is injected solely by the credential owner, never by bindings or static data. */
export function dataKey({ value }: { value: unknown }, _options: Record<string, never> = {}): string {
  const key = name({ value });
  const normalized = key.toLowerCase().replace(/[_.-]/g, "");
  requireCondition({ valid: !["authorization", "proxyauthorization", "cookie", "host", "token", "accesstoken", "apikey", "password", "secret", "credential", "credentialid", "username"].includes(normalized) });
  return key;
}
