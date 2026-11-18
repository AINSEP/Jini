/**
 * @file The one read rule every trashable domain's queries add: "this row is not currently in the
 * Trash." Two forms of the same rule — {@link notTrashed} for a SQL `WHERE`, {@link isTrashedRecord}
 * for an in-memory record — so a SQLite/Postgres repo and its in-memory test double agree without
 * either one re-deriving the rule from `entityType` itself.
 *
 * `term`'s `hiddenWithParent` (T1 item 3, `registry.ts`'s `TrashHiddenWithParentSpec`): a term is
 * trashed the moment its taxonomy is, with no second write and no cascade-hide of every member term.
 * {@link notTrashed} ANDs in a `NOT EXISTS` over the parent table, built from registry names only
 * (never caller input), so a term reads as trashed the instant its taxonomy does, with no extra write
 * to keep in sync. {@link isTrashedRecord} — the in-memory twin, used by record-store doubles and
 * hermetic test repos — CANNOT evaluate this: a flat record has no parent row to join against. It
 * reports the entity's own marker only; a term entity whose taxonomy is trashed reads as live through
 * this path until a caller with a real parent lookup (T6's own domain repo) filters it separately.
 */
import type { Expression, SqlBool } from "kysely";

import type { TrashEntityType } from "../ports.js";
import type { TrashEntry, TrashHiddenWithParentSpec, TrashMarkerSpec, TrashRegistry } from "../registry-types.js";
import type { LooseExpressionBuilder } from "./entry-sql.types.js";

/** A `WHERE` condition over a registry entry's table, applied to a query's expression builder. */
export type TrashCondition = (eb: LooseExpressionBuilder) => Expression<SqlBool>;

/** Fails fast: an `entityType` with no registry entry is a composition bug (a caller wired a domain
 *  into the Trash without registering it), not a runtime condition to degrade around. */
function requireEntry(entityType: TrashEntityType, registry: TrashRegistry): TrashEntry {
  const entry = registry.get(entityType);
  if (!entry) {
    throw new Error(`trash: '${entityType}' has no TRASHABLE registry entry — register it in registry.ts first.`);
  }
  return entry;
}

/** True for a row whose marker (on `table`) says LIVE. @complexity O(1) to build. */
function markerLive({ eb, table, marker }: { eb: LooseExpressionBuilder; table: string; marker: TrashMarkerSpec }, _optional = {}): Expression<SqlBool> {
  const column = `${table}.${marker.column}`;
  return marker.kind === "timestamp" ? eb(column, "is", null) : eb(column, "<>", marker.trashed);
}

/**
 * `NOT EXISTS (SELECT 1 FROM <parent> WHERE <parent pk> = <this row's fk> AND <parent is trashed>)`
 * — true when the entity's PARENT is not currently trashed. Built from registry names only (see the
 * file header), never a string the caller controls.
 *
 * @complexity O(1) to build; the `NOT EXISTS` costs whatever index the parent table's own primary
 *             key already provides.
 */
function parentNotTrashed({ eb, table, spec }: { eb: LooseExpressionBuilder; table: string; spec: TrashHiddenWithParentSpec }, _optional = {}): Expression<SqlBool> {
  const parentColumn = `${spec.parentTable}.${spec.parentMarker.column}`;
  return eb.not(
    eb.exists(
      eb
        .selectFrom(spec.parentTable)
        .select(eb.lit(1).as("one"))
        .whereRef(`${spec.parentTable}.${spec.parentPkColumn}`, "=", `${table}.${spec.parentIdColumn}`)
        .where(
          spec.parentMarker.kind === "timestamp" ? eb(parentColumn, "is not", null) : eb(parentColumn, "=", spec.parentMarker.trashed)
        )
    )
  );
}

/**
 * A `WHERE` condition, true for a row that is currently LIVE — its own marker, ANDed with its
 * parent's when the entry declares `hiddenWithParent` (a term whose taxonomy is trashed reads as
 * trashed too). Columns are qualified with the entry's table, so it holds next to a display join.
 *
 * @complexity O(1) to build; the condition itself costs whatever index the caller's query already
 *             uses on the marker column, plus the parent lookup's own primary key when present.
 */
export function notTrashed({ entityType, registry }: { entityType: TrashEntityType; registry: TrashRegistry }, _optional = {}): TrashCondition {
  const entry = requireEntry(entityType, registry);
  return (eb) => {
    const own = markerLive({ eb, table: entry.table, marker: entry.marker });
    return entry.hiddenWithParent ? eb.and([own, parentNotTrashed({ eb, table: entry.table, spec: entry.hiddenWithParent })]) : own;
  };
}


/**
 * Converts a SQL column name (`deleted_at`) to the camelCase JS property name this codebase's
 * records always pair it with (`deletedAt`) — the same convention every domain record follows 1:1 (`workspaceId` / `workspace_id`,
 * `formDefinitionId` / `form_definition_id`, …).
 *
 * @complexity O(n) in the column name's length.
 */
function sqlNameToJsProperty({ sqlName }: { sqlName: string }, _optional = {}): string {
  return sqlName.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * The plain-JS twin of {@link notTrashed}, for in-memory repos and record-store adapters whose
 * stored shape is a JS object rather than a SQL row — e.g. `record-store.ts`'s `TrashRecordStore`.
 *
 * Reads `record[<marker's camelCase property>]` rather than requiring every in-memory repo to pass
 * its own accessor, so a domain that follows this codebase's snake_case-column /
 * camelCase-property convention (every domain does) needs no extra wiring beyond registering the
 * entry.
 *
 * Deliberately ignores `hiddenWithParent` (see the file header): `record` is a flat, already-detached
 * object with no parent row to join against, so this reports the entity's OWN marker only. A record
 * store or hermetic repo for an entry that declares `hiddenWithParent` must apply that half of the
 * rule itself, with its own parent lookup, exactly as {@link notTrashed}'s `NOT EXISTS` does.
 *
 * @returns `true` when `record` is currently in the Trash (by its own marker alone).
 * @complexity O(1).
 */
export function isTrashedRecord(
  { entityType, record, registry }: { entityType: TrashEntityType; record: Record<string, unknown>; registry: TrashRegistry },
  _optional = {}
): boolean {
  const entry = requireEntry(entityType, registry);
  const property = sqlNameToJsProperty({ sqlName: entry.marker.column });
  const value = record[property];
  return entry.marker.kind === "timestamp" ? value !== null && value !== undefined : value === entry.marker.trashed;
}
