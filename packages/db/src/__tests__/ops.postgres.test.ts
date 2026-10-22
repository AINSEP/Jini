import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, test } from "vitest";

import { sql } from "kysely";
import pg from "pg";

import { dropDatabase } from "../testing/pg-fixture.js";
import { freshPostgresDatabase } from "../testing/postgres-database.js";
import { openPostgresKernel } from "../kernel/postgres/index.js";
import { StorageOpError, StorageOpNotSupportedError } from "../kernel/ops.js";
import { postgresOps } from "../kernel/postgres/index.js";
import type { StorageKernel } from "../kernel/port.js";

/**
 * @file The storage ops port on a real Postgres server (node-postgres): no file copy, with the reason
 * named; compacting is `VACUUM (ANALYZE)` plus a read-back of the migration ledger.
 */

const DB = "jini_kernel_ops_test";
let kernel: StorageKernel<unknown>;

before(() => {
  kernel = openPostgresKernel<unknown>({ pg, connectionString: freshPostgresDatabase(DB) });
});
after(async () => {
  await kernel.close();
  dropDatabase(DB);
});

test("Postgres copyTo is refused with what to do instead", async () => {
  await assert.rejects(postgresOps(kernel, { ledgerTable: "app_migrations" }).copyTo("/never"), (err: unknown) => {
    assert.ok(err instanceof StorageOpNotSupportedError);
    assert.equal(
      err.message,
      "storage op copyTo is not supported on the node-postgres driver: a Postgres database is backed up by its provider; use a transfer tool to copy it"
    );
    return true;
  });
});

test("Postgres compactAndVerify refuses a missing ledger, then passes once it has a step", async () => {
  await assert.rejects(postgresOps(kernel, { ledgerTable: "app_migrations" }).compactAndVerify(), (err: unknown) => {
    assert.ok(err instanceof StorageOpError);
    assert.match(err.message, /^the migration ledger app_migrations cannot be read back: relation "app_migrations" does not exist/);
    return true;
  });
  await kernel.execute(sql`CREATE TABLE app_migrations (id text PRIMARY KEY)`);
  await kernel.execute(sql`INSERT INTO app_migrations VALUES ('0000_test')`);
  await postgresOps(kernel, { ledgerTable: "app_migrations" }).compactAndVerify();
  await assert.rejects(kernel.transaction(async () => postgresOps(kernel, { ledgerTable: "app_migrations" }).compactAndVerify()), /must be called outside a transaction/);
});
