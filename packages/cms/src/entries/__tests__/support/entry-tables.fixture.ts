import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import { type ContentKernel, jsonScalarEquals, jsonSortKey } from "../../../core/__tests__/support/dialect-matrix.js";
import type { EntryJsonDialectPort, EntryTables } from "../../sql/index.js";

/** The table names the dialect tests pass in: the adapter has no defaults, so the fixture names them. */
export const ENTRY_TABLES: EntryTables = { entries: "entries", revisions: "entry_revisions" };

/** The JSON dialect port a host binds from the SAME kernel it passes to the repository. */
export function jsonPortFor(kernel: ContentKernel): EntryJsonDialectPort {
  return {
    scalarEquals: ({ column, path, value }) => jsonScalarEquals(kernel.dialect, column, path, value),
    sortKey: ({ column, path }) => jsonSortKey(kernel.dialect, column, path),
  };
}

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0010_fixed_marauders.sql:27-56 (the two tables, the unique
 * and lookup indexes) plus 0072_entries_submissions_trashed_items_trash.sql:1 (`deleted_at`). The Postgres form is the
 * same column set with `bigserial` for the database-assigned `seq` and `integer` for `version`.
 */
const sqliteStatements = [
  "CREATE TABLE `entries` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`type` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`status` text NOT NULL,\n\t`title` text NOT NULL,\n\t`body_json` text,\n\t`fields_json` text NOT NULL,\n\t`published_at` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`version` integer NOT NULL\n)",
  "ALTER TABLE `entries` ADD `deleted_at` text",
  "CREATE UNIQUE INDEX `entries_workspace_type_slug_unique` ON `entries` (`workspace_id`,`type`,`slug`)",
  "CREATE INDEX `idx_entries_workspace` ON `entries` (`workspace_id`,`type`)",
  "CREATE TABLE `entry_revisions` (\n\t`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`entry_id` text NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`op` text NOT NULL,\n\t`state_json` text NOT NULL,\n\t`actor_id` text NOT NULL,\n\t`delegated_by_workspace_id` text,\n\t`delegated_by_id` text,\n\t`recorded_at` text NOT NULL\n)",
  "CREATE INDEX `idx_entry_revisions_workspace_entry` ON `entry_revisions` (`workspace_id`,`entry_id`,`seq`)",
];

const postgresStatements = [
  'CREATE TABLE "entries" ("id" text PRIMARY KEY NOT NULL, "workspace_id" text NOT NULL, "type" text NOT NULL, "slug" text NOT NULL, "status" text NOT NULL, "title" text NOT NULL, "body_json" text, "fields_json" text NOT NULL, "published_at" text, "created_at" text NOT NULL, "updated_at" text NOT NULL, "version" integer NOT NULL, "deleted_at" text);',
  'CREATE UNIQUE INDEX "entries_workspace_type_slug_unique" ON "entries" ("workspace_id", "type", "slug");',
  'CREATE INDEX "idx_entries_workspace" ON "entries" ("workspace_id", "type");',
  'CREATE TABLE "entry_revisions" ("seq" bigserial PRIMARY KEY, "entry_id" text NOT NULL, "workspace_id" text NOT NULL, "op" text NOT NULL, "state_json" text NOT NULL, "actor_id" text NOT NULL, "delegated_by_workspace_id" text, "delegated_by_id" text, "recorded_at" text NOT NULL);',
  'CREATE INDEX "idx_entry_revisions_workspace_entry" ON "entry_revisions" ("workspace_id", "entry_id", "seq");',
];

/** Apply the two entry tables and their indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
