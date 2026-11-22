/**
 * @file The single-row reads and writes of the table adapter: the marker value, the version, and the guarded marker write.
 */
import { type AliasedExpression, sql } from "kysely";

import type { TrashEntry, TrashMarkerSpec } from "../registry-types.js";
import { entryWhere, loose, qualified } from "./entry-sql.js";
import { type MarkerRow, runOn, type TableTrashContext } from "./table-adapter.context.js";

/**
 * Whether a marker's raw column VALUE (already read from a row) currently means "live". The scalar
 * twin of `not-trashed.ts`'s SQL conditions (`notTrashed`) — this file always
 * has the value in hand from a prior read, not a `WHERE` clause left to build.
 *
 * @complexity O(1).
 */
export function isMarkerValueLive({ marker, value }: { marker: TrashMarkerSpec; value: unknown }, _optional = {}): boolean {
  return marker.kind === "timestamp" ? value === null : value !== marker.trashed;
}

/** A row count off a write result: Kysely reports `bigint` on some drivers. @complexity O(1). */
export function affected({ value }: { value: bigint | number | undefined }, _optional = {}): number {
  return Number(value ?? 0);
}

/** All table operations skip version comparison only for an unversioned entry or a null expectation. */
export function hasVersionChanged(required: { entry: TrashEntry; row: MarkerRow; expectedVersion: number | null }, _options: Record<string, never> = {}): boolean {
  return Boolean(required.entry.versionColumn && required.expectedVersion !== null && required.row.version !== required.expectedVersion);
}

/** @complexity O(1) plus whatever index the entry's `where` matches. */
export async function readMarkerRow({ ctx, workspaceId, entityId }: { ctx: TableTrashContext; workspaceId: string; entityId: string }, _optional = {}): Promise<MarkerRow | null> {
  const { entry } = ctx;
  const row = await runOn({ ctx, fn: (db) =>
    loose(db)
      .selectFrom(entry.table)
      .select((eb) => {
        const columns: AliasedExpression<unknown, string>[] = [eb.ref(qualified({ table: entry.table, column: entry.marker.column })).as("marker")];
        if (entry.versionColumn) columns.push(eb.ref(qualified({ table: entry.table, column: entry.versionColumn })).as("version"));
        return columns;
      })
      .where((eb) => entryWhere({ eb, entry, workspaceId, entityId }))
      .limit(1)
      .executeTakeFirst() }
  );
  return (row as MarkerRow | undefined) ?? null;
}

/** Re-reads the version after a write — never chained off the write itself (no `RETURNING`: the same
 *  statements must run on every dialect). `null` for an entry with no version column.
 *  @complexity O(1) plus whatever index the entry's `where` matches. */
export async function readVersion({ ctx, workspaceId, entityId }: { ctx: TableTrashContext; workspaceId: string; entityId: string }, _optional = {}): Promise<number | null> {
  if (!ctx.entry.versionColumn) return null;
  const row = await readMarkerRow({ ctx, workspaceId, entityId });
  return row?.version ?? null;
}

/**
 * Writes the marker (plus the touch column, plus a version bump) on the one row — only if the row
 * still holds the `before` marker and version it was classified on. A domain writer never takes the
 * Trash's row lock, so on Postgres it can commit between the read and this write; the guard turns
 * that into 0 affected rows instead of trashing (or restoring) a version nobody confirmed.
 *
 * @returns whether the row was written; `false` means it changed since `before` was read.
 * @complexity O(1) plus whatever index the entry's `where` matches.
 */
export async function writeMarker({ ctx, workspaceId, entityId, markerValue, at, before }: { ctx: TableTrashContext; workspaceId: string; entityId: string; markerValue: unknown; at: string; before: MarkerRow }, _optional = {}): Promise<boolean> {
  const { entry } = ctx;
  const set: Record<string, unknown> = { [entry.marker.column]: markerValue };
  if (entry.touchColumn) set[entry.touchColumn] = at;
  if (entry.versionColumn) set[entry.versionColumn] = sql`${sql.ref(entry.versionColumn)} + 1`;
  const versionColumn = entry.versionColumn;
  const result = await runOn({ ctx, fn: (db) =>
    loose(db)
      .updateTable(entry.table)
      .set(set)
      .where((eb) => {
        const markerRef = qualified({ table: entry.table, column: entry.marker.column });
        const guards = [
          entryWhere({ eb, entry, workspaceId, entityId }),
          before.marker === null || before.marker === undefined ? eb(markerRef, "is", null) : eb(markerRef, "=", before.marker),
        ];
        if (versionColumn && before.version !== null && before.version !== undefined) {
          guards.push(eb(qualified({ table: entry.table, column: versionColumn }), "=", before.version));
        }
        return eb.and(guards);
      })
      .executeTakeFirst() }
  );
  return affected({ value: result.numUpdatedRows }) > 0;
}
