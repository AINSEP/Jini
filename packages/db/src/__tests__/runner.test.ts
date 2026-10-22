import assert from "node:assert/strict";
import { afterAll as after, describe, test } from "vitest";

import { sql } from "kysely";

import { listTables } from "../kernel/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { openMemorySqliteKernel } from "../kernel/sqlite/index.js";
import type { StorageKernel } from "../kernel/index.js";
import { assertValidSteps, hasLedger, runMigrations } from "../migrate/index.js";
import { MigrationChecksumError, type MigrationStep, UnknownAppliedMigrationError } from "../migrate/index.js";
import { PGlite } from "@electric-sql/pglite";
import { openSqlite, LEDGER } from "./helpers.js";

/**
 * @file The migration runner's rules on every embedded dialect: pending steps apply in order and
 * are recorded with their checksum; a rerun applies nothing; a failing step rolls back and stops the
 * run; a recorded step whose checksum changed, or that this runtime does not know, stops the run
 * before anything is applied. Serialization across real connections is `runner.postgres.test.ts`.
 */

const sum = (char: string) => char.repeat(64);

function tableStep(id: string, table: string, checksum = sum("a")): MigrationStep {
  return {
    id,
    checksum,
    up: async (kernel) => {
      await kernel.execute(sql`CREATE TABLE ${sql.table(table)} (id text PRIMARY KEY)`);
    },
  };
}

const kernels: Array<StorageKernel<unknown>> = [];
after(async () => {
  for (const kernel of kernels) await kernel.close();
});

const dialects: Array<{ name: string; open: () => StorageKernel<unknown> }> = [
  { name: "sqlite", open: () => openMemorySqliteKernel<unknown>({ open: openSqlite }) },
  { name: "pglite", open: () => openPgliteKernel<unknown>({ PGlite }) },
];

for (const { name, open } of dialects) {
  describe(`runMigrations on ${name}`, () => {
    const fresh = () => {
      const kernel = open();
      kernels.push(kernel);
      return kernel;
    };

    test("applies pending steps in order, records them, and a rerun applies nothing", async () => {
      const kernel = fresh();
      const steps = [tableStep("0001_first", "first_t"), tableStep("0002_second", "second_t", sum("b"))];
      const report = await runMigrations(kernel, steps, { ledgerTable: LEDGER });
      assert.deepEqual(report.applied, ["0001_first", "0002_second"]);
      assert.deepEqual(report.alreadyApplied, []);
      const ledger = await kernel.query<{ id: string; checksum: string; applied_at: string }>(
        sql`SELECT id, checksum, applied_at FROM app_migrations ORDER BY id`
      );
      assert.deepEqual(
        ledger.map((row) => [row.id, row.checksum]),
        [
          ["0001_first", sum("a")],
          ["0002_second", sum("b")],
        ]
      );
      assert.match(ledger[0]?.applied_at ?? "",  /^\d{4}-\d\d-\d\dT/);

      const again = await runMigrations(kernel, steps, { ledgerTable: LEDGER });
      assert.deepEqual(again.applied, []);
      assert.deepEqual(again.alreadyApplied, ["0001_first", "0002_second"]);
    });

    test("a failing step rolls back its own changes, is not recorded, and stops later steps", async () => {
      const kernel = fresh();
      const failing: MigrationStep = {
        id: "0002_fails",
        checksum: sum("c"),
        up: async (k) => {
          await k.execute(sql`CREATE TABLE half_done (id text)`);
          throw new Error("boom");
        },
      };
      await assert.rejects(runMigrations(kernel, [tableStep("0001_first", "first_t"), failing, tableStep("0003_third", "third_t")], { ledgerTable: LEDGER }), /boom/);
      const tables = await listTables(kernel);
      assert.ok(tables.includes("first_t"));
      assert.ok(!tables.includes("half_done"), "the failed step's DDL rolled back");
      assert.ok(!tables.includes("third_t"), "later steps were not attempted");
      const ids = await kernel.query<{ id: string }>(sql`SELECT id FROM app_migrations`);
      assert.deepEqual(
        ids.map((row) => row.id),
        ["0001_first"]
      );
    });

    test("prepare runs before up and ledger creation, passes context, and is skipped on rerun", async () => {
      const kernel = fresh();
      await kernel.execute(sql`CREATE TABLE prepared_value (value text)`);
      const events: string[] = [];
      const step: MigrationStep = {
        id: "0001_prepared",
        checksum: sum("a"),
        prepare: async (k, context) => {
          assert.equal(await hasLedger(k, LEDGER), false);
          events.push("prepare");
          await k.execute(sql`INSERT INTO prepared_value VALUES ('prepared before up')`);
          context.note("preparation complete");
        },
        up: async (k) => {
          assert.deepEqual(await k.query(sql`SELECT value FROM prepared_value`), [{ value: "prepared before up" }]);
          events.push("up");
          await k.execute(sql`UPDATE prepared_value SET value = 'applied'`);
        },
      };
      assert.deepEqual(await runMigrations(kernel, [step], { ledgerTable: LEDGER }), {
        applied: ["0001_prepared"], alreadyApplied: [], notes: ["preparation complete"],
      });
      assert.deepEqual(await kernel.query(sql`SELECT value FROM prepared_value`), [{ value: "applied" }]);
      assert.deepEqual(await kernel.query(sql`SELECT id, checksum FROM app_migrations`), [{ id: "0001_prepared", checksum: sum("a") }]);
      assert.deepEqual(await runMigrations(kernel, [step], { ledgerTable: LEDGER }), {
        applied: [], alreadyApplied: ["0001_prepared"], notes: [],
      });
      assert.deepEqual(events, ["prepare", "up"]);
    });

    test("a rejecting prepare preserves existing data, creates no ledger, and stops up and later steps", async () => {
      const kernel = fresh();
      await kernel.execute(sql`CREATE TABLE keep_value (value text)`);
      await kernel.execute(sql`INSERT INTO keep_value VALUES ('original')`);
      const failure = new Error("preparation refused");
      const step: MigrationStep = {
        id: "0001_refused", checksum: sum("a"),
        prepare: async () => { throw failure; },
        up: async (k) => { await k.execute(sql`DELETE FROM keep_value`); },
      };
      await assert.rejects(runMigrations(kernel, [step, tableStep("0002_later", "later_t")], { ledgerTable: LEDGER }),
        (error: unknown) => error === failure);
      assert.deepEqual(await listTables(kernel), ["keep_value"]);
      assert.deepEqual(await kernel.query(sql`SELECT value FROM keep_value`), [{ value: "original" }]);
      assert.equal(await hasLedger(kernel, LEDGER), false);
    });

    test("a recorded step whose checksum changed stops the run before anything is applied", async () => {
      const kernel = fresh();
      await runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER });
      await assert.rejects(
        runMigrations(kernel, [tableStep("0001_first", "first_t", sum("d")), tableStep("0002_second", "second_t")], { ledgerTable: LEDGER }),
        (error: unknown) => error instanceof MigrationChecksumError && error.id === "0001_first"
      );
      assert.ok(!(await listTables(kernel)).includes("second_t"));
    });

    test("a recorded step this runtime does not know stops the run (database from a newer version)", async () => {
      const kernel = fresh();
      await runMigrations(kernel, [tableStep("0001_first", "first_t"), tableStep("0002_newer", "newer_t")], { ledgerTable: LEDGER });
      await assert.rejects(
        runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER }),
        (error: unknown) =>
          error instanceof UnknownAppliedMigrationError &&
          error.ids.join() === "0002_newer" &&
          error.message ===
            "the database has migrations this runtime does not know (0002_newer); it was upgraded by a newer version — run that version"
      );
      await assert.rejects(
        runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER, appName: "Acme" }),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "the database has migrations this runtime does not know (0002_newer); it was upgraded by a newer Acme — run that version"
      );
    });

    test("the ledger is the one the consumer names, and is required", async () => {
      const kernel = fresh();
      await runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: "other_ledger" });
      assert.ok(await hasLedger(kernel, "other_ledger"));
      assert.equal(await hasLedger(kernel, LEDGER), false, "no default ledger name is ever created");
      await assert.rejects(
        runMigrations(kernel, [tableStep("0001_first", "first_t")], {} as never),
        /^Error: runMigrations: options.ledgerTable is required$/
      );
    });
  });
}

describe("assertValidSteps", () => {
  test("rejects malformed, unordered or duplicate ids and missing checksums", () => {
    assert.throws(() => assertValidSteps([tableStep("1_bad", "t")]), /NNNN_snake_name/);
    assert.throws(() => assertValidSteps([tableStep("0002_b", "t"), tableStep("0001_a", "t")]), /out of order/);
    assert.throws(() => assertValidSteps([tableStep("0001_a", "t"), tableStep("0001_a", "t")]), /out of order or duplicated/);
    assert.throws(() => assertValidSteps([tableStep("0001_a", "t", "nope")]), /sha256/);
  });
});
