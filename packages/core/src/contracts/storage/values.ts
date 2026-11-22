/** @file Pure value helpers for rows read through a {@link StorageKernel}; no driver or query library. */

/** A boolean column as read: `true`/`false` on Postgres, `1`/`0` on SQLite. NULL stays null. */
export function toBool({ value }: { value: boolean | number | null | undefined }, _optional: Record<string, never> = {}): boolean | null {
  if (value === null || value === undefined) return null;
  return value === true || value === 1;
}

/**
 * True iff `err` is a UNIQUE violation, from any driver: SQLite's `SQLITE_CONSTRAINT_UNIQUE` /
 * "UNIQUE constraint failed", Postgres SQLSTATE `23505` (the Postgres drivers both set `code`).
 * The message check also covers the in-memory test doubles, which throw SQLite's wording.
 */
export function isUniqueViolation({ err }: { err: unknown }, _optional: Record<string, never> = {}): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "23505" || err.message.includes("UNIQUE constraint failed");
}

/** A blob/bytea value as bytes, whichever shape the driver returned (Buffer, Uint8Array). */
export function toBytes({ value }: { value: unknown }, _optional: Record<string, never> = {}): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`expected a binary column value, got ${typeof value}`);
}

export interface ColumnInfo {
  name: string;
  /** The declared type, lower-case, in the dialect's own spelling (`text`, `integer`, `bigint`…). */
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}
