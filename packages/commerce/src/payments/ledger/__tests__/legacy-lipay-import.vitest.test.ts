import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import Database from "better-sqlite3";
import { sql } from "kysely";
import { describe, expect, test } from "vitest";

import type { StorageKernel } from "@jini-ai/db/kernel";
import { openPostgresKernel } from "@jini-ai/db/kernel/postgres";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { runMigrations } from "@jini-ai/db/migrate";
import { paymentsLedger } from "../migrations/0001_payments_ledger.js";
import { paymentsOperatorActions } from "../migrations/0002_payments_operator_actions.js";
import { paymentsAttemptRecovery } from "../migrations/0004_payments_attempt_recovery.js";
import {
  LEGACY_LIPAY_IMPORT_ID,
  legacyLipayImport,
  readLegacyLipayHistory,
  type LegacyLipayMapping,
} from "../migrations/0005_legacy_lipay_import.js";
import { LEDGER_TABLES } from "../rows.js";

/**
 * @file Step `0005_legacy_lipay_import` (review R2-F7) against a fixture of the retired lipay
 * runtime's `p_lipay__*` rows: absent/empty legacy tables are a no-op, rows without a mapping fail
 * the step (and roll back), the import keeps ids, idempotency keys, refund holds and event dedupe
 * keys with the host's explicit site/account/mode, a rerun or a pre-existing ledger row is left
 * alone, the legacy tables are never touched, and the compat read path serves what the kernel
 * schema cannot hold. One suite on SQLite; on Postgres when `COMMERCE_PG_URL` is set.
 */

type Kernel = StorageKernel<unknown>;

const LEDGER = "commerce_payments_migrations_legacy_test";

/** The legacy columns exactly as lipay's data module declared them (TEXT / INTEGER). */
const LEGACY_DDL = {
  p_lipay__payments: `id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, amount_refunded_minor INTEGER NOT NULL,
    provider_ref TEXT, reference TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT`,
  p_lipay__refunds: `id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payment_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    provider_ref TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL`,
  p_lipay__events: `id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL,
    payment_id TEXT, kind TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, applied INTEGER NOT NULL,
    payload TEXT NOT NULL`,
} as const;
type LegacyTable = keyof typeof LEGACY_DDL;

const pay = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: "ws-1", provider_id: "lipay", idempotency_key: `key-${id}`, status, amount_minor: 1000, currency: "USD",
  amount_refunded_minor: 0, provider_ref: `ch_${id}`, reference: `order-${id}`, created_at: 100, updated_at: 200, last_error: null, ...over,
});
const refund = (id: string, paymentId: string, status: string, amount: number, over: Record<string, unknown> = {}) => ({
  id, workspace_id: "ws-1", payment_id: paymentId, idempotency_key: `rkey-${id}`, provider_ref: `re_${id}`, amount_minor: amount,
  currency: "USD", status, reason: "asked", created_at: 300, updated_at: 400, ...over,
});
const event = (id: string, paymentId: string | null, applied: 0 | 1) => ({
  id, workspace_id: "ws-1", provider_id: "lipay", provider_event_id: `evt_${id}`, payment_id: paymentId, kind: "succeeded",
  occurred_at: 500, received_at: 600, applied, payload: `{"id":"evt_${id}"}`,
});

const FIXTURE = {
  p_lipay__payments: [
    pay("a", "partially_refunded", { amount_refunded_minor: 400 }),
    pay("b", "pending", { reference: null, provider_ref: null }),
    pay("c", "failed", { last_error: "DECLINED: card declined" }),
    pay("d", "requires_operator"),
    pay("e", "refunded", { amount_refunded_minor: 1000 }),
    pay("f", "canceled"),
    pay("g", "succeeded", { provider_id: "stripe" }),
  ],
  p_lipay__refunds: [
    refund("1", "a", "succeeded", 400),
    refund("2", "a", "pending", 300),
    refund("3", "a", "failed", 100),
    refund("4", "a", "lost", 50, { reason: null, provider_ref: null }),
    refund("5", "missing", "pending", 10),
    refund("6", "a", "pending", 10, { workspace_id: "ws-2" }),
    refund("7", "e", "succeeded", 1000),
  ],
  p_lipay__events: [event("1", "a", 1), event("2", null, 0)],
};

const MAPPING: LegacyLipayMapping = ({ workspaceId, providerId }) =>
  workspaceId === "ws-1" ? { siteId: "site-1", providerAccountId: `acct_${providerId}`, mode: "live" } : null;

async function createLegacy(kernel: Kernel, tables: readonly LegacyTable[], rows: Partial<typeof FIXTURE> = FIXTURE): Promise<void> {
  for (const table of tables) {
    await kernel.execute(sql.raw(`CREATE TABLE ${table} (${LEGACY_DDL[table]})`));
    for (const row of rows[table] ?? []) {
      await kernel.run((db) => (db as never as import("kysely").Kysely<Record<string, Record<string, unknown>>>).insertInto(table).values(row).execute());
    }
  }
}

const select = async (kernel: Kernel, query: string): Promise<Record<string, unknown>[]> =>
  (await kernel.query(sql.raw<Record<string, unknown>>(query))).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" || /^\d+$/.test(String(value)) && key !== "id" && typeof value === "string" ? Number(value) : value]))
  );
const count = async (kernel: Kernel, table: string): Promise<number> => Number((await select(kernel, `SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);

/** The ledger history up to (not including) step 5, then step 5 with `mapping`. */
const checksum = (n: number) => String(n).repeat(64);
const steps = (mapping?: LegacyLipayMapping) => [
  paymentsLedger({ checksum: checksum(1) }),
  paymentsOperatorActions({ checksum: checksum(2) }),
  paymentsAttemptRecovery({ checksum: checksum(4) }),
  legacyLipayImport({ checksum: checksum(5) }, mapping === undefined ? {} : { mapping }),
];
const migrate = (kernel: Kernel, mapping?: LegacyLipayMapping) => runMigrations(kernel, steps(mapping), { ledgerTable: LEDGER });

function legacyImportSuite(name: string, open: () => Promise<Kernel>): void {
  describe(`legacy lipay import: ${name}`, () => {
    test("no legacy tables: the step applies and imports nothing", async () => {
      const kernel = await open();
      const report = await migrate(kernel);
      expect(report.applied).toContain(LEGACY_LIPAY_IMPORT_ID);
      expect(await count(kernel, "commerce_payments")).toBe(0);
      expect(await readLegacyLipayHistory({ kernel, workspaceId: "ws-1", paymentId: "a" })).toBeNull();
    });

    test("empty legacy tables need no mapping", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__refunds", "p_lipay__events"], {});
      await migrate(kernel);
      expect(await count(kernel, "commerce_payments")).toBe(0);
    });

    test("legacy rows without a mapping fail the step, roll it back and leave the legacy rows", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments"]);
      await expect(migrate(kernel)).rejects.toThrow(/p_lipay__payments holds 7 row\(s\); pass `legacyLipay`/);
      expect(await count(kernel, "commerce_payments")).toBe(0);
      expect(await count(kernel, "p_lipay__payments")).toBe(7);
    });

    test("a row the mapping declines fails the step", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments"]);
      await expect(migrate(kernel, () => null)).rejects.toThrow(/no legacy lipay mapping for workspace 'ws-1' provider 'lipay'/);
      expect(await count(kernel, "commerce_payments")).toBe(0);
    });

    test("imports payments with the mapped scope, mapped statuses, captured amounts and refund holds", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__refunds", "p_lipay__events"]);
      await migrate(kernel, MAPPING);
      const rows = await select(kernel, `SELECT id, workspace_id, site_id, provider_id, provider_account_id, mode, idempotency_key, reference,
        amount_minor, captured_minor, intent_status, status, refunded_minor, refund_held_minor, disputed_minor, provider_ref, version,
        created_at, updated_at FROM commerce_payments ORDER BY id`);
      const scope = { workspace_id: "ws-1", site_id: "site-1", provider_account_id: "acct_lipay", mode: "live", disputed_minor: 0, version: 1, created_at: 100, updated_at: 200, amount_minor: 1000 };
      expect(rows).toEqual([
        // Held: refund 2 (pending, 300) + refund 4 (unrecognised -> unknown, 50); refund 6 is another workspace's.
        { ...scope, id: "a", provider_id: "lipay", idempotency_key: "key-a", reference: "order-a", captured_minor: 1000, intent_status: "succeeded", status: "partially_refunded", refunded_minor: 400, refund_held_minor: 350, provider_ref: "ch_a" },
        { ...scope, id: "b", provider_id: "lipay", idempotency_key: "key-b", reference: "", captured_minor: 0, intent_status: "pending", status: "pending", refunded_minor: 0, refund_held_minor: 0, provider_ref: null },
        { ...scope, id: "c", provider_id: "lipay", idempotency_key: "key-c", reference: "order-c", captured_minor: 0, intent_status: "failed", status: "failed", refunded_minor: 0, refund_held_minor: 0, provider_ref: "ch_c" },
        { ...scope, id: "d", provider_id: "lipay", idempotency_key: "key-d", reference: "order-d", captured_minor: 0, intent_status: "unknown", status: "unknown", refunded_minor: 0, refund_held_minor: 0, provider_ref: "ch_d" },
        { ...scope, id: "e", provider_id: "lipay", idempotency_key: "key-e", reference: "order-e", captured_minor: 1000, intent_status: "succeeded", status: "refunded", refunded_minor: 1000, refund_held_minor: 0, provider_ref: "ch_e" },
        { ...scope, id: "f", provider_id: "lipay", idempotency_key: "key-f", reference: "order-f", captured_minor: 0, intent_status: "canceled", status: "canceled", refunded_minor: 0, refund_held_minor: 0, provider_ref: "ch_f" },
        { ...scope, id: "g", provider_id: "stripe", provider_account_id: "acct_stripe", idempotency_key: "key-g", reference: "order-g", captured_minor: 1000, intent_status: "succeeded", status: "succeeded", refunded_minor: 0, refund_held_minor: 0, provider_ref: "ch_g" },
      ]);
    });

    test("imports refunds under their payment's scope; orphans and cross-workspace rows stay legacy-only", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__refunds"]);
      await migrate(kernel, MAPPING);
      const rows = await select(kernel, `SELECT id, payment_id, workspace_id, site_id, provider_id, provider_account_id, mode, idempotency_key,
        provider_refund_ref, currency, amount_minor, status, reason, created_at, updated_at FROM commerce_refunds ORDER BY id`);
      const base = { payment_id: "a", workspace_id: "ws-1", site_id: "site-1", provider_id: "lipay", provider_account_id: "acct_lipay", mode: "live", currency: "USD", created_at: 300, updated_at: 400 };
      expect(rows).toEqual([
        { ...base, id: "1", idempotency_key: "rkey-1", provider_refund_ref: "re_1", amount_minor: 400, status: "succeeded", reason: "asked" },
        { ...base, id: "2", idempotency_key: "rkey-2", provider_refund_ref: "re_2", amount_minor: 300, status: "pending", reason: "asked" },
        { ...base, id: "3", idempotency_key: "rkey-3", provider_refund_ref: "re_3", amount_minor: 100, status: "failed", reason: "asked" },
        { ...base, id: "4", idempotency_key: "rkey-4", provider_refund_ref: null, amount_minor: 50, status: "unknown", reason: null },
        { ...base, id: "7", payment_id: "e", idempotency_key: "rkey-7", provider_refund_ref: "re_7", amount_minor: 1000, status: "succeeded", reason: "asked" },
      ]);
      // No events table: the inbox stays empty.
      expect(await count(kernel, "commerce_webhook_inbox")).toBe(0);
    });

    test("imports events as terminal inbox rows that keep the provider event dedupe key", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__events"]);
      await migrate(kernel, MAPPING);
      const rows = await select(kernel, `SELECT id, workspace_id, site_id, provider_id, provider_account_id, mode, provider_event_id, facts_json,
        body_sha256, state, attempts, next_attempt_at, last_error, received_at, applied_at, purged_at FROM commerce_webhook_inbox ORDER BY id`);
      const base = { workspace_id: "ws-1", site_id: "site-1", provider_id: "lipay", provider_account_id: "acct_lipay", mode: "live", facts_json: null, attempts: 0, next_attempt_at: 600, received_at: 600, purged_at: null };
      const sha = (body: string) => createHash("sha256").update(body).digest("hex");
      expect(rows).toEqual([
        { ...base, id: "1", provider_event_id: "evt_1", body_sha256: sha('{"id":"evt_1"}'), state: "applied", last_error: null, applied_at: 600 },
        { ...base, id: "2", provider_event_id: "evt_2", body_sha256: sha('{"id":"evt_2"}'), state: "dead", last_error: "legacy lipay event: recorded, never applied", applied_at: null },
      ]);
      // No refunds table: nothing is held.
      expect((await select(kernel, "SELECT refund_held_minor FROM commerce_payments WHERE id = 'a'"))[0]?.refund_held_minor).toBe(0);
    });

    test("rerunning the step, or a ledger row already holding a key, changes nothing; legacy tables are untouched", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__refunds", "p_lipay__events"]);
      await runMigrations(kernel, steps().slice(0, 3), { ledgerTable: LEDGER });
      // A payment the new runtime already took with legacy payment b's idempotency key.
      await kernel.execute(sql.raw(`INSERT INTO commerce_payments (id, workspace_id, site_id, provider_id, provider_account_id, mode,
        idempotency_key, reference, currency, amount_minor, captured_minor, intent_status, refunded_minor, refund_held_minor, disputed_minor,
        status, version, created_at, updated_at) VALUES ('new-1', 'ws-1', 'site-1', 'lipay', 'acct_lipay', 'live', 'key-b', 'r', 'USD', 1, 0,
        'pending', 0, 0, 0, 'pending', 1, 1, 1)`));
      await migrate(kernel, MAPPING);
      const before = [await count(kernel, "commerce_payments"), await count(kernel, "commerce_refunds"), await count(kernel, "commerce_webhook_inbox")];
      expect(before).toEqual([7, 5, 2]);
      expect((await select(kernel, "SELECT id FROM commerce_payments WHERE idempotency_key = 'key-b'")).map((row) => row.id)).toEqual(["new-1"]);

      await legacyLipayImport({ checksum: checksum(5) }, { mapping: MAPPING }).up(kernel);
      expect([await count(kernel, "commerce_payments"), await count(kernel, "commerce_refunds"), await count(kernel, "commerce_webhook_inbox")]).toEqual(before);
      expect([await count(kernel, "p_lipay__payments"), await count(kernel, "p_lipay__refunds"), await count(kernel, "p_lipay__events")]).toEqual([7, 7, 2]);
    });

    test("the compat read path serves last_error and the verbatim event history", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments", "p_lipay__events"]);
      expect(await readLegacyLipayHistory({ kernel, workspaceId: "ws-1", paymentId: "c" })).toEqual({ lastError: "DECLINED: card declined", events: [] });
      expect(await readLegacyLipayHistory({ kernel, workspaceId: "ws-1", paymentId: "a" })).toEqual({
        lastError: null,
        events: [{ id: "1", providerEventId: "evt_1", kind: "succeeded", occurredAt: 500, receivedAt: 600, applied: true, payload: '{"id":"evt_1"}' }],
      });
      expect(await readLegacyLipayHistory({ kernel, workspaceId: "ws-2", paymentId: "a" })).toBeNull();
    });

    test("the compat read path without an events table returns no events", async () => {
      const kernel = await open();
      await createLegacy(kernel, ["p_lipay__payments"]);
      expect(await readLegacyLipayHistory({ kernel, workspaceId: "ws-1", paymentId: "c" })).toEqual({ lastError: "DECLINED: card declined", events: [] });
    });
  });
}

const openSqlite = async (): Promise<Kernel> => openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });

legacyImportSuite("sqlite", openSqlite);

describe("migrateCommercePayments: the legacyLipay option", () => {
  test("binds the host mapping into step 5, under the pinned checksum", async () => {
    const { COMMERCE_PAYMENTS_MIGRATIONS, migrateCommercePayments } = await import("../migrations/index.js");
    const kernel = await openSqlite();
    await createLegacy(kernel, ["p_lipay__payments"]);
    const report = await migrateCommercePayments({ kernel }, { legacyLipay: MAPPING });
    expect(report.applied).toEqual(COMMERCE_PAYMENTS_MIGRATIONS.map((step) => step.id));
    expect(await count(kernel, "commerce_payments")).toBe(7);
  });

  test("without it, legacy rows stop the history at step 5", async () => {
    const { migrateCommercePayments } = await import("../migrations/index.js");
    const kernel = await openSqlite();
    await createLegacy(kernel, ["p_lipay__payments"]);
    await expect(migrateCommercePayments({ kernel })).rejects.toThrow(/pass `legacyLipay`/);
  });
});

const url = process.env.COMMERCE_PG_URL;
if (url === undefined || url === "") {
  describe.skip("legacy lipay import: postgres (set COMMERCE_PG_URL)", () => {
    test("skipped", () => {});
  });
} else {
  const pg = createRequire(path.resolve(import.meta.dirname, "../../../../node_modules/@jini-ai/db/package.json"))("pg");
  legacyImportSuite("postgres", async () => {
    const kernel = openPostgresKernel<unknown>({ pg, connectionString: url }, { max: 4 });
    const tables = [...Object.values(LEDGER_TABLES), "commerce_operator_actions", LEDGER, ...Object.keys(LEGACY_DDL)].join(", ");
    await kernel.execute(sql.raw(`DROP TABLE IF EXISTS ${tables} CASCADE`));
    return kernel;
  });
}
