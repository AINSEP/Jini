import type Database from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { activateLipay as createRuntime } from "../lipay-plugin.js";
/** Fixed test fixture only. Production schema ownership and recovery belong to the host.
 * The actual kernel, transactions, replay indexes and provider services remain real. */
export async function activateLipay(required: Omit<Parameters<typeof createRuntime>[0], "kernel" | "prepareStorage"> & { db: Database.Database; dbPath: string }) {
  return createRuntime({ ...required, kernel: sqliteKernel<unknown>(required.db), prepareStorage: async () => { required.db.exec(`
CREATE TABLE IF NOT EXISTS p_lipay__payments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, amount_refunded_minor INTEGER NOT NULL, provider_ref TEXT, reference TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS p_lipay__payments_idem ON p_lipay__payments (workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS p_lipay__payments_ref ON p_lipay__payments (provider_id, provider_ref);
CREATE INDEX IF NOT EXISTS p_lipay__payments_wsstatus ON p_lipay__payments (workspace_id, status, created_at);
CREATE TABLE IF NOT EXISTS p_lipay__events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, payment_id TEXT, kind TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, applied INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS p_lipay__events_dedupe ON p_lipay__events (provider_id, provider_event_id);
CREATE INDEX IF NOT EXISTS p_lipay__events_bypayment ON p_lipay__events (payment_id, occurred_at);
CREATE TABLE IF NOT EXISTS p_lipay__refunds (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payment_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, provider_ref TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS p_lipay__refunds_idem ON p_lipay__refunds (workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS p_lipay__refunds_bypayment ON p_lipay__refunds (payment_id);
`); } });
}
