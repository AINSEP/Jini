import assert from "node:assert/strict";
import { test } from "vitest";
import { sql } from "kysely";

import { openMemorySqliteKernel } from "../../kernel/sqlite/driver.js";
import type { JournalDatabase } from "../../recovery/journal-kernel.js";
import { applyDatabaseJournalSchema } from "../../recovery/journal-schema.js";
import { SqliteMigrationRunsRepo } from "../../recovery/journal-repo.sql.js";
import { openSqlite } from "../helpers.js";

// F6.3/F4.5: deleting the schema transaction would leave the legacy rename committed on failure.
test("failed journal DDL rolls back the legacy rename and can be retried without losing rows", async () => {
  const kernel = openMemorySqliteKernel<JournalDatabase>({ open: openSqlite });
  try {
    await applyDatabaseJournalSchema({ kernel });
    await kernel.execute(sql`ALTER TABLE database_ledger RENAME TO storage_ledger`);
    await kernel.execute(sql`INSERT INTO storage_ledger (id, site_id, kind, outcome, created_at)
      VALUES ('incident-1', 'site-a', 'restore.executed', 'ok', '2026-10-04T00:00:00.000Z')`);
    await kernel.execute(sql`DROP TABLE migration_runs`);
    await kernel.execute(sql`DROP TABLE restore_points`);
    // All CREATE IF NOT EXISTS statements before the index can run; only this missing column fails.
    await kernel.execute(sql`CREATE TABLE migration_runs (id text PRIMARY KEY)`);
    await assert.rejects(applyDatabaseJournalSchema({ kernel }), /no such column: site_id/);
    assert.deepEqual(await kernel.query(sql`SELECT id, kind FROM storage_ledger`), [{ id: "incident-1", kind: "restore.executed" }]);
    assert.deepEqual(await kernel.query(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
      [{ name: "migration_runs" }, { name: "storage_ledger" }]);
    await kernel.execute(sql`DROP TABLE migration_runs`);
    await applyDatabaseJournalSchema({ kernel });
    assert.deepEqual(await kernel.query(sql`SELECT id, kind FROM database_ledger`), [{ id: "incident-1", kind: "restore.executed" }]);
    await applyDatabaseJournalSchema({ kernel });
    assert.deepEqual(await kernel.query(sql`SELECT id, kind FROM database_ledger`), [{ id: "incident-1", kind: "restore.executed" }]);
  } finally {
    await kernel.close();
  }
});

// F4.4: removing !tables.has(database_ledger) would rename onto an existing table and brick open.
test("a journal containing both ledger names preserves both sets of incidents", async () => {
  const kernel = openMemorySqliteKernel<JournalDatabase>({ open: openSqlite });
  try {
    await applyDatabaseJournalSchema({ kernel });
    await kernel.execute(sql`INSERT INTO database_ledger (id, site_id, kind, outcome, created_at)
      VALUES ('current', 'site-a', 'restore.executed', 'ok', '2026-10-04T00:00:00.000Z')`);
    await kernel.execute(sql`CREATE TABLE storage_ledger (id text PRIMARY KEY, payload text)`);
    await kernel.execute(sql`INSERT INTO storage_ledger VALUES ('legacy', 'legacy incident')`);
    await applyDatabaseJournalSchema({ kernel });
    assert.deepEqual(await kernel.query(sql`SELECT id, kind FROM database_ledger`), [{ id: "current", kind: "restore.executed" }]);
    assert.deepEqual(await kernel.query(sql`SELECT * FROM storage_ledger`), [{ id: "legacy", payload: "legacy incident" }]);
  } finally {
    await kernel.close();
  }
});

// F4.1/F6.4: expectations are literal terminal values, not imported from the list under test.
test("all five terminal statuses are excluded from boot recovery while an active run remains", async () => {
  const kernel = openMemorySqliteKernel<JournalDatabase>({ open: openSqlite });
  try {
    await applyDatabaseJournalSchema({ kernel });
    const repo = new SqliteMigrationRunsRepo({ db: kernel, siteId: "site-a" });
    for (const status of ["DONE", "ABORTED_SAFE", "RESTORED", "RESTORE_FAILED", "ROLLBACK_TO_BLUE"]) {
      await repo.insert({ id: status, dialect: "sqlite", status, createdAt: "t0", updatedAt: "t0" });
    }
    assert.equal(await repo.findNonTerminalForSite("site-a"), null);
    await repo.insert({ id: "active", dialect: "sqlite", status: "VERIFYING", createdAt: "t0", updatedAt: "t0" });
    assert.deepEqual(await repo.findNonTerminalForSite("site-a"), { id: "active", status: "VERIFYING" });
    assert.deepEqual(await kernel.query(sql`SELECT status, blue_touched FROM migration_runs WHERE id = 'active'`),
      [{ status: "VERIFYING", blue_touched: 0 }]);
  } finally {
    await kernel.close();
  }
});
