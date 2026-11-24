import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterAll, describe, test } from "vitest";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import { tableExists, type KyselyKernel } from "@jini-ai/db/kernel";
import { createBackstopAuditSqlPort } from "../sql/backstop-audit-repo.js";
import type { BackstopAuditRecord } from "../backstop-audit.js";

/**
 * @file `createBackstopAuditSqlPort` on a host-chosen (non-default) table name, on SQLite and PGlite:
 * closed (`ready() === false`) until the staged table exists, save inserts then updates progress on
 * the id, reads are workspace-scoped by id or run id (source before destination), and gaps rank labels
 * of successful/undone source events by count, then alphabetically. The host's own suite stays the
 * parity proof against its real schema.
 */

const require = createRequire(new URL("../../../../package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof BetterSqlite3;
const tables = { log: "app_backstop_log" };
const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

const createTable = sql`CREATE TABLE app_backstop_log (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, direction TEXT NOT NULL,
  actor_id TEXT NOT NULL, destination TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL,
  items_json TEXT NOT NULL, gap_labels_json TEXT NOT NULL, result TEXT NOT NULL,
  run_id TEXT, details_json TEXT NOT NULL, inverses_json TEXT NOT NULL)`;

function openKernel(dialect: "sqlite" | "pglite"): KyselyKernel<unknown> {
  const kernel = dialect === "sqlite" ? sqliteKernel<unknown>({ source: new Database(":memory:") }) : openPgliteKernel<unknown>({ PGlite }, {});
  opened.push(kernel);
  return kernel;
}

const base: BackstopAuditRecord = {
  id: "", workspaceId: "ws", direction: "source", actorId: "admin", destination: "https://live.example", reason: "",
  at: "", items: [], gapLabels: [], result: "success", runId: null, details: {}, inverses: [],
};

for (const dialect of ["sqlite", "pglite"] as const) {
  describe(`createBackstopAuditSqlPort [${dialect}]`, { timeout: 20_000 }, () => {
    test("stays closed before installation and persists source and destination events by workspace", async () => {
      const kernel = openKernel(dialect);
      const audit = createBackstopAuditSqlPort({ kernel, tables, tableExists }, {});
      assert.equal(await audit.ready(), false);
      await kernel.execute(createTable);
      assert.equal(await audit.ready(), true);
      const event: BackstopAuditRecord = { ...base, id: "source-1", reason: "Emergency footer fix", at: "2026-10-04T00:00:00.000Z",
        items: [{ entityType: "raw-row", id: "p_widgets:a", beforeHash: null, afterHash: "after" }],
        gapLabels: ["table:p_widgets", "table:p_widgets"], result: "pending" };
      await audit.save({ record: event });
      await audit.save({ record: { ...event, result: "success", runId: "run-1", details: { applied: 1 } } });
      assert.deepEqual(await audit.get({ workspaceId: "ws", id: event.id }), { ...event, result: "success", runId: "run-1", details: { applied: 1 } });
      assert.deepEqual((await audit.get({ workspaceId: "ws", id: "run-1" }))?.details, { applied: 1 });
      assert.equal(await audit.get({ workspaceId: "other", id: event.id }), null);
      await audit.save({ record: { ...event, id: "destination-1", direction: "destination", result: "success", runId: "run-1" } });
      assert.equal((await audit.get({ workspaceId: "ws", id: "run-1" }))?.direction, "destination");
      await audit.save({ record: { ...event, id: "source-2", result: "success", at: "2026-10-04T01:00:00.000Z", reason: "Emergency second fix" } });
      await audit.save({ record: { ...event, id: "failed", result: "failure", details: { error: "FK check failed" } } });
      await audit.save({ record: { ...event, id: "other", workspaceId: "other", result: "success" } });
      assert.equal((await audit.get({ workspaceId: "ws", id: "failed" }))?.details.error, "FK check failed");
      assert.deepEqual(await audit.gaps({ workspaceId: "ws" }), [{
        label: "table:p_widgets", count: 2, lastReason: "Emergency second fix", lastAt: "2026-10-04T01:00:00.000Z",
      }]);
    });

    test("gaps rank labels by how often successful or undone source events hit them, then alphabetically", async () => {
      const kernel = openKernel(dialect);
      await kernel.execute(createTable);
      const audit = createBackstopAuditSqlPort({ kernel, tables, tableExists });
      const events: Array<Pick<BackstopAuditRecord, "id" | "at" | "gapLabels" | "result" | "reason">> = [
        { id: "e1", at: "2026-10-04T00:00:00.000Z", gapLabels: ["table:zeta", "table:beta"], result: "success", reason: "first" },
        { id: "e2", at: "2026-10-04T01:00:00.000Z", gapLabels: ["table:zeta", "table:alpha"], result: "undone", reason: "second" },
        { id: "e3", at: "2026-10-04T02:00:00.000Z", gapLabels: ["table:gamma"], result: "failure", reason: "ignored failure" },
      ];
      for (const event of events) await audit.save({ record: { ...base, ...event } });
      assert.deepEqual(await audit.gaps({ workspaceId: "ws" }), [
        { label: "table:zeta", count: 2, lastReason: "second", lastAt: "2026-10-04T01:00:00.000Z" },
        { label: "table:alpha", count: 1, lastReason: "second", lastAt: "2026-10-04T01:00:00.000Z" },
        { label: "table:beta", count: 1, lastReason: "first", lastAt: "2026-10-04T00:00:00.000Z" },
      ]);
    });
  });
}
