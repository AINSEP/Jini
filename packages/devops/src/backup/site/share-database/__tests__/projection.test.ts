import { listTables, listColumns } from "@jini-ai/db/kernel";
import { declareDataModule } from "@jini-ai/db/data-modules";
import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection } from "@jini-ai/db/kernel/sqlite";
import { sanitizeShareDatabase } from "../projection.js";

it("refuses an unknown populated source table before portable projection or search backfill", async () => {
  const source = new Database(":memory:");
  source.exec("CREATE TABLE unexpected (value TEXT); INSERT INTO unexpected VALUES ('fixture')");
  const snapshot = source.serialize(); source.close();
  const backfillPostSearchIndex = vi.fn();
  let fresh: Database.Database | undefined;
  const host = {
    deps: { listTables, listColumns, declareDataModule, sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection },
    SHARE_LIMITS: { maxExpandedBytes: 1024 * 1024 }, SHARE_TABLES: ["portable"], SHARE_LEGACY_PRIVATE_TABLES: new Set(), CHAT_TABLE_NAMES: [],
    databaseCapMessage: "cap", insufficientStorageMessage: "space", redactSecretShapes: ({ text }: { text: string }) => ({ text }),
    tempRoot: async ({ work }: { work: (required: { root: string }) => Promise<unknown> }) => { const root = await mkdtemp(path.join(tmpdir(), "wmz-projection-")); try { return await work({ root }); } finally { await rm(root, { recursive: true, force: true }); } },
    openSqliteFileKernel: ({ filePath }: { filePath: string }, options: { readOnly?: boolean } = {}) => sqliteKernel({ source: new Database(filePath, { readonly: options.readOnly }) }),
    openContentDb: () => { fresh = new Database(":memory:"); fresh.exec("CREATE TABLE portable (id TEXT)"); return fresh; },
    sql, backfillPostSearchIndex,
  } as unknown as Parameters<typeof sanitizeShareDatabase>[0]["host"];
  await expect(sanitizeShareDatabase({ snapshot, modules: [], searchHost: {} as never, host })).rejects.toMatchObject({ code: "UNSUPPORTED_DATA", message: "Cannot share unsupported nonempty table 'unexpected'. Add an approved portable-data policy for this table first." });
  expect(backfillPostSearchIndex).not.toHaveBeenCalled(); expect(fresh?.open).toBe(false);
});
