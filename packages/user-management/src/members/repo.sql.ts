/** Shared Kysely helpers of the members SQL repositories (`repo.ts`, `repo.sessions.ts`); not a package entry. */
import type { Kysely } from "kysely";

/** A host-named table viewed with its stored column shape (the name is a runtime value). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's own table-shape constraint.
export function on<T extends Record<string, any>>(db: Kysely<unknown>) {
  return db.withTables<Record<string, T>>();
}

/** The `updated` half of an upsert: every column except the primary key. */
export function withoutId<T extends { id: unknown }>(row: T): Omit<T, "id"> {
  const { id: _id, ...rest } = row;
  return rest;
}
