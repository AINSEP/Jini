import { sql } from "kysely";

import { sqliteTestKernel, type TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import type { KeepStoredRevocationPort, MemberTables } from "../repo.js";

/**
 * @file A real in-memory SQLite database carrying the members tables (columns from `repo.rows.ts`), for
 * driving the SQL member repositories end to end. The host owns the schema in production; this DDL only
 * mirrors the row interfaces plus the primary keys the upserts conflict on.
 */
export const MEMBER_TABLES: MemberTables = {
  members: "members", memberTiers: "member_tiers", memberSubscriptions: "member_subscriptions",
  memberSessions: "member_sessions", memberMagicTokens: "member_magic_tokens", memberConsents: "member_consents",
  memberRevisions: "member_revisions", memberExternalIdentities: "member_external_identities",
};

const DDL = [
  `create table members (id text primary key, workspace_id text not null, email text not null, name text,
    email_verified_at text, credentials_revoked_at text, password_hash text, status text not null, note text,
    fields_json text, created_at text not null, updated_at text not null, version integer not null)`,
  `create table member_tiers (id text primary key, workspace_id text not null, name text not null, slug text not null,
    type text not null, status text not null, description text, welcome_page_path text,
    visible_in_portal integer not null default 0, monthly_price_cents integer, yearly_price_cents integer,
    currency text, created_at text not null, updated_at text not null, version integer not null)`,
  `create table member_subscriptions (id text primary key, workspace_id text not null, member_id text not null,
    tier_id text not null, status text not null, source text not null, external_ref text, started_at text not null,
    current_period_end text, canceled_at text, created_at text not null, updated_at text not null, version integer not null)`,
  `create table member_sessions (id text primary key, workspace_id text not null, member_id text not null,
    token_hash text not null, created_at text not null, expires_at text not null, revoked_at text,
    last_seen_at text, user_agent text, ip text)`,
  `create table member_magic_tokens (id text primary key, workspace_id text not null, member_id text not null,
    email text, token_hash text not null, code_hash text, failed_attempts integer not null default 0,
    purpose text not null, created_at text not null, expires_at text not null, consumed_at text)`,
  `create table member_consents (id text primary key, workspace_id text not null, member_id text not null,
    purpose text not null, status text not null, evidence_json text not null, granted_at text, revoked_at text,
    created_at text not null, updated_at text not null, version integer not null)`,
  `create table member_revisions (seq integer primary key autoincrement, entity_kind text not null,
    entity_id text not null, workspace_id text not null, member_id text not null, purpose text, op text not null,
    before_json text, after_json text, origin_module text, created_at text not null)`,
  `create table member_external_identities (id text primary key, workspace_id text not null, member_id text not null,
    provider_id text not null, issuer text not null, subject text not null, linked_at text not null, unlinked_at text)`,
];

/** SQLite form of the host's one-way revocation rule: a stored revocation survives any re-save. */
export const keepStoredRevocation: KeepStoredRevocationPort = ({ table }) =>
  sql<string | null>`coalesce(${sql.ref(`${table}.revoked_at`)}, excluded.revoked_at)`;

export async function membersDb(): Promise<TestSqliteKernel> {
  const db = sqliteTestKernel();
  for (const statement of DDL) await db.exec(statement);
  return db;
}
