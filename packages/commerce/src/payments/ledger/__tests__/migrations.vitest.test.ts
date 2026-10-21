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
import { LEGACY_LIPAY_IMPORT_ID } from "../migrations/0005_legacy_lipay_import.js";
import { COMMERCE_PAYMENTS_MIGRATION_CHECKSUMS } from "../migrations/checksums.js";
import { LEDGER_INTEGER_COLUMNS, LEDGER_TABLE_RULES, LEDGER_TABLES } from "../rows.js";

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
    expect(STEP_IDS).toEqual([PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID, LEGACY_LIPAY_IMPORT_ID]);
  });

  test("pinnedChecksum refuses an id with no pin", async () => {
    const { pinnedChecksum } = await history();
    expect(pinnedChecksum({ id: "x" }, { checksums: { x: "c" } })).toBe("c");
    expect(() => pinnedChecksum({ id: "9999_nope" })).toThrow(/9999_nope has no pinned checksum/);
  });

  test("applies once on a fresh database; a rerun is a no-op", async () => {
    const { COMMERCE_PAYMENTS_LEDGER_TABLE, migrateCommercePayments } = await history();
    const kernel = openKernel();
    try {
      const first = await migrateCommercePayments({ kernel });
      expect(first.applied).toEqual([PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID, LEGACY_LIPAY_IMPORT_ID]);
      const tables = await listTables(kernel);
      expect(tables).toEqual(expect.arrayContaining([...Object.values(LEDGER_TABLES), COMMERCE_PAYMENTS_LEDGER_TABLE]));
      const second = await migrateCommercePayments({ kernel });
      expect(second).toEqual({ applied: [], alreadyApplied: [PAYMENTS_LEDGER_ID, PAYMENTS_OPERATOR_ACTIONS_ID, PAYMENTS_ATTEMPT_RECOVERY_ID, LEGACY_LIPAY_IMPORT_ID], notes: [] });
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
