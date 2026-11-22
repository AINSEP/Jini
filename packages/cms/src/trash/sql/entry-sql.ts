/**
 * @file The Kysely pieces every generic `TRASHABLE` query shares: a loosely-typed view of the content
 * database (the registry names tables at runtime, so no static table type can describe them) and the
 * one live-snapshot read `moveToTrash` and the `trash_item` tool both run.
 *
 * Every table and column name reaching a query here comes from a `registry.ts` entry — module
 * constants, never caller input. Kysely quotes each one as an identifier.
 */
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { AliasedExpression, Kysely } from "kysely";

import type { TrashEntry, TrashRegistry } from "../registry-types.js";
import type { LooseExpressionBuilder, LooseTables } from "./entry-sql.types.js";
import { notTrashed } from "./not-trashed.js";

/** `db` with every table name accepted — for a query whose table comes from a registry entry.
 *  Generic over the host's schema `DB`: a host's typed handle is not assignable to `Kysely<unknown>`, and `withTables`
 *  alone would keep its static tables in the type, so this one place narrows the view to the loose one.
 *  @complexity O(1). */
export function loose<DB>(db: Kysely<DB>): Kysely<LooseTables> {
  return db.withTables<LooseTables>() as unknown as Kysely<LooseTables>;
}

/** `table.column` — a bare column name of `table`, qualified so it stays unambiguous next to a join.
 *  @complexity O(1). */
export function qualified({ table, column }: { table: string; column: string }, _optional = {}): string {
  return `${table}.${column}`;
}

/** The display + version columns of one live row, as `readLiveSnapshot` returns them. */
export interface EntitySnapshotRow {
  title: string;
  subtitle?: string | null;
  version?: number | null;
}

/**
 * Reads one LIVE entity's display columns (and its version, when the entry has one): the row must be
 * in `workspaceId`, match the entry's `scope`, and not be in the Trash (`notTrashed`, which includes a
 * term whose taxonomy is trashed). `null` when no such row exists.
 *
 * @complexity O(1): one indexed read, plus the display join's primary-key lookup when present.
 */
export async function readLiveSnapshot<DB>(
  required: { entry: TrashEntry; workspaceId: string; entityId: string },
  deps: { kernel: StorageKernel<Kysely<DB>, unknown>; registry: TrashRegistry }
): Promise<EntitySnapshotRow | null> {
  const { entry } = required;
  const row = await deps.kernel.run((db) => {
    const from = loose(db).selectFrom(entry.table);
    const joined = entry.display.join ? from.innerJoin(entry.display.join.table, entry.display.join.on[0], entry.display.join.on[1]) : from;
    return joined
      .select((eb) => {
        const columns: AliasedExpression<unknown, string>[] = [eb.ref(entry.display.title).as("title")];
        if (entry.display.subtitle) columns.push(eb.ref(entry.display.subtitle).as("subtitle"));
        if (entry.versionColumn) columns.push(eb.ref(qualified({ table: entry.table, column: entry.versionColumn })).as("version"));
        return columns;
      })
      .where((eb) => entryWhere({ eb, entry, workspaceId: required.workspaceId, entityId: required.entityId }))
      .where((eb) => notTrashed({ entityType: entry.entityType, registry: deps.registry })(eb))
      .limit(1)
      .executeTakeFirst();
  });
  return (row as EntitySnapshotRow | undefined) ?? null;
}

/**
 * `workspace = ? AND id = ?`, plus the entry's fixed `scope` predicate when it has one — every column
 * qualified with the entry's own table, so the condition holds next to a display join.
 *
 * @complexity O(1) to build.
 */
export function entryWhere(required: { eb: LooseExpressionBuilder; entry: TrashEntry; workspaceId: string; entityId: string }, _optional: Record<string, never> = {}) {
  const { eb, entry } = required;
  const conditions = [
    eb(qualified({ table: entry.table, column: entry.workspaceColumn }), "=", required.workspaceId),
    eb(qualified({ table: entry.table, column: entry.idColumn }), "=", required.entityId),
  ];
  if (entry.scope) conditions.push(eb(qualified({ table: entry.table, column: entry.scope.column }), "=", entry.scope.equals));
  return eb.and(conditions);
}
