import { afterEach, expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "./kernel/sqlite/index.js";
import { listTables } from "./kernel/index.js";
import { declareDataModule, type DataModuleDecl } from "./data-modules/data-module.js";
import type { PluginCoreTables, PluginKernel } from "./data-modules/plugin-store.js";
import { executeRestore } from "./recovery/recovery-orchestrator.js";

const SECRET = "j-driver-password-private-path";
const failure = () => Object.assign(new Error(SECRET), { stack: `Error: ${SECRET}\n at ${SECRET}` });
const declaration: DataModuleDecl = { pluginId: "example", pluginTier: "tier-2",
  provenance: { sourceUrl: "builtin://example", publisher: "core" },
  tables: ["first", "second"].map(name => ({ name, columns: [{ name: "id", type: "TEXT", primaryKey: true }] })) };
const open = () => openMemorySqliteKernel<PluginCoreTables>({ open: (file, options) => new Database(file, options) });
afterEach(() => vi.restoreAllMocks());

test("J: DDL driver failure rolls back all tables and emits a safe diagnostic", async () => {
  const store = open();
  const sink = vi.spyOn(console, "error").mockImplementation(() => {});
  let statements = 0;
  const db: PluginKernel = { ...store, execute: async statement => {
    statements++;
    if (statements === 4) throw failure();
    return store.execute(statement);
  } };
  try {
    const result = await declareDataModule({ db, dbPath: ":memory:", decl: declaration });
    expect(result).toMatchObject({ ok: false, created: [], altered: [], snapshotPath: null,
      error: { code: "DDL_FAILED", message: "Data module DDL failed." } });
    expect(statements).toBe(4);
    expect(await listTables({ kernel: store })).not.toContain("p_example__first");
    expect(await listTables({ kernel: store })).not.toContain("p_example__second");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([result, sink.mock.calls])).not.toContain(SECRET);
  } finally { await store.close(); }
});

test.each(["error", "string"])("J: preflight driver %s is classified without leaking its text", async kind => {
  const store = open();
  const sink = vi.spyOn(console, "error").mockImplementation(() => {});
  const db: PluginKernel = { ...store, query: async () => { throw kind === "error" ? failure() : SECRET; } };
  try {
    const result = await declareDataModule({ db, dbPath: ":memory:", decl: declaration });
    expect(result).toMatchObject({ ok: false, error: { code: "PREFLIGHT_FAILED", message: "Data module preflight failed." } });
    expect(await listTables({ kernel: store })).not.toContain("p_example__first");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([result, sink.mock.calls])).not.toContain(SECRET);
  } finally { await store.close(); }
});

test("J: deliberate declaration validation remains actionable without performing DDL", async () => {
  const store = open();
  try {
    const result = await declareDataModule({ db: store, dbPath: ":memory:", decl: { ...declaration, tables: [] } });
    expect(result).toMatchObject({ ok: false, error: { code: "EMPTY", message: "declaration lists no tables" } });
    expect(await listTables({ kernel: store })).not.toContain("p_example__first");
  } finally { await store.close(); }
});

test("J: path mismatch emits fixed copy and still installs into the open database", async () => {
  const store = open();
  const sink = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await declareDataModule({ db: store, dbPath: `/private/tmp/${SECRET}`, decl: declaration });
    expect(result).toMatchObject({ ok: true, created: ["p_example__first", "p_example__second"] });
    expect(await listTables({ kernel: store })).toContain("p_example__first");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.mock.calls)).toContain("Configured database path does not name the open database.");
    expect(JSON.stringify(sink.mock.calls)).not.toContain(SECRET);
  } finally { await store.close(); }
});

test("J: held restore lock returns fixed busy copy and never calls or releases the gateway", async () => {
  let executed = 0;
  let released = 0;
  const result = await executeRestore({ deps: {
    clock: { nowMs: () => 0 }, gateway: { execute: async () => { executed++; return { ok: true, value: { restoreRunId: "run", state: "RESTORED" } }; } },
    operationLock: { acquireOperationLock: async () => ({ ok: false, error: { code: "BUSY", message: SECRET } }),
      releaseOperationLock: async () => { released++; } },
  }, input: { principalId: "user", principalKind: "user", confirmationToken: "token", siteId: "site" } });
  expect(result).toEqual({ ok: false, error: { code: "RESTORE_OPERATION_IN_FLIGHT", message: "an operation is already in flight for site 'site'" } });
  expect([executed, released]).toEqual([0, 0]);
});
