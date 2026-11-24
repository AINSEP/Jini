import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { WebhookTables } from "../../webhook-repo.js";

/** The host-owned table names used by the tests (the adapters have no default). */
export const TABLES: WebhookTables = { webhookSubscriptions: "webhook_subscriptions", webhookDeliveries: "webhook_deliveries" };

/**
 * DDL copied from the host schema's migrations (the first webhook migration, the legacy Postgres
 * baseline, and the optimistic-concurrency `version` column); JSON columns differ per dialect as there.
 */
const DDL = {
  sqlite: [
    "CREATE TABLE webhook_deliveries (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, subscription_id text NOT NULL, event_id text NOT NULL, topic text NOT NULL, payload_json text, status text NOT NULL, attempts integer NOT NULL, next_attempt_at text NOT NULL, last_response_status integer, last_error text, signed_with_version integer, created_at text NOT NULL, delivered_at text, dead_at text)",
    "CREATE UNIQUE INDEX idx_webhook_deliveries_workspace_sub_event ON webhook_deliveries (workspace_id, subscription_id, event_id)",
    "CREATE TABLE webhook_subscriptions (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, owner_principal_id text NOT NULL, label text NOT NULL, target_url text NOT NULL, topics_json text NOT NULL, secret_version integer NOT NULL, previous_secret_version integer, status text NOT NULL, created_by_principal_id text NOT NULL, created_by_plugin_id text, created_by_kind text, created_at text NOT NULL, updated_at text NOT NULL, disabled_at text)",
    "ALTER TABLE webhook_subscriptions ADD COLUMN version integer NOT NULL DEFAULT 1",
  ],
  postgres: [
    "CREATE TABLE webhook_deliveries (id text NOT NULL, workspace_id text NOT NULL, subscription_id text NOT NULL, event_id text NOT NULL, topic text NOT NULL, payload_json jsonb, status text NOT NULL, attempts bigint NOT NULL, next_attempt_at text NOT NULL, last_response_status bigint, last_error text, signed_with_version bigint, created_at text NOT NULL, delivered_at text, dead_at text, PRIMARY KEY (id))",
    "CREATE UNIQUE INDEX idx_webhook_deliveries_workspace_sub_event ON webhook_deliveries (workspace_id, subscription_id, event_id)",
    "CREATE TABLE webhook_subscriptions (id text NOT NULL, workspace_id text NOT NULL, owner_principal_id text NOT NULL, label text NOT NULL, target_url text NOT NULL, topics_json jsonb NOT NULL, secret_version bigint NOT NULL, previous_secret_version bigint, status text NOT NULL, created_by_principal_id text NOT NULL, created_by_plugin_id text, created_by_kind text, created_at text NOT NULL, updated_at text NOT NULL, disabled_at text, PRIMARY KEY (id))",
    "ALTER TABLE webhook_subscriptions ADD COLUMN version integer NOT NULL DEFAULT 1",
  ],
} as const;

/** A fresh in-memory database of the dialect with the two webhook tables applied. */
export async function openWebhookKernel({ dialect }: { dialect: "sqlite" | "postgres" }, _optional: Record<string, never> = {}): Promise<KyselyKernel<unknown>> {
  const kernel: KyselyKernel<unknown> = dialect === "sqlite" ? sqliteKernel<unknown>({ source: new Database(":memory:") }) : openPgliteKernel({ PGlite });
  for (const statement of DDL[dialect]) await kernel.execute(sql.raw(statement));
  return kernel;
}
