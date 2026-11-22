import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";

import { PAYMENTS_LEDGER_ID } from "../0001_payments_ledger.js";
import { PAYMENTS_OPERATOR_ACTIONS_ID } from "../0002_payments_operator_actions.js";
import { PAYMENTS_ATTEMPT_RECOVERY_ID } from "../0004_payments_attempt_recovery.js";
import { PAYMENTS_INTENT_REPLAY_ID } from "../0005_payments_intent_replay.js";
import {
  COMMERCE_PAYMENTS_LEDGER_TABLE, COMMERCE_PAYMENTS_MIGRATIONS, migrateCommercePayments,
  type PaymentsMigrationOptions, type PaymentsMigrationRunner,
} from "../index.js";

/**
 * @file The runner is injected (commerce no longer imports `@jini-ai/db`), but commerce stays the
 * producer of the ledger-table invariant: a recording fake runner pins the arguments commerce hands
 * db's `runMigrations`, which db defines as three POSITIONAL values with a required `ledgerTable`.
 */

const kernel = openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });

type Call = { kernel: unknown; steps: unknown; options: PaymentsMigrationOptions & { readonly ledgerTable: string } };
/** Records each call; resolves `report` or rejects with `failure` when given. */
function recordingRunner<Report>(outcome: { report: Report } | { failure: Error }) {
  const calls: Call[] = [];
  const runMigrations: PaymentsMigrationRunner<typeof kernel, Report> = async (givenKernel, steps, options) => {
    calls.push({ kernel: givenKernel, steps, options });
    if ("failure" in outcome) throw outcome.failure;
    return outcome.report;
  };
  return { calls, runMigrations };
}

describe("migrateCommercePayments with an injected runner", () => {
  test("T1: the runner gets (kernel, steps, options) positionally; steps are the history by identity, in the checked-in order", async () => {
    const { calls, runMigrations } = recordingRunner({ report: "r" });
    await migrateCommercePayments({ kernel, runMigrations });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kernel).toBe(kernel);
    expect(calls[0]?.steps).toBe(COMMERCE_PAYMENTS_MIGRATIONS);
    expect(COMMERCE_PAYMENTS_MIGRATIONS.map((step) => step.id)).toEqual([
      PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID, PAYMENTS_INTENT_REPLAY_ID,
    ]);
    expect(calls[0]?.options).toEqual({ ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
  });

  test("T2: the ledger table is commerce's even when the caller smuggles another one through an untyped object", async () => {
    const { calls, runMigrations } = recordingRunner({ report: "r" });
    const smuggled = { ledgerTable: "host_migrations", appName: "host" };
    await migrateCommercePayments({ kernel, runMigrations }, smuggled);
    expect(calls[0]?.options.ledgerTable).toBe(COMMERCE_PAYMENTS_LEDGER_TABLE);
    expect(calls[0]?.options.appName).toBe("host");
  });

  test("T3: every other option is forwarded unchanged", async () => {
    const { calls, runMigrations } = recordingRunner({ report: "r" });
    const everyOption = {
      allowUnknownApplied: true,
      backupPath: "/backups/payments.db",
      onBackupError: () => undefined,
      onBackupComplete: async () => undefined,
      schema: "payments",
      appName: "tovu",
      atomicity: "batch",
      historyCheck: "ordered-prefix",
      clock: { nowMs: () => 1_700_000_000_000 },
      legacyLedger: { columns: { version: "v", name: "n", checksum: "c", appliedAt: "a" }, identities: {}, timestamps: "iso" },
    } satisfies PaymentsMigrationOptions;
    await migrateCommercePayments({ kernel, runMigrations }, everyOption);
    expect(calls[0]?.options).toEqual({ ...everyOption, ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
  });

  test("T4: the runner's report comes back by identity and its rejection propagates unchanged", async () => {
    const report = { applied: ["x"], alreadyApplied: [], notes: [] };
    expect(await migrateCommercePayments({ kernel, runMigrations: recordingRunner({ report }).runMigrations })).toBe(report);
    const failure = new Error("ledger locked");
    await expect(migrateCommercePayments({ kernel, runMigrations: recordingRunner({ failure }).runMigrations })).rejects.toBe(failure);
  });
});
