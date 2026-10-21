import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { LedgerConstraintError } from "../repo.js";
import { constraintKindOf, migrateCommercePayments, sqlPaymentsLedger } from "../sql.js";
import { ledgerContract, payment } from "./ledger-contract.js";

/**
 * @file The SQL adapter on SQLite (better-sqlite3, in memory): the shared contract, plus what only
 * the SQL adapter has — driver-error translation.
 */

function openKernel() {
  return openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });
}

ledgerContract("sql/sqlite", async () => {
  const kernel = openKernel();
  await migrateCommercePayments({ kernel });
  return { ledger: sqlPaymentsLedger({ kernel }), close: () => kernel.close() };
});

describe("SQL adapter: driver errors", () => {
  test("SQLite and Postgres constraint codes map to the ledger's kinds; anything else is not a constraint", () => {
    expect(constraintKindOf({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe("unique");
    expect(constraintKindOf({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe("unique");
    expect(constraintKindOf({ code: "23505" })).toBe("unique");
    expect(constraintKindOf({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" })).toBe("foreign-key");
    expect(constraintKindOf({ code: "23503" })).toBe("foreign-key");
    expect(constraintKindOf({ code: "SQLITE_CONSTRAINT_CHECK" })).toBeNull();
    expect(constraintKindOf({ code: "toString" })).toBeNull();
    expect(constraintKindOf({ code: 23505 })).toBeNull();
    expect(constraintKindOf({})).toBeNull();
    expect(constraintKindOf(null)).toBeNull();
    expect(constraintKindOf("23505")).toBeNull();
  });

  test("a write failing for another reason surfaces the driver's own error", async () => {
    const kernel = openKernel();
    try {
      // No migration: the table does not exist.
      const error = await sqlPaymentsLedger({ kernel }).transaction((tx) => tx.insertPayment({ payment: payment() })).catch((caught: unknown) => caught);
      expect(error).not.toBeInstanceOf(LedgerConstraintError);
      expect(String(error)).toMatch(/no such table: commerce_payments/);
    } finally {
      await kernel.close();
    }
  });

  test("a translated constraint error keeps the driver error as its cause", async () => {
    const kernel = openKernel();
    try {
      await migrateCommercePayments({ kernel });
      const ledger = sqlPaymentsLedger({ kernel });
      await ledger.transaction((tx) => tx.insertPayment({ payment: payment() }));
      const insert = (overrides: Parameters<typeof payment>[0]) =>
        ledger.transaction((tx) => tx.insertPayment({ payment: payment(overrides) })).then(
          () => new Error("expected a constraint error"),
          (caught: unknown) => caught as LedgerConstraintError
        );
      const byKey = await insert({ id: "pay-2" });
      expect(byKey).toBeInstanceOf(LedgerConstraintError);
      expect((byKey.cause as { code: string }).code).toBe("SQLITE_CONSTRAINT_UNIQUE");
      const byId = await insert({ idempotencyKey: "idem-2" });
      expect(byId).toBeInstanceOf(LedgerConstraintError);
      expect((byId.cause as { code: string }).code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
    } finally {
      await kernel.close();
    }
  });

  test("the CHECKs refuse an unknown mode and a negative amount", async () => {
    const kernel = openKernel();
    try {
      await migrateCommercePayments({ kernel });
      const ledger = sqlPaymentsLedger({ kernel });
      await expect(ledger.transaction((tx) => tx.insertPayment({ payment: payment({ mode: "staging" as "live" }) }))).rejects.toThrow(/CHECK constraint failed/);
      await expect(ledger.transaction((tx) => tx.insertPayment({ payment: payment({ amountMinor: -1 }) }))).rejects.toThrow(/CHECK constraint failed/);
    } finally {
      await kernel.close();
    }
  });
});
