import type Database from "better-sqlite3";
import type { SnapshotClient } from "../transfer/sqlite-source.js";

/**
 * Bind the fixture's native handle to the structural snapshot port without changing ownership.
 * SnapshotSource calls iterate only after raw(), so its rows are arrays; better-sqlite3's
 * raw() typings preserve the original result type and need that array result declared at prepare.
 * Metadata all/get results stay opaque in SnapshotClient. close delegates to this same handle.
 * @complexity O(1) time and space for the adapter; statements retain the driver's query cost.
 */
export function sqliteSnapshotClient({ db }: { db: Database.Database }): SnapshotClient {
  return {
    prepare: sql => db.prepare<unknown[], unknown[]>(sql),
    close: () => db.close(),
  };
}
