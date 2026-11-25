import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { sqliteKernel } from "../../../kernel/sqlite/index.js";
import { openPgliteKernel } from "../../../kernel/pglite/index.js";
import type { KyselyKernel } from "../../../kernel/port.js";
import type { ChangeSetTables } from "../../change-set-repo.sql.js";

/** The host-owned table names used by the tests (the adapters have no default). */
export const TABLES: ChangeSetTables = { changeSets: "change_sets", changeSetItems: "change_set_items", outboxEvents: "outbox_events" };

/** DDL copied from the host schema's migrations (text keys, no foreign keys); the JSON columns differ per dialect as there. */
const DDL = {
  sqlite: [
    "CREATE TABLE change_set_items (id text PRIMARY KEY NOT NULL, change_set_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, operation text NOT NULL, before_revision_id text, after_revision_id text, inverse_payload_json text, entity_version_at_apply integer, position integer NOT NULL)",
    "CREATE TABLE change_sets (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, actor_id text, status text NOT NULL, summary text NOT NULL, idempotency_key text, intent_ref text, created_at text NOT NULL, applied_at text, reverted_at text)",
    "CREATE UNIQUE INDEX idx_change_sets_idempotency ON change_sets (workspace_id, idempotency_key)",
    "CREATE TABLE outbox_events (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, event_json text NOT NULL, status text NOT NULL, attempts integer DEFAULT 0 NOT NULL, next_attempt_at text NOT NULL, last_error text, created_at text NOT NULL)",
  ],
  postgres: [
    "CREATE TABLE change_set_items (id text PRIMARY KEY NOT NULL, change_set_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, operation text NOT NULL, before_revision_id text, after_revision_id text, inverse_payload_json jsonb, entity_version_at_apply bigint, position bigint NOT NULL)",
    "CREATE TABLE change_sets (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, actor_id text, status text NOT NULL, summary text NOT NULL, idempotency_key text, intent_ref text, created_at text NOT NULL, applied_at text, reverted_at text)",
    "CREATE UNIQUE INDEX idx_change_sets_idempotency ON change_sets (workspace_id, idempotency_key)",
    "CREATE TABLE outbox_events (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, event_json jsonb NOT NULL, status text NOT NULL, attempts bigint DEFAULT 0 NOT NULL, next_attempt_at text NOT NULL, last_error text, created_at text NOT NULL)",
  ],
} as const;

/** A fresh in-memory database of the dialect with the three tables applied. */
export async function openEventsKernel(
  { dialect }: { dialect: "sqlite" | "postgres" },
  { actorKindColumn = false }: { actorKindColumn?: boolean } = {},
): Promise<KyselyKernel<unknown>> {
  const kernel: KyselyKernel<unknown> = dialect === "sqlite" ? sqliteKernel<unknown>({ source: new Database(":memory:") }) : openPgliteKernel({ PGlite });
  for (const statement of DDL[dialect]) await kernel.execute(sql.raw(statement));
  // A host that has migrated adds the nullable provenance column; the default stays the legacy schema.
  if (actorKindColumn) await kernel.execute(sql.raw("ALTER TABLE change_sets ADD COLUMN actor_kind text"));
  return kernel;
}
