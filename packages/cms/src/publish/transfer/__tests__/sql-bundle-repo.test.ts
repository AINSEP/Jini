import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "vitest";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import { SqlPublishContentBundleRepo } from "../sql/bundle-repo.js";
import type { StagedBundleRecord } from "../bundle-staging.js";

/**
 * @file `SqlPublishContentBundleRepo` on a host-chosen (non-default) table name, on SQLite and
 * PGlite: `save` then a workspace-scoped `findById`, and `deleteExpired` removes only rows whose
 * expiry is strictly before the cutoff and returns how many. The host's own dialect suite stays the
 * parity proof against its real migration.
 */

const require = createRequire(new URL("../../../../package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof BetterSqlite3;
const tables = { bundles: "app_publish_bundles" };
const bundle: StagedBundleRecord = {
  id: "b-1", workspaceId: "ws", sourcePrincipalId: "peer-1", artifactFormatVersion: 1, hashVersion: 1,
  entitiesJson: "[]", blobManifestJson: "[]", sizeBytes: 12, receivedAt: "2026-11-24T00:00:00.000Z", expiresAt: "2026-11-25T00:00:00.000Z",
};

const createTable = sql`CREATE TABLE app_publish_bundles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  source_principal_id TEXT NOT NULL, artifact_format_version INTEGER NOT NULL DEFAULT 1, hash_version INTEGER NOT NULL,
  entities_json TEXT NOT NULL, blob_manifest_json TEXT NOT NULL, size_bytes INTEGER NOT NULL, received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL)`;

async function roundTrip(kernel: KyselyKernel<unknown>): Promise<void> {
  await kernel.execute(createTable);
  const repo = new SqlPublishContentBundleRepo({ kernel, tables });
  await repo.save({ record: bundle });
  await repo.save({ record: { ...bundle, id: "b-2", expiresAt: "2026-11-26T00:00:00.000Z" } });
  assert.deepEqual(await repo.findById({ workspaceId: "ws", id: "b-1" }), bundle);
  assert.equal(await repo.findById({ workspaceId: "other", id: "b-1" }), null);
  assert.equal(await repo.deleteExpired({ expiredBefore: "2026-11-25T00:00:00.000Z" }), 0);
  assert.equal(await repo.deleteExpired({ expiredBefore: "2026-11-25T00:00:00.001Z" }), 1);
  assert.equal(await repo.findById({ workspaceId: "ws", id: "b-1" }), null);
  assert.equal((await repo.findById({ workspaceId: "ws", id: "b-2" }))?.id, "b-2");
}

describe("SqlPublishContentBundleRepo", () => {
  test("sqlite: saves, reads by workspace and id, deletes strictly-expired rows", async () => {
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
