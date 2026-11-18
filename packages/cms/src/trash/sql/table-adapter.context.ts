/**
 * @file What every table-adapter step shares: the entry being adapted, the lazily resolved storage kernel, the host's
 * table names, and the one lock every read-then-write sequence on a row takes.
 */
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

import { trashEntityLockKey } from "../lock-keys.js";
import type { TrashEntry } from "../registry-types.js";
import type { TrashTables } from "./repo.js";

/** The kernel a table adapter drives: the host's schema is erased, each query supplies its own table view. */
export type TableTrashKernel = StorageKernel<Kysely<unknown>, unknown>;

/** The explicit context every step receives in place of a closure. `kernel` is a function so the database is read on first use. */
export interface TableTrashContext {
  entry: TrashEntry;
  kernel(): TableTrashKernel;
  tables: TrashTables;
}

export const VERSION_CHANGED = "version-changed";

/** The row shape every `hide`/`unhide`/`purge` read needs: the marker's raw value, plus the version
 *  column when the entry has one. */
export interface MarkerRow {
  marker: unknown;
  version?: number | null;
}

/** @complexity O(1): one statement on the context's kernel. */
export function runOn<T>({ ctx, fn }: { ctx: TableTrashContext; fn: (db: Kysely<unknown>) => Promise<T> }, _optional = {}): Promise<T> {
  return ctx.kernel().run(fn);
}

/** Serializes read-then-write sequences on one row (Postgres advisory lock; SQLite no-op). */
export function lockRow({ ctx, workspaceId, entityId }: { ctx: TableTrashContext; workspaceId: string; entityId: string }, _optional = {}): Promise<void> {
  return ctx.kernel().lockKey(trashEntityLockKey({ entityType: ctx.entry.entityType, workspaceId, entityId }));
}
