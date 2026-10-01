/**
 * @file How every Postgres transport turns column text into JS values where the defaults differ
 * from what the repos (and SQLite) expect. One table, used by the PGlite and node-postgres drivers,
 * so a row reads the same on both.
 *
 * - `json`/`jsonb` stay JSON TEXT: the repos store and parse JSON themselves (SQLite has no JSON
 *   type), so a `string` column type holds on every dialect. The text is re-serialised compactly
 *   (`{"a":1}`, as `JSON.stringify` writes it) instead of Postgres's own spelling (`{"a": 1}`), so a
 *   value written compactly reads back byte-identical.
 *   Key order is jsonb's (it does not keep insertion order); compare parsed values, not text.
 * - `int8` (`bigint`) is a `number` when it fits in a double exactly, else a `bigint` — PGlite's own
 *   rule, which node-postgres (default: string) is aligned to.
 */

export const PG_OID = { int8: 20, json: 114, jsonb: 3802 } as const;

export function parseInt8(text: string): number | bigint {
  const value = BigInt(text);
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
}

const compactJson = (text: string) => JSON.stringify(JSON.parse(text));

/** Parser overrides by type oid. */
export const PG_PARSERS: Readonly<Record<number, (text: string) => unknown>> = {
  [PG_OID.int8]: parseInt8,
  [PG_OID.json]: compactJson,
  [PG_OID.jsonb]: compactJson,
};
