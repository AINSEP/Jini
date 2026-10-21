/**
 * @file The shared `PluginActivationRepoPort` contract (`repo.memory.ts`'s and `sql/repo.ts`'s
 * headers both name it): every adapter must answer get/save/delete/listAll identically, so the
 * activation and quarantine logic above it can be tested against the in-memory adapter and still
 * be true of the SQL one a host wires in production.
 *
 * The SQL adapter runs here on an in-memory SQLite kernel (`@jini-ai/db/kernel/sqlite`). Its query
 * body is one Kysely statement set for every dialect the kernel drives; nothing below depends on a
 * SQLite-only behaviour.
 */
import { createRequire } from "node:module";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openMemorySqliteKernel, type SqliteKernel } from "@jini-ai/db/kernel/sqlite";
import type { PluginActivationRecord, PluginActivationRepoPort } from "../../activation.js";
import { InMemoryPluginActivationRepo } from "../../repo.memory.js";
import {
  pluginActivationRepoFor,
  SqlPluginActivationRepo,
  toActivationRecord,
  toActivationRow,
  type PluginActivationDatabase,
} from "../../sql/index.js";

const requireFromDb = createRequire(new URL("../../../../../db/package.json", import.meta.url));
const Database = requireFromDb("better-sqlite3") as new (path: string, options?: unknown) => unknown;

const TABLE = "plugin_activations";
const kernels: SqliteKernel<PluginActivationDatabase>[] = [];

afterEach(async () => {
  for (const kernel of kernels.splice(0)) await kernel.close();
});

async function sqliteRepo(): Promise<SqlPluginActivationRepo> {
  const kernel = openMemorySqliteKernel<PluginActivationDatabase>({ open: (path, options) => new Database(path, options) as never });
  kernels.push(kernel);
  await kernel.execute(sql`CREATE TABLE plugin_activations (
    workspace_id TEXT NOT NULL, plugin_id TEXT NOT NULL, version TEXT NOT NULL, enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL, quarantined_at TEXT, quarantine_reason TEXT, quarantine_failure_count INTEGER,
    PRIMARY KEY (workspace_id, plugin_id))`);
  return pluginActivationRepoFor({ kernel, tables: { activations: TABLE } });
}

const plain: PluginActivationRecord = { workspaceId: "ws-1", pluginId: "word-count", version: "1.0.0", enabled: true, updatedAt: "2026-10-01T00:00:00.000Z" };
const quarantined: PluginActivationRecord = {
  workspaceId: "ws-2", pluginId: "word-count", version: "1.0.1", enabled: false, updatedAt: "2026-10-02T00:00:00.000Z",
  quarantinedAt: "2026-10-02T00:00:00.000Z", quarantineReason: "filter threw three times", quarantineFailureCount: 3,
};

const adapters: ReadonlyArray<readonly [string, () => Promise<PluginActivationRepoPort>]> = [
  ["in-memory", async () => new InMemoryPluginActivationRepo()],
  ["sql (sqlite kernel)", sqliteRepo],
];

describe.each(adapters)("PluginActivationRepoPort contract: %s", (_name, make) => {
  it("an unknown (workspace, plugin) pair reads as null and the empty repo lists nothing", async () => {
    const repo = await make();
    expect(await repo.getActivation({ workspaceId: "ws-1", pluginId: "missing" })).toBeNull();
    expect(await repo.listAll()).toEqual([]);
  });

  it("save then get round-trips every field, omitting quarantine fields that were never set", async () => {
    const repo = await make();
    await repo.save(plain);
    await repo.save(quarantined);
    expect(await repo.getActivation({ workspaceId: "ws-1", pluginId: "word-count" })).toEqual(plain);
    expect(await repo.getActivation({ workspaceId: "ws-2", pluginId: "word-count" })).toEqual(quarantined);
  });

  it("save upserts on (workspace, plugin): a second save replaces the row instead of adding one", async () => {
    const repo = await make();
    await repo.save(plain);
    const disabled = { ...plain, enabled: false, version: "2.0.0", updatedAt: "2026-10-03T00:00:00.000Z" };
    await repo.save(disabled);
    expect(await repo.listAll()).toEqual([disabled]);
  });

  it("deleteActivation removes only the named workspace's row", async () => {
    const repo = await make();
    await repo.save(plain);
    await repo.save({ ...quarantined, workspaceId: "ws-1", pluginId: "other" });
    await repo.save({ ...plain, workspaceId: "ws-2" });
    await repo.deleteActivation({ workspaceId: "ws-1", pluginId: "word-count" });
    const rows = await repo.listAll();
    expect(rows.map((row) => `${row.workspaceId}/${row.pluginId}`).sort()).toEqual(["ws-1/other", "ws-2/word-count"]);
  });
});

describe("plugin_activations row mapping", () => {
  it("reads SQLite's integer booleans and writes absent quarantine fields as NULL", () => {
    expect(toActivationRecord({ row: { workspace_id: "w", plugin_id: "p", version: "1.0.0", enabled: 0, updated_at: "t", quarantined_at: null, quarantine_reason: null, quarantine_failure_count: null } }))
      .toEqual({ workspaceId: "w", pluginId: "p", version: "1.0.0", enabled: false, updatedAt: "t" });
    expect(toActivationRow({ record: { workspaceId: "w", pluginId: "p", version: "1.0.0", enabled: true, updatedAt: "t" } })).toEqual({
      workspace_id: "w", plugin_id: "p", version: "1.0.0", enabled: true, updated_at: "t",
      quarantined_at: null, quarantine_reason: null, quarantine_failure_count: null,
    });
  });

  it("pluginActivationRepoFor builds the SQL adapter over the given kernel and table name", async () => {
    const repo = await sqliteRepo();
    expect(repo).toBeInstanceOf(SqlPluginActivationRepo);
    await repo.save(plain);
    expect(await kernels[0]!.query<{ n: number }>(sql`SELECT count(*) AS n FROM plugin_activations`)).toEqual([{ n: 1 }]);
  });
});
