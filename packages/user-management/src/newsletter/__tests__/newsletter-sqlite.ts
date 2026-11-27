import { sql } from "kysely";

import { sqliteTestKernel, type TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import type { NewsletterSqlTables } from "../repo.rows.js";

/**
 * @file A real in-memory SQLite database carrying the newsletter tables (columns from `repo.rows.ts`), for
 * driving the SQL newsletter repositories end to end. The host owns the schema in production; this DDL only
 * mirrors the row types plus the primary keys the upserts conflict on.
 */
export const NEWSLETTER_TABLES: NewsletterSqlTables = {
  campaigns: "nl_campaigns", campaignRevisions: "nl_campaign_revisions", lists: "nl_lists",
  subscriptions: "nl_subscriptions", audienceSnapshots: "nl_snapshots", sends: "nl_sends",
  confirmationTokens: "nl_tokens",
};

const DDL = [
  `create table nl_campaigns (id text primary key, workspace_id text not null, status text not null, subject text not null,
    preheader text, from_name text not null, from_email text not null, reply_to text not null, list_id text not null,
    scheduled_at text, send_started_at text, audience_snapshot_id text, counters_json text not null, version integer not null,
    created_by_principal text not null, created_by_kind text not null default 'person', created_at text not null, updated_at text not null)`,
  `create table nl_campaign_revisions (seq integer primary key autoincrement, campaign_id text not null, workspace_id text not null,
    state_json text not null, actor_id text not null, recorded_at text not null)`,
  `create table nl_lists (id text primary key, workspace_id text not null, name text not null, slug text not null,
    is_default integer not null, status text not null, created_at text not null, updated_at text not null)`,
  `create table nl_subscriptions (id text primary key, workspace_id text not null, list_id text not null,
    subscriber_id text not null, status text not null, source text not null, consent_revision_id_at_subscribe text,
    subscribed_at text, unsubscribed_at text, created_at text not null, updated_at text not null)`,
  `create table nl_snapshots (id text primary key, workspace_id text not null, campaign_id text not null,
    list_id text not null, recipient_count integer not null, created_at text not null)`,
  `create table nl_sends (id text primary key, workspace_id text not null, campaign_id text not null,
    audience_snapshot_id text not null, subscriber_id text not null, recipient_email text not null, status text not null,
    attempts integer not null, idempotency_key text not null, provider_message_id text, last_error text,
    next_attempt_at text, created_at text not null, updated_at text not null)`,
  `create table nl_tokens (id text primary key, workspace_id text not null, subscription_id text not null,
    token_hash text not null, purpose text not null, created_at text not null, expires_at text not null, consumed_at text)`,
];

export async function newsletterDb(): Promise<TestSqliteKernel> {
  const db = sqliteTestKernel();
  for (const statement of DDL) await db.exec(statement);
  return db;
}

/** Raw rows of one query, for asserting what actually landed in the database. */
export async function selectRows(db: TestSqliteKernel, query: string): Promise<Array<Record<string, unknown>>> {
  return db.kernel.run(async (handle) => (await sql.raw<Record<string, unknown>>(query).execute(handle)).rows);
}
