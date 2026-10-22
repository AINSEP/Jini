/**
 * @file Readers for untrusted Stripe JSON. Response and webhook bodies are data from the network,
 * so every field is checked before it becomes evidence; a reader returns `undefined` rather than
 * guessing, and the caller decides whether that makes the whole object unusable.
 */

export type JsonObject = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A non-empty string, else `undefined`. */
export const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** A safe, non-negative integer, else `undefined`. */
export const optionalCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** An id-bearing field Stripe returns either as an id string or, when expanded, as an object with `id`. */
export const idOf = (value: unknown): string | undefined => optionalString(isRecord(value) ? value.id : value);
