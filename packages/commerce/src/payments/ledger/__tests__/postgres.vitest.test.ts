import { createRequire } from "node:module";
import path from "node:path";

import { sql } from "kysely";
import { describe, test } from "vitest";

import type { StorageKernel } from "@jini-ai/db/kernel";
import { openPostgresKernel } from "@jini-ai/db/kernel/postgres";
import { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } from "../migrations/index.js";
import { sqlPaymentsLedger } from "../repo.sql.js";
import { LEDGER_TABLES } from "../rows.js";
import { ledgerContract } from "./ledger-contract.js";

/**
 * @file The SQL adapter on a REAL Postgres — the dialect where BIGINT reads back as a string,
 * a unique violation aborts the transaction and `lockPayment` is an advisory lock. LOCAL ONLY:
 * skipped unless `COMMERCE_PG_URL` names a disposable database (every test DROPs the ledger tables).
 *
 *   COMMERCE_PG_URL=postgres://localhost/commerce_test npx vitest run -c vitest.kernel.config.ts src/payments/ledger
 *
 * `pg` is not a commerce dependency; it is borrowed from `@jini-ai/db`'s dev install so this file
 * adds none.
 */

const url = process.env.COMMERCE_PG_URL;

if (url === undefined || url === "") {
  describe.skip("PaymentsLedger contract: sql/postgres (set COMMERCE_PG_URL)", () => {
    test("skipped", () => {});
  });
} else {
  const pg = createRequire(path.resolve(import.meta.dirname, "../../../../node_modules/@jini-ai/db/package.json"))("pg");
  const reset = async (kernel: StorageKernel<unknown>) => {
    const tables = [...Object.values(LEDGER_TABLES), COMMERCE_PAYMENTS_LEDGER_TABLE].join(", ");
    await kernel.execute(sql.raw(`DROP TABLE IF EXISTS ${tables} CASCADE`));
  };
  ledgerContract("sql/postgres", async () => {
    const kernel = openPostgresKernel<unknown>({ pg, connectionString: url }, { max: 4 });
    await reset(kernel);
    await migrateCommercePayments({ kernel });
    return { ledger: sqlPaymentsLedger({ kernel }), close: () => kernel.close() };
  });
}
