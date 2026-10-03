/** Generic legacy row shapes and tolerant JSON narrowing; no driver or SQL dependencies. */
// Query rows stay loose here so each caller narrows its own schema at the use site.
export type DbRow = Record<string, any>;
// Serialized column payloads remain unknown until the caller validates their shape.
export type JsonObject = Record<string, unknown>;
/** @module db/core/json
 * Pure JSON parsing utility that converts SQLite TEXT columns to JS values without throwing.
 * Imports no sibling subdirectory.
 */

/**
 * Safely parse a SQLite TEXT column value to a JS value.
 * Returns `undefined` instead of throwing for non-string, empty, or malformed JSON —
 * callers should narrow the return type before use.
 * @param s - raw column value as stored in SQLite (typically `string | null`)
 * @returns parsed value, or `undefined` if the input is absent or unparseable
 */
export function parseJsonOrUndef(s: unknown): any {
  if (typeof s !== 'string' || !s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** @module db/core/rows
 * Helpers that normalize raw better-sqlite3 query results to typed `DbRow` values.
 * Imports no sibling subdirectory; depends only on `core/types`.
 */


/**
 * Narrow a single `db.prepare(…).get()` result to `DbRow | null`.
 * Returns `null` for falsy or non-object returns so callers can distinguish "no row" from an empty row.
 * @param value - raw return from better-sqlite3's `.get()`
 */
export function row(value: unknown): DbRow | null {
  return value && typeof value === 'object' ? value as DbRow : null;
}

/**
 * Map a `db.prepare(…).all()` result array to `DbRow[]`, replacing any falsy or non-object
 * entries with an empty object so the array length is always preserved.
 * @param value - raw return from better-sqlite3's `.all()`
 */
export function rows(value: unknown[]): DbRow[] {
  return value.map((item) => row(item) ?? {});
}
