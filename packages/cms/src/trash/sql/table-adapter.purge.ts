/**
 * @file The purge of the table adapter. Never deletes a LIVE row or its `purgeFirst` children, even at a matching version
 * (decision 6) — both checked before either delete runs. Order: lock, read, live check, version check, claim, cascades,
 * delete.
 */
import type { TrashPurgeOutcome } from "../ports.js";
import { entryWhere, loose, qualified } from "./entry-sql.js";
import type { LooseExpressionBuilder } from "./entry-sql.types.js";
import { runCascade } from "./table-adapter.cascade.js";
import { lockRow, type MarkerRow, runOn, type TableTrashContext, VERSION_CHANGED } from "./table-adapter.context.js";
import { affected, hasVersionChanged, isMarkerValueLive, readMarkerRow } from "./table-adapter.rows.js";

/** What `purge` receives. */
export interface PurgeInput {
  workspaceId: string;
  entityId: string;
  expectedVersion: number | null;
}

/**
 * A domain writer does not take Trash's advisory lock. Claim the exact pre-image with a
 * no-op UPDATE before touching children: it both checks the read and holds the database's
 * row write lock through the cascades and parent delete, without bumping any domain fields.
 *
 * @returns whether the claim matched; `false` means the row changed since `row` was read.
 * @complexity O(1): one indexed UPDATE.
 */
async function claimPreImage({ ctx, workspaceId, entityId, row }: { ctx: TableTrashContext; workspaceId: string; entityId: string; row: MarkerRow }, _optional = {}): Promise<boolean> {
  const { entry } = ctx;
  const claimWhere = (eb: LooseExpressionBuilder) => {
    const guards = [
      entryWhere(eb, { entry, workspaceId, entityId }),
      eb(qualified({ table: entry.table, column: entry.marker.column }), "=", row.marker),
    ];
    if (entry.versionColumn && row.version !== null && row.version !== undefined) {
      guards.push(eb(qualified({ table: entry.table, column: entry.versionColumn }), "=", row.version));
    }
    return eb.and(guards);
  };
  const claimed = await runOn({ ctx, fn: (db) =>
    loose(db).updateTable(entry.table).set({ [entry.marker.column]: row.marker }).where(claimWhere).executeTakeFirst() }
  );
  return affected({ value: claimed.numUpdatedRows }) > 0;
}

/**
 * Deletes the claimed row at the version the caller recorded. When nothing is deleted the row raced between the read and
 * this delete (the row lock makes this unreachable in practice, but the classification stays correct if that ever
 * changes): distinguish "gone" from "moved" the same way a compare-and-delete does.
 *
 * @complexity O(1): one indexed DELETE plus at most one re-read.
 */
async function deleteClaimed({ ctx, workspaceId, entityId, expectedVersion }: { ctx: TableTrashContext; workspaceId: string; entityId: string; expectedVersion: number | null }, _optional = {}): Promise<TrashPurgeOutcome> {
  const { entry } = ctx;
  const versionColumn = entry.versionColumn;
  const deleteWhere = (eb: LooseExpressionBuilder) => {
    const base = entryWhere(eb, { entry, workspaceId, entityId });
    return versionColumn && expectedVersion !== null
      ? eb.and([base, eb(qualified({ table: entry.table, column: versionColumn }), "=", expectedVersion)])
      : base;
  };
  const result = await runOn({ ctx, fn: (db) =>
    loose(db)
      .deleteFrom(entry.table)
      .where(deleteWhere)
      .executeTakeFirst() }
  );
  if (affected({ value: result.numDeletedRows }) > 0) return "purged";
  return (await readMarkerRow({ ctx, workspaceId, entityId })) ? VERSION_CHANGED : "already-gone";
}

/**
 * Physically removes the row. Each cascade runs through {@link runCascade}: a direct parent-id match, or the two-hop
 * `via` join, plus the phantom-`trashed_items`-row cleanup when the cascade declares `entityType`.
 *
 * @complexity O(k) cascades for k `purgeFirst` entries (each O(1) reads plus O(1) deletes), plus
 *             the row's own delete.
 */
export async function purgeRow({ ctx, input }: { ctx: TableTrashContext; input: PurgeInput }, _optional = {}): Promise<TrashPurgeOutcome> {
  const { entry } = ctx;
  return ctx.kernel().transaction(async () => {
    const { workspaceId, entityId, expectedVersion } = input;
    await lockRow({ ctx, workspaceId, entityId });
    const row = await readMarkerRow({ ctx, workspaceId, entityId });
    if (!row) return "already-gone";
    if (isMarkerValueLive({ marker: entry.marker, value: row.marker })) return VERSION_CHANGED; // never purge a live row
    if (hasVersionChanged({ entry, row, expectedVersion })) return VERSION_CHANGED;

    if (!(await claimPreImage({ ctx, workspaceId, entityId, row }))) {
      return (await readMarkerRow({ ctx, workspaceId, entityId })) ? VERSION_CHANGED : "already-gone";
    }
    for (const cascade of entry.purgeFirst ?? []) {
      await runCascade({ ctx, workspaceId, entityId, cascade });
    }
    return deleteClaimed({ ctx, workspaceId, entityId, expectedVersion });
  });
}
