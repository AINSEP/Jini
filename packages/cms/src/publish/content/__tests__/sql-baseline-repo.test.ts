import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "vitest";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import { SqlPublishContentBaselineRepo } from "../sql/baseline-repo.js";
import type { PublishContentBaselineRecord } from "../baseline-repo.js";

/**
 * @file `SqlPublishContentBaselineRepo` on a host-chosen (non-default) table name, on SQLite and
 * PGlite: a missing baseline reads `null`, `upsert` inserts then replaces on the 4-column key, and
 * the key's other peers/entities stay separate. The host's own dialect suite stays the parity proof
 * against its real migration.
 */

const require = createRequire(new URL("../../../../package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof BetterSqlite3;
const tables = { baselines: "app_publish_baselines" };
const key = { workspaceId: "ws", peerPrincipalId: "peer-1", entityType: "entry", entityId: "e-1" };
const record: PublishContentBaselineRecord = { ...key, hashAtLastSync: "h1", hashVersion: 1, syncedAt: "2026-11-24T00:00:00.000Z", runId: "run-1" };

const createTable = sql`CREATE TABLE app_publish_baselines (workspace_id TEXT NOT NULL, peer_principal_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, hash_at_last_sync TEXT NOT NULL, hash_version INTEGER NOT NULL,
  synced_at TEXT NOT NULL, run_id TEXT NOT NULL, UNIQUE (workspace_id, peer_principal_id, entity_type, entity_id))`;

async function roundTrip(kernel: KyselyKernel<unknown>): Promise<void> {
  await kernel.execute(createTable);
  const repo = new SqlPublishContentBaselineRepo({ kernel, tables });
  assert.equal(await repo.findOne(key), null);
  await repo.upsert({ record });
  assert.deepEqual(await repo.findOne(key), record);
  const replaced = { ...record, hashAtLastSync: "h2", hashVersion: 2, runId: "run-2" };
  await repo.upsert({ record: replaced });
  assert.deepEqual(await repo.findOne(key), replaced);
  await repo.upsert({ record: { ...record, peerPrincipalId: "peer-2" } });
  assert.deepEqual(await repo.findOne(key), replaced);
  assert.equal(await repo.findOne({ ...key, entityId: "e-2" }), null);
  const [count] = await kernel.query<{ n: number | string }>(sql`SELECT COUNT(*) AS n FROM app_publish_baselines`);
  assert.equal(Number(count?.n), 2);
}

describe("SqlPublishContentBaselineRepo", () => {
  test("sqlite: reads null, inserts, replaces on the unique key", async () => {
    const db = new Database(":memory:");
    try {
      await roundTrip(sqliteKernel<unknown>({ source: db }));
    } finally {
      db.close();
    }
  });

  test("pglite: the same body round-trips", { timeout: 20_000 }, async () => {
    const kernel = openPgliteKernel<unknown>({ PGlite }, {});
    try {
      await roundTrip(kernel);
    } finally {
      await kernel.close();
    }
  });
});
