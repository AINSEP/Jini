/**
 * @file The purge-side cascades of the table adapter: the children a purge removes first, their `trashed_items` rows, and
 * the blocker that refuses a hide.
 */
import type { TrashEntityType, TrashMarkerResult } from "../ports.js";
import type { TrashCascadeSpec } from "../registry-types.js";
import { loose } from "./entry-sql.js";
import type { TrashedItemTables } from "./repo.js";
import { runOn, type TableTrashContext } from "./table-adapter.context.js";

/**
 * Deletes the `trashed_items` rows of `childIds` for `childType` — the phantom-row cleanup
 * (`TrashCascadeSpec.entityType`). A no-op when there are no ids.
 *
 * @complexity O(1): one indexed `DELETE ... WHERE entity_type = ? AND entity_id IN (...)`.
 */
async function cleanUpTrashedItemsRows({ ctx, workspaceId, childType, childIds }: { ctx: TableTrashContext; workspaceId: string; childType: TrashEntityType; childIds: readonly unknown[] }, _optional = {}): Promise<void> {
  if (childIds.length === 0) return;
  await runOn({ ctx, fn: (db) =>
    db
      .withTables<TrashedItemTables>()
      .deleteFrom(ctx.tables.trashedItems)
      .where("workspace_id", "=", workspaceId)
      .where("entity_type", "=", childType)
      .where("entity_id", "in", childIds as string[])
      .execute() }
  );
}

/** All values of `column` in `table` where `parentColumn = parentId`. @complexity O(k) matches. */
async function selectIds({ ctx, table, column, parentColumn, parentId }: { ctx: TableTrashContext; table: string; column: string; parentColumn: string; parentId: string }, _optional = {}): Promise<unknown[]> {
  const rows = await runOn({ ctx, fn: (db) => loose(db).selectFrom(table).select(column).where(parentColumn, "=", parentId).execute() });
  return rows.map((row) => row[column]);
}

/**
 * Runs one `purgeFirst` cascade: resolves the child ids (direct match, or the two-hop `via` join),
 * cleans up their `trashed_items` rows when the cascade declares `entityType`, then deletes the
 * child rows themselves — in that order, so the phantom-row cleanup can still see what it is about
 * to remove.
 *
 * @complexity O(1) reads plus O(1) deletes — every step is one indexed statement.
 */
export async function runCascade({ ctx, workspaceId, entityId, cascade }: { ctx: TableTrashContext; workspaceId: string; entityId: string; cascade: TrashCascadeSpec }, _optional = {}): Promise<void> {
  if (cascade.via) {
    const via = cascade.via;
    const throughIds = await selectIds({ ctx, table: via.throughTable, column: via.throughIdColumn, parentColumn: via.throughParentIdColumn, parentId: entityId });
    if (throughIds.length === 0) return; // nothing on the other side of the join to cascade to
    if (cascade.entityType) await cleanUpTrashedItemsRows({ ctx, workspaceId, childType: cascade.entityType, childIds: throughIds });
    await runOn({ ctx, fn: (db) => loose(db).deleteFrom(cascade.table).where(via.matchColumn, "in", throughIds).execute() });
    return;
  }

  // Direct case: `cascade.parentIdColumn` is always set when `via` is not (registration contract).
  const parentIdColumn = cascade.parentIdColumn;
  if (parentIdColumn === undefined) throw new Error(`Trash cascade for ${cascade.table} has no parent ID column`);
  if (cascade.entityType) {
    if (cascade.idColumn === undefined) throw new Error(`Trash cascade for ${cascade.table} has no child ID column`);
    const childIds = await selectIds({ ctx, table: cascade.table, column: cascade.idColumn, parentColumn: parentIdColumn, parentId: entityId });
    await cleanUpTrashedItemsRows({ ctx, workspaceId, childType: cascade.entityType, childIds });
  }
  await runOn({ ctx, fn: (db) => loose(db).deleteFrom(cascade.table).where(parentIdColumn, "=", entityId).execute() });
}

/** Counts the entry's declared blockers only when a real hide transition is needed. */
export async function checkBlocker({ ctx, entityId }: { ctx: TableTrashContext; entityId: string }, _options: Record<string, never> = {}): Promise<Extract<TrashMarkerResult, { reason: "blocked" }> | null> {
  if (!ctx.entry.blocker) return null;
  const blocker = ctx.entry.blocker;
  const counted = await runOn({ ctx, fn: (db) =>
    loose(db)
      .selectFrom(blocker.table)
      .select((eb) => eb.fn.countAll().as("n"))
      .where(blocker.parentIdColumn, "=", entityId)
      .executeTakeFirst() }
  );
  const count = Number(counted?.n ?? 0);
  return count > 0 ? { ok: false, reason: "blocked", code: blocker.code, count } : null;
}
