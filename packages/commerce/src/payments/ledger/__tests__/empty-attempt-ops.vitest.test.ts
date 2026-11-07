import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sqlPaymentsLedger } from "../repo.sql.js";
import { migrateCommercePayments } from "../migrations/index.js";

test("an empty attempt operation selection returns no rows without reading the database", async () => {
  const kernel = openMemorySqliteKernel<unknown>({ open: (file, options) => new Database(file, options) });
  try {
    await migrateCommercePayments({ kernel });
    const read = vi.spyOn(kernel, "run");
    const ledger = sqlPaymentsLedger({ kernel });
    const attempts = await ledger.transaction({ fn: (tx) => tx.listOpenAttempts({ ops: [], updatedBefore: 102, limit: 10 }) });
    expect(attempts).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    await kernel.close();
  }
});
