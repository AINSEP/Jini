import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, describe, test } from "vitest";
import { sql } from "kysely";
import { listTables, UnsupportedCapabilityError } from "../../kernel/index.js";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import { migrate, runMigrations, type LegacyLedgerMapping, type MigrationStep } from "../../migrate/index.js";

const checksum = "a".repeat(64);
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fresh() {
  const database = new Database(":memory:");
  databases.push(database);
  return { database, kernel: sqliteKernel<unknown>(database) };
}

function step(id: string): MigrationStep {
  return { id, checksum, up: async (kernel) => { await kernel.execute(sql`CREATE TABLE ${sql.table(id)} (value text)`); } };
}

const steps = [step("0001_first"), step("0002_second"), step("0003_third")];

function mapping(): LegacyLedgerMapping {
  return {
    columns: { version: "version", name: "name", checksum: "checksum", appliedAt: "applied_at" },
    identities: {
      "0001_first": { version: 2, name: "records-2" },
      "0002_second": { version: 10, name: "records-10" },
      "0003_third": { version: 11, name: "records-11" },
    },
  };
}

describe("opt-in migration atomicity", () => {
  test("batch failure rolls back earlier DDL and the ledger while omission retains partial progress", async () => {
    const failed: MigrationStep = { ...steps[1]!, up: async (kernel) => {
      await kernel.execute(sql`CREATE TABLE incomplete (value text)`);
      throw new Error("second step failed");
    } };
    for (const batch of [false, true]) {
      const { kernel } = fresh();
      await assert.rejects(migrate({ kernel, steps: [steps[0]!, failed], ledgerTable: "history" }, batch ? { atomicity: "batch" } : {}), /second step failed/);
      assert.deepEqual(await listTables(kernel), batch ? [] : ["0001_first", "history"]);
      if (!batch) assert.deepEqual(await kernel.query(sql`select id from history`), [{ id: "0001_first" }]);
    }
  });

  test("rereads history under the acquired lock and skips a competing runner's applied step", async () => {
    const { kernel } = fresh();
    await runMigrations(kernel, [], { ledgerTable: "history" });
    const lock = kernel.lockKey;
    let calls = 0;
    kernel.lockKey = async (key) => {
      await lock(key);
      calls++;
      await kernel.execute(sql`CREATE TABLE history (id text primary key, checksum text not null, applied_at text not null)`);
      await steps[0]!.up(kernel, { note() {} });
      await kernel.execute(sql`INSERT INTO history VALUES ('0001_first', ${checksum}, 'competitor')`);
    };
    const report = await migrate({ kernel, steps: steps.slice(0, 2), ledgerTable: "history" }, { atomicity: "batch", historyCheck: "ordered-prefix" });
    assert.deepEqual(report.applied, ["0002_second"]);
    assert.deepEqual(report.alreadyApplied, ["0001_first"]);
    assert.equal(calls, 1);
    assert.deepEqual(await kernel.query(sql`select applied_at from history where id = '0001_first'`), [{ applied_at: "competitor" }]);
  });

  test("rejects pending preparation and missing capabilities before backup or migration effects", async () => {
    for (const capability of ["interactiveTransactions", "transactionalDdl"] as const) {
      const { kernel } = fresh();
      const originalRequire = kernel.require;
      kernel.require = (required) => {
        if (required === capability) throw new UnsupportedCapabilityError(required, kernel.transport);
        originalRequire(required);
      };
      let backups = 0;
      kernel.backupTo = async () => { backups++; };
      await assert.rejects(migrate({ kernel, steps, ledgerTable: "history" }, { atomicity: "batch", backupPath: "/unused" }), (error) => error instanceof UnsupportedCapabilityError && error.capability === capability);
      assert.equal(backups, 0);
      assert.deepEqual(await listTables(kernel), []);
    }
    const { kernel } = fresh();
    let prepared = false;
    await assert.rejects(migrate({ kernel, steps: [{ ...steps[0]!, prepare: async () => { prepared = true; } }], ledgerTable: "history" }, { atomicity: "batch" }), /prepare hooks/);
    assert.equal(prepared, false);
    assert.deepEqual(await listTables(kernel), []);
    // Already-applied hooks are not part of the pending batch.
    await runMigrations(kernel, [steps[0]!], { ledgerTable: "history" });
    assert.deepEqual((await migrate({ kernel, steps: [{ ...steps[0]!, prepare: async () => { prepared = true; } }], ledgerTable: "history" }, { atomicity: "batch" })).applied, []);
    assert.equal(prepared, false);
  });

  test("refuses joined and foreign transactions before applying batch effects", async () => {
    const { database, kernel } = fresh();
    const run = () => migrate({ kernel, steps, ledgerTable: "history" }, { atomicity: "batch" });
    await assert.rejects(kernel.transaction(run), /cannot join/);
    await assert.rejects(kernel.run(run), /cannot join/);
    database.exec("BEGIN");
    await assert.rejects(run(), /cannot join/);
    database.exec("ROLLBACK");
    assert.deepEqual(await listTables(kernel), []);
  });
});

describe("ordered-prefix history and migration clock", () => {
  test("accepts empty, partial and complete prefixes and samples once per inserted row", async () => {
    const { kernel } = fresh();
    let samples = 0;
    const clock = { nowMs: () => samples++ * 1000 };
    await migrate({ kernel, steps: steps.slice(0, 1), ledgerTable: "history" }, { historyCheck: "ordered-prefix", clock });
    const partial = await migrate({ kernel, steps, ledgerTable: "history" }, { historyCheck: "ordered-prefix", clock });
    assert.deepEqual(partial.applied, ["0002_second", "0003_third"]);
    assert.deepEqual(await kernel.query(sql`select applied_at from history order by id`), [
      { applied_at: "1970-01-01T00:00:00.000Z" }, { applied_at: "1970-01-01T00:00:01.000Z" }, { applied_at: "1970-01-01T00:00:02.000Z" },
    ]);
    assert.deepEqual((await migrate({ kernel, steps, ledgerTable: "history" }, { historyCheck: "ordered-prefix", clock })).applied, []);
    assert.equal(samples, 3);
  });

  test("strict history rejects holes, extra rows and changed checksums; default still accepts known holes", async () => {
    for (const drift of ["hole", "extra", "checksum"] as const) {
      const { database, kernel } = fresh();
      await migrate({ kernel, steps, ledgerTable: "history" });
      if (drift === "hole") database.exec("delete from history where id = '0002_second'");
      if (drift === "extra") database.prepare("insert into history values (?, ?, ?)").run("0004_extra", checksum, "original");
      if (drift === "checksum") database.exec("update history set checksum = 'changed' where id = '0002_second'");
      await assert.rejects(migrate({ kernel, steps, ledgerTable: "history" }, { historyCheck: "ordered-prefix" }), drift === "hole" ? /ordered prefix/ : drift === "extra" ? /does not know/ : /checksum/);
      if (drift === "hole") {
        const noEffect = steps.map((s) => ({ ...s, up: async () => {} }));
        assert.deepEqual((await migrate({ kernel, steps: noEffect, ledgerTable: "history" })).applied, ["0002_second"]);
      }
    }
  });

  test("strict checks repeat under the transaction lock after concurrent history drift", async () => {
    for (const atomicity of ["step", "batch"] as const) {
      const { kernel } = fresh();
      await migrate({ kernel, steps: steps.slice(0, 1), ledgerTable: "history" });
      const lock = kernel.lockKey;
      kernel.lockKey = async (key) => {
        await lock(key);
        await kernel.execute(sql`INSERT INTO history VALUES ('0003_third', ${checksum}, 'concurrent')`);
      };
      await assert.rejects(migrate({ kernel, steps, ledgerTable: "history" }, { atomicity, historyCheck: "ordered-prefix" }), /ordered prefix/);
      assert.deepEqual(await listTables(kernel), ["0001_first", "history"]);
    }
  });

  test("invalid clock output rolls back the step and its ledger insert", async () => {
    const { kernel } = fresh();
    await assert.rejects(migrate({ kernel, steps: steps.slice(0, 1), ledgerTable: "history" }, { clock: { nowMs: () => NaN } }), /Invalid time value/);
    assert.deepEqual(await listTables(kernel), []);
  });
});

describe("explicit legacy ledger mapping", () => {
  test("omitting the mapping retains the standard ledger schema and column order", async () => {
    const { database, kernel } = fresh();
    await migrate({ kernel, steps: steps.slice(0, 1), ledgerTable: "history" });
    assert.deepEqual(database.prepare("select sql from sqlite_master where name = 'history'").get(), {
      sql: 'CREATE TABLE "history" ("id" text primary key, "checksum" text not null, "applied_at" text not null)',
    });
    assert.deepEqual(database.prepare("select id, checksum from history").all(), [{ id: "0001_first", checksum }]);
  });

  test("adopts an existing ledger without rewriting names, checksums or database-default timestamps", async () => {
    const { database, kernel } = fresh();
    database.exec("create table history (version integer primary key, name text not null, checksum text not null, applied_at text not null default CURRENT_TIMESTAMP)");
    database.prepare("insert into history values (?, ?, ?, ?)").run(2, "records-2", checksum, "original timestamp bytes");
    const report = await migrate({ kernel, steps, ledgerTable: "history" }, { legacyLedger: mapping(), historyCheck: "ordered-prefix", atomicity: "batch" });
    assert.deepEqual(report.applied, ["0002_second", "0003_third"]);
    const rows = database.prepare("select * from history order by version").all() as Array<{ version: number; name: string; checksum: string; applied_at: string }>;
    assert.deepEqual(rows.map((row) => [row.version, row.name, row.checksum]), [[2, "records-2", checksum], [10, "records-10", checksum], [11, "records-11", checksum]]);
    assert.equal(rows[0]!.applied_at, "original timestamp bytes");
    assert.match(rows[1]!.applied_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.deepEqual((await migrate({ kernel, steps, ledgerTable: "history" }, { legacyLedger: mapping(), historyCheck: "ordered-prefix" })).applied, []);
  });

  test("creates mapped ledgers, quotes identifiers and supports explicit ISO clock timestamps", async () => {
    const { database, kernel } = fresh();
    const mapped = mapping();
    mapped.columns = { version: 'version "number', name: "migration-name", checksum: "check sum", appliedAt: "when" };
    mapped.timestamps = "iso";
    let samples = 0;
    await migrate({ kernel, steps, ledgerTable: 'history "table' }, { legacyLedger: mapped, clock: { nowMs: () => samples++ * 1000 } });
    const rows = database.prepare('select * from "history ""table" order by "version ""number"').all();
    assert.deepEqual(rows, [2, 10, 11].map((version, index) => ({
      'version "number': version, "migration-name": `records-${version}`, "check sum": checksum, when: `1970-01-01T00:00:0${index}.000Z`,
    })));
    assert.equal(samples, 3);
  });

  test("rejects invalid mappings and incompatible clock policy before any schema effect", async () => {
    const variants: Array<(m: LegacyLedgerMapping) => void> = [
      (m) => { delete (m.identities as Record<string, unknown>)["0002_second"]; },
      (m) => { m.identities["0002_second"]!.version = 2; },
      (m) => { m.identities["0002_second"]!.version = 1; },
      (m) => { m.identities["0002_second"]!.name = "records-2"; },
      (m) => { m.identities["0002_second"]!.version = 0; },
      (m) => { m.identities["0002_second"]!.version = Number.MAX_SAFE_INTEGER + 1; },
      (m) => { m.columns.name = m.columns.version; },
    ];
    for (const change of variants) {
      const { kernel } = fresh();
      const legacyLedger = mapping();
      change(legacyLedger);
      await assert.rejects(migrate({ kernel, steps, ledgerTable: "history" }, { legacyLedger }));
      assert.deepEqual(await listTables(kernel), []);
    }
    const { kernel } = fresh();
    let samples = 0;
    await assert.rejects(migrate({ kernel, steps, ledgerTable: "history" }, { legacyLedger: mapping(), clock: { nowMs: () => samples++ } }), /requires ISO/);
    assert.equal(samples, 0);
    assert.deepEqual(await listTables(kernel), []);
  });

  test("rejects persisted name or checksum drift before applying pending work", async () => {
    for (const column of ["name", "checksum"] as const) {
      const { database, kernel } = fresh();
      await migrate({ kernel, steps, ledgerTable: "history" }, { legacyLedger: mapping() });
      database.exec(`update history set ${column} = 'changed' where version = 2`);
      const later = step("0004_later");
      const mapped = mapping();
      const legacyLedger = { ...mapped, identities: { ...mapped.identities, "0004_later": { version: 12, name: "records-12" } } };
      await assert.rejects(migrate({ kernel, steps: [...steps, later], ledgerTable: "history" }, { legacyLedger }), column === "name" ? /name drift/ : /checksum/);
      assert.ok(!(await listTables(kernel)).includes("0004_later"));
    }
  });
});


describe("opt-in additive history compatibility", () => {
  test("an older history opens a newer database without replay; default still refuses and known checksums remain enforced", async () => {
    const { kernel } = fresh();
    await runMigrations(kernel, steps, { ledgerTable: "project_history" });
    await assert.rejects(runMigrations(kernel, steps.slice(0, 2), { ledgerTable: "project_history" }), /migration/i);
    const report = await runMigrations(kernel, steps.slice(0, 2), { ledgerTable: "project_history", allowUnknownApplied: true });
    assert.deepEqual(report.applied, []);
    assert.deepEqual(await kernel.query(sql`SELECT id FROM project_history ORDER BY id`), steps.map(step => ({ id: step.id })));
    await assert.rejects(runMigrations(kernel, [{ ...steps[0]!, checksum: "b".repeat(64) }], { ledgerTable: "project_history", allowUnknownApplied: true }), /checksum/i);
  });
});
