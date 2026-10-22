import { sql } from "kysely";
import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";

/** Current forms schema copied from Tovu (no Tovu migration or composition imports):
 * SQLite: apps/website/src/platform/db/drizzle/0005_little_diamondback.sql:1-26;
 * additive Trash columns: 0071_form_definitions_trash.sql:1-2 and
 * 0072_entries_submissions_trashed_items_trash.sql:2-3; nullable IP: migrations/0006_submission_ip_retention.ts:37-46.
 * Postgres: migrations/0000_legacy_baseline.postgres.ts:24-25,121-124,201;
 * nullable IP and partial index: migrations/0006_submission_ip_retention.ts:59-63.
 * Names are fixture data; production SQL always receives them from the host. */
export const tables = { definitions: "form_definitions", submissions: "form_submissions" };

const sqliteStatements: readonly string[] = [
  "CREATE TABLE `form_definitions` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`fields_json` text NOT NULL,\n\t`notify_json` text NOT NULL,\n\t`status` text DEFAULT 'active' NOT NULL,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`deleted_at` text,\n\t`version` integer DEFAULT 1 NOT NULL\n);",
  "CREATE UNIQUE INDEX `form_definitions_workspace_slug_unique` ON `form_definitions` (`workspace_id`,`slug`);",
  "CREATE INDEX `idx_form_definitions_workspace` ON `form_definitions` (`workspace_id`);",
  "CREATE TABLE `form_submissions` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`form_definition_id` text NOT NULL,\n\t`data_json` text NOT NULL,\n\t`source_ip` text,\n\t`submitted_at` text NOT NULL,\n\t`deleted_at` text,\n\t`version` integer DEFAULT 1 NOT NULL,\n\tFOREIGN KEY (`form_definition_id`) REFERENCES `form_definitions`(`id`) ON UPDATE no action ON DELETE restrict\n);",
  "CREATE INDEX `idx_form_submissions_definition` ON `form_submissions` (`form_definition_id`,`submitted_at`);",
  "CREATE INDEX `idx_form_submissions_workspace` ON `form_submissions` (`workspace_id`);",
  "CREATE INDEX IF NOT EXISTS idx_form_submissions_ip_retention\nON form_submissions(submitted_at, id) WHERE source_ip IS NOT NULL;"
];

const postgresStatements: readonly string[] = [
  "CREATE TABLE \"form_definitions\" (\"id\" text NOT NULL, \"workspace_id\" text NOT NULL, \"name\" text NOT NULL, \"slug\" text NOT NULL, \"fields_json\" jsonb NOT NULL, \"notify_json\" jsonb NOT NULL, \"status\" text DEFAULT 'active' NOT NULL, \"created_at\" text NOT NULL, \"updated_at\" text NOT NULL, \"deleted_at\" text, \"version\" bigint DEFAULT 1 NOT NULL, PRIMARY KEY (\"id\"));",
  "CREATE TABLE \"form_submissions\" (\"id\" text NOT NULL, \"workspace_id\" text NOT NULL, \"form_definition_id\" text NOT NULL, \"data_json\" jsonb NOT NULL, \"source_ip\" text NOT NULL, \"submitted_at\" text NOT NULL, \"deleted_at\" text, \"version\" bigint DEFAULT 1 NOT NULL, PRIMARY KEY (\"id\"));",
  "CREATE UNIQUE INDEX \"form_definitions_workspace_slug_unique\" ON \"form_definitions\" (\"workspace_id\", \"slug\");",
  "CREATE INDEX \"idx_form_definitions_workspace\" ON \"form_definitions\" (\"workspace_id\");",
  "CREATE INDEX \"idx_form_submissions_definition\" ON \"form_submissions\" (\"form_definition_id\", \"submitted_at\");",
  "CREATE INDEX \"idx_form_submissions_workspace\" ON \"form_submissions\" (\"workspace_id\");",
  "ALTER TABLE \"form_submissions\" ADD CONSTRAINT \"form_submissions_form_definition_id_form_definitions_id_fk\" FOREIGN KEY (\"form_definition_id\") REFERENCES \"form_definitions\" (\"id\") ON DELETE RESTRICT ON UPDATE NO ACTION;",
  "ALTER TABLE form_submissions ALTER COLUMN source_ip DROP NOT NULL;",
  "CREATE INDEX IF NOT EXISTS idx_form_submissions_ip_retention\nON form_submissions(submitted_at, id) WHERE source_ip IS NOT NULL;"
];

/** Apply this domain's current DDL to the p1 embedded-dialect matrix.
 * @complexity O(s) statements plus database DDL cost, for fixed statement count s. */
export async function createTables<DB>(
  kernel: StorageKernel<DB>,
  dialect: StorageDialect,
): Promise<void> {
  for (const statement of dialect === "sqlite" ? sqliteStatements : postgresStatements) {
    await kernel.execute(sql.raw(statement));
  }
}
