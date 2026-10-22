import { sql } from "kysely";
import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0004_known_silver_surfer.sql:8-43
 * and platform/db/migrations/0000_legacy_baseline.postgres.ts:58-59,156-158.
 * No later SQLite migration changes these tables. Hits remain in-memory; no hit table is used.
 */
const sqliteStatements = [
  "CREATE TABLE `redirect_revisions` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`redirect_id` text NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`seq` integer NOT NULL,\n\t`state_json` text NOT NULL,\n\t`tombstoned` integer NOT NULL,\n\t`actor_id` text NOT NULL,\n\t`plugin_id` text,\n\t`recorded_at` text NOT NULL\n)",
  "CREATE UNIQUE INDEX `idx_redirect_revisions_redirect_seq` ON `redirect_revisions` (`redirect_id`,`seq`)",
  "CREATE TABLE `redirects` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`match_type` text NOT NULL,\n\t`from_pattern` text NOT NULL,\n\t`to_target` text NOT NULL,\n\t`status_code` integer NOT NULL,\n\t`status` text NOT NULL,\n\t`override` integer NOT NULL,\n\t`priority` integer NOT NULL,\n\t`source` text NOT NULL,\n\t`source_entry_id` text,\n\t`from_path_at_capture` text,\n\t`to_path_at_capture` text,\n\t`created_by_principal` text NOT NULL,\n\t`created_by_plugin_id` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`version` integer NOT NULL\n)",
  "CREATE INDEX `idx_redirects_workspace_frompattern` ON `redirects` (`workspace_id`,`from_pattern`)",
  "CREATE INDEX `idx_redirects_workspace_status` ON `redirects` (`workspace_id`,`status`)"
];

const postgresStatements = [
  "CREATE TABLE \"oauth_pending_authorizations\" (\"state\" text NOT NULL, \"owner_key\" text NOT NULL, \"provider_id\" text NOT NULL, \"sealed_key_id\" text NOT NULL, \"sealed_ciphertext\" text NOT NULL, \"sealed_nonce\" text NOT NULL, \"sealed_alg\" text NOT NULL, \"redirect_uri\" text NOT NULL, \"scopes_json\" jsonb NOT NULL, \"created_at\" text NOT NULL, \"expires_at\" text NOT NULL, PRIMARY KEY (\"state\"));",
  "CREATE TABLE \"origin_settings\" (\"workspace_id\" text NOT NULL, \"scheme\" text NOT NULL, \"host\" text NOT NULL, \"port\" bigint, \"base_path\" text, \"verified_at\" text NOT NULL, \"source\" text NOT NULL, \"redirect_allowlist_json\" jsonb DEFAULT '[]' NOT NULL, \"egress_allowlist_json\" jsonb DEFAULT '[]' NOT NULL, PRIMARY KEY (\"workspace_id\"));",
  "CREATE TABLE \"redirect_revisions\" (\"id\" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, \"redirect_id\" text NOT NULL, \"workspace_id\" text NOT NULL, \"seq\" bigint NOT NULL, \"state_json\" jsonb NOT NULL, \"tombstoned\" bigint NOT NULL, \"actor_id\" text NOT NULL, \"plugin_id\" text, \"recorded_at\" text NOT NULL, PRIMARY KEY (\"id\"));",
  "CREATE TABLE \"redirects\" (\"id\" text NOT NULL, \"workspace_id\" text NOT NULL, \"match_type\" text NOT NULL, \"from_pattern\" text NOT NULL, \"to_target\" text NOT NULL, \"status_code\" bigint NOT NULL, \"status\" text NOT NULL, \"override\" bigint NOT NULL, \"priority\" bigint NOT NULL, \"source\" text NOT NULL, \"source_entry_id\" text, \"from_path_at_capture\" text, \"to_path_at_capture\" text, \"created_by_principal\" text NOT NULL, \"created_by_plugin_id\" text, \"created_at\" text NOT NULL, \"updated_at\" text NOT NULL, \"version\" bigint NOT NULL, PRIMARY KEY (\"id\"));",
  "CREATE UNIQUE INDEX \"idx_redirect_revisions_redirect_seq\" ON \"redirect_revisions\" (\"redirect_id\", \"seq\");",
  "CREATE INDEX \"idx_redirects_workspace_frompattern\" ON \"redirects\" (\"workspace_id\", \"from_pattern\");",
  "CREATE INDEX \"idx_redirects_workspace_status\" ON \"redirects\" (\"workspace_id\", \"status\");"
];

/** Apply the current two redirect tables and their indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables<DB>(kernel: StorageKernel<DB>, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
