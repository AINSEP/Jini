import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { sql } from "kysely";
import { describe, expect, test } from "vitest";

import { listTables } from "@jini-ai/db/kernel";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { MigrationChecksumError, runMigrations, sourceChecksum } from "@jini-ai/db/migrate";
import { PAYMENTS_LEDGER_ID, paymentsLedger } from "../migrations/0001_payments_ledger.js";
import { PAYMENTS_OPERATOR_ACTIONS_ID } from "../migrations/0002_payments_operator_actions.js";
import { PAYMENTS_ATTEMPT_RECOVERY_ID } from "../migrations/0004_payments_attempt_recovery.js";
import { COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS } from "../migrations/checksums.js";
import { LEDGER_INTEGER_COLUMNS, LEDGER_TABLE_RULES, LEDGER_TABLES } from "../rows.js";
import { sqlPaymentsLedger } from "../repo.sql.js";
import { payment } from "./ledger-contract.js";

/**
 * @file Holds the payments ledger's migration history immutable (ADR-066 §3) and proves it applies:
 * every step's pinned checksum equals the one derived from its source (comments removed,
 * whitespace collapsed), so editing a shipped step goes red here instead of differing silently
 * between databases. `UPDATE_COMMERCE_PAYMENTS_CHECKSUMS=1` pins NEW ids only.
 */

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../migrations");
const CHECKSUMS_FILE = path.join(MIGRATIONS_DIR, "checksums.ts");

/** Normalized step source: block and line comments removed, whitespace collapsed. The steps hold no `//` in strings. */
function derive(id: string): string {
  const text = fs.readFileSync(path.join(MIGRATIONS_DIR, `${id}.ts`), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return sourceChecksum(text);
}

/** Every `NNNN_name.ts` step file, so a step that exists but is not pinned (or not registered) is caught. */
const STEP_IDS = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_[a-z0-9_]+\.ts$/.test(name)).map((name) => name.slice(0, -3)).sort();

// `index.ts` refuses to load while a step is unpinned, so it is imported only after the pin check.
const history = () => import("../migrations/index.js");

function openKernel() {
  return openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });
}

describe("payments ledger migrations", () => {
  test("every step's pinned checksum matches its source", async () => {
    const unpinned = STEP_IDS.filter((id) => COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS[id] === undefined);
    if (process.env.UPDATE_COMMERCE_PAYMENTS_CHECKSUMS === "1" && unpinned.length > 0) {
      const lines = unpinned.map((id) => `  "${id}": "${derive(id)}",\n`).join("");
      fs.writeFileSync(CHECKSUMS_FILE, fs.readFileSync(CHECKSUMS_FILE, "utf8").replace(/\n};\n$/, `\n${lines}};\n`));
      return;
    }
    expect(unpinned, "pin new steps with UPDATE_COMMERCE_PAYMENTS_CHECKSUMS=1").toEqual([]);
    const { COMMERCE_PAYMENTS_MIGRATIONS } = await history();
    for (const step of COMMERCE_PAYMENTS_MIGRATIONS) {
      expect(derive(step.id), `${step.id} changed after it was pinned; add a new step instead`).toBe(COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS[step.id]);
      expect(step.checksum).toBe(COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS[step.id]);
    }
    expect(COMMERCE_PAYMENTS_MIGRATIONS.map((step) => step.id)).toEqual(STEP_IDS);
    expect(STEP_IDS).toEqual([PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID]);
  });

  test("pinnedChecksum refuses an id with no pin", async () => {
    const { pinnedChecksum } = await history();
    expect(pinnedChecksum({ id: "x" }, { checksums: { x: "c" } })).toBe("c");
    expect(() => pinnedChecksum({ id: "9999_nope" })).toThrow(/9999_nope has no pinned checksum/);
  });

  // Regression: a migration id must name an own checksum, never Object.prototype data.
  test.each(["toString", "constructor", "hasOwnProperty", "__proto__"])
    ("an inherited property %s is not a pinned migration checksum", async (id) => {
      const { pinnedChecksum } = await history();
      expect(() => pinnedChecksum({ id })).toThrow(`commerce payments migration ${id} has no pinned checksum in checksums.ts`);
    });

  test.each(["toString", "constructor", "hasOwnProperty", "__proto__"])
    ("an injected checksum table also refuses inherited property %s", async (id) => {
      const { pinnedChecksum } = await history();
      expect(() => pinnedChecksum({ id }, { checksums: {} })).toThrow(`commerce payments migration ${id} has no pinned checksum in checksums.ts`);
    });

  test("upgrading a populated first-step database preserves attempts and outbox enqueue order", async () => {
    const { COMMERCE_PAYMENTS_MIGRATIONS, COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      await runMigrations(kernel, COMMERCE_PAYMENTS_MIGRATIONS.slice(0, 1), { ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
      const ledger = sqlPaymentsLedger({ kernel });
      await ledger.transaction({ fn: (tx) => tx.insertPayment({ payment: payment() }) });
      await kernel.execute(sql`INSERT INTO commerce_payment_attempts
        (id, payment_id, workspace_id, site_id, provider_id, provider_account_id, mode, op, operation_key,
         refund_id, outcome, error_code, error_message, created_at, updated_at)
        VALUES ('legacy-attempt', 'pay-1', 'ws-1', 'site-1', 'stripe', 'acct-1', 'live', 'capture', 'legacy-op',
                NULL, 'unknown', NULL, NULL, 101, 203)`);
      await kernel.execute(sql`INSERT INTO commerce_outbox
        (id, workspace_id, mode, topic, aggregate_id, payload_json, created_at, published_at)
        VALUES ('z-legacy', 'ws-1', 'live', 'payment.succeeded', 'pay-1', '{"minor":101}', 307, NULL)`);
      expect(await migrateCommercePayments({ kernel })).toEqual({
        applied: [PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID], alreadyApplied: [PAYMENTS_LEDGER_ID], notes: [],
      });
      await ledger.transaction({ fn: async (tx) => {
        expect(await tx.findAttemptByOperationKey({ workspaceId: "ws-1", mode: "live", operationKey: "legacy-op" })).toEqual({
          id: "legacy-attempt", paymentId: "pay-1", workspaceId: "ws-1", siteId: "site-1", providerId: "stripe",
          providerAccountId: "acct-1", mode: "live", op: "capture", operationKey: "legacy-op", refundId: null,
          outcome: "unknown", errorCode: null, errorMessage: null, createdAt: 101, updatedAt: 203, currency: null, amountMinor: null,
        });
        await tx.insertAttempt({ attempt: {
          id: "new-attempt", paymentId: "pay-1", workspaceId: "ws-1", siteId: "site-1", providerId: "stripe",
          providerAccountId: "acct-1", mode: "live", op: "capture", operationKey: "new-op", refundId: null,
          outcome: "dispatched", errorCode: null, errorMessage: null, createdAt: 409, updatedAt: 503, currency: "JPY", amountMinor: 601,
        } });
        await tx.enqueueOutbox({ message: {
          id: "a-new", workspaceId: "ws-1", mode: "live", topic: "refund.succeeded", aggregateId: "refund",
          payloadJson: '{"minor":601}', createdAt: 307,
        } });
        expect(await tx.listPendingOutbox({ limit: 10 })).toEqual([
          { id: "z-legacy", workspaceId: "ws-1", mode: "live", topic: "payment.succeeded", aggregateId: "pay-1", payloadJson: '{"minor":101}', createdAt: 307, publishedAt: null },
          { id: "a-new", workspaceId: "ws-1", mode: "live", topic: "refund.succeeded", aggregateId: "refund", payloadJson: '{"minor":601}', createdAt: 307, publishedAt: null },
        ]);
        expect((await tx.listOpenAttempts({ ops: ["capture"], updatedBefore: 504, limit: 10 })).map(({ id, currency, amountMinor }) => ({ id, currency, amountMinor }))).toEqual([
          { id: "legacy-attempt", currency: null, amountMinor: null }, { id: "new-attempt", currency: "JPY", amountMinor: 601 },
        ]);
      } });
      expect(await migrateCommercePayments({ kernel })).toEqual({
        applied: [], alreadyApplied: [PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID], notes: [],
      });
      expect(await ledger.transaction({ fn: (tx) => tx.getPayment({ workspaceId: "ws-1", mode: "live", id: "pay-1" }) })).toEqual({ ...payment(), version: 1 });
    } finally {
      await kernel.close();
    }
  });

  test("migration options forward the host clock to every recorded application time", async () => {
    const { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      await migrateCommercePayments({ kernel }, { clock: { nowMs: () => 1_700_000_000_123 }, atomicity: "batch" });
      const rows = await kernel.query<{ id: string; applied_at: string }>(sql.raw(`SELECT id, applied_at FROM ${COMMERCE_PAYMENTS_LEDGER_TABLE} ORDER BY id`));
      expect(rows).toEqual([
        { id: PAYMENTS_LEDGER_ID, applied_at: "2023-11-14T22:13:20.123Z" },
        { id: PAYMENTS_OPERATOR_ACTIONS_ID, applied_at: "2023-11-14T22:13:20.123Z" },
        { id: PAYMENTS_ATTEMPT_RECOVERY_ID, applied_at: "2023-11-14T22:13:20.123Z" },
      ]);
    } finally {
      await kernel.close();
    }
  });

  test.each(["step", "batch"] as const)("a failed %s migration rolls back its owned scope and can be retried", async (atomicity) => {
    const { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      await kernel.run((db) => db.schema.createTable("commerce_operator_actions").addColumn("id", "text").execute());
      await expect(migrateCommercePayments({ kernel }, { atomicity })).rejects.toThrow(/commerce_operator_actions.*already exists/);
      const tables = await listTables(kernel);
      expect(tables.includes(LEDGER_TABLES.payments)).toBe(atomicity === "step");
      expect(tables.includes(COMMERCE_PAYMENTS_LEDGER_TABLE)).toBe(atomicity === "step");
      const auditColumns = await kernel.query<{ name: string }>(sql`PRAGMA table_info(commerce_operator_actions)`);
      expect(auditColumns.map((row) => row.name)).toEqual(["id"]);
      if (atomicity === "step") {
        const recorded = await kernel.query<{ id: string }>(sql.raw(`SELECT id FROM ${COMMERCE_PAYMENTS_LEDGER_TABLE} ORDER BY id`));
        expect(recorded).toEqual([{ id: PAYMENTS_LEDGER_ID }]);
        const outboxColumns = await kernel.query<{ name: string }>(sql`PRAGMA table_info(commerce_outbox)`);
        expect(outboxColumns.map((row) => row.name)).toEqual(["id", "workspace_id", "mode", "topic", "aggregate_id", "payload_json", "created_at", "published_at"]);
      }
      await kernel.run((db) => db.schema.dropTable("commerce_operator_actions").execute());
      expect(await migrateCommercePayments({ kernel }, { atomicity })).toEqual({
        applied: atomicity === "step" ? [PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID] : [PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID],
        alreadyApplied: atomicity === "step" ? [PAYMENTS_LEDGER_ID] : [], notes: [],
      });
    } finally {
      await kernel.close();
    }
  });

  test("applies once on a fresh database; a rerun is a no-op", async () => {
    const { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      const first = await migrateCommercePayments({ kernel });
      expect(first.applied).toEqual([PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID]);
      const tables = await listTables(kernel);
      expect(tables).toEqual(expect.arrayContaining([...Object.values(LEDGER_TABLES), COMMERCE_PAYMENTS_LEDGER_TABLE]));
      const second = await migrateCommercePayments({ kernel });
      expect(second).toEqual({ applied: [], alreadyApplied: [PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID], notes: [] });
      const indexes = await kernel.query<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'commerce_%' ORDER BY name`);
      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        "commerce_payment_attempts_payment", "commerce_refunds_payment", "commerce_disputes_payment",
        "commerce_payment_evidence_payment", "commerce_webhook_inbox_due",
        "commerce_operator_actions_payment", "commerce_payments_unknown", "commerce_refunds_unsettled",
        "commerce_payment_attempts_open",
      ]));
    } finally {
      await kernel.close();
    }
  });

  test("the created schema matches the rules the in-memory adapter enforces (NOT NULL, CHECK, integers, scoped FK)", async () => {
    const { migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      await migrateCommercePayments({ kernel });
      const integers = new Set<string>();
      for (const table of Object.values(LEDGER_TABLES)) {
        const columns = await kernel.query<{ name: string; type: string; notnull: number; pk: number }>(sql.raw(`PRAGMA table_info(${table})`));
        // Every column but the declared nullable ones is NOT NULL — the text primary key included.
        expect(columns.filter((c) => c.notnull === 0).map((c) => c.name).sort(), table).toEqual([...LEDGER_TABLE_RULES[table].nullable].sort());
        expect(columns.find((c) => c.pk === 1), table).toMatchObject({ name: "id", notnull: 1 });
        for (const c of columns) if (/int/i.test(c.type)) integers.add(c.name);
        const [{ sql: ddl }] = await kernel.query<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${table}`);
        expect(ddl, table).toContain("mode IN ('test', 'live')");
        const nonNegative = [...ddl.matchAll(/(\w+) >= 0/g)].map((match) => match[1]);
        expect(nonNegative.sort(), table).toEqual([...LEDGER_TABLE_RULES[table].nonNegative].sort());
        // Every money table carries its full scope.
        if (table !== LEDGER_TABLES.outbox && table !== LEDGER_TABLES.quarantine) {
          expect(columns.map((c) => c.name), table).toEqual(expect.arrayContaining(["workspace_id", "site_id", "provider_id", "provider_account_id", "mode"]));
        }
      }
      expect([...integers].sort()).toEqual([...LEDGER_INTEGER_COLUMNS].sort());
      for (const table of [LEDGER_TABLES.attempts, LEDGER_TABLES.refunds, LEDGER_TABLES.disputes, LEDGER_TABLES.evidence, LEDGER_TABLES.operatorActions]) {
        const keys = await kernel.query<{ table: string; from: string; to: string }>(sql.raw(`PRAGMA foreign_key_list(${table})`));
        expect(keys.map((k) => [k.table, k.from, k.to]), table).toEqual([
          ["commerce_payments", "payment_id", "id"], ["commerce_payments", "workspace_id", "workspace_id"], ["commerce_payments", "mode", "mode"],
        ]);
      }
    } finally {
      await kernel.close();
    }
  });

  test("a database recorded with a different checksum is refused before anything runs", async () => {
    const { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      await runMigrations(kernel, [paymentsLedger({ checksum: "0".repeat(64) })], { ledgerTable: COMMERCE_PAYMENTS_LEDGER_TABLE });
      await expect(migrateCommercePayments({ kernel })).rejects.toBeInstanceOf(MigrationChecksumError);
    } finally {
      await kernel.close();
    }
  });
});
