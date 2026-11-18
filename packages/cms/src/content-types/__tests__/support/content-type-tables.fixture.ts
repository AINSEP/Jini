import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import type { ContentKernel } from "../../../core/__tests__/support/dialect-matrix.js";
import type { ContentTypeTables } from "../../sql/index.js";

/** The table names the dialect tests pass in: the adapter has no defaults, so the fixture names them. */
export const CONTENT_TYPE_TABLES: ContentTypeTables = { contentTypes: "content_types", revisions: "content_type_revisions" };

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0010_fixed_marauders.sql:1-26 (the two tables, the unique
 * and lookup indexes) plus 0019_small_namor.sql:1 (`principal_kind`). The Postgres form is the same column set with
 * `bigserial` for the database-assigned `seq` and `integer` for `version`, so it reads back as a number.
 */
const sqliteStatements = [
  "CREATE TABLE `content_type_revisions` (\n\t`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`content_type_key` text NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`op` text NOT NULL,\n\t`state_json` text NOT NULL,\n\t`actor_id` text NOT NULL,\n\t`delegated_by_workspace_id` text,\n\t`delegated_by_id` text,\n\t`recorded_at` text NOT NULL\n)",
  "ALTER TABLE `content_type_revisions` ADD `principal_kind` text",
  "CREATE INDEX `idx_content_type_revisions_workspace_key` ON `content_type_revisions` (`workspace_id`,`content_type_key`,`seq`)",
  "CREATE TABLE `content_types` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`key` text NOT NULL,\n\t`label` text NOT NULL,\n\t`fields_json` text NOT NULL,\n\t`status` text NOT NULL,\n\t`version` integer NOT NULL,\n\t`tombstoned_at` text\n)",
  "CREATE UNIQUE INDEX `content_types_workspace_key_unique` ON `content_types` (`workspace_id`,`key`)",
  "CREATE INDEX `idx_content_types_workspace` ON `content_types` (`workspace_id`)",
];

const postgresStatements = [
  'CREATE TABLE "content_type_revisions" ("seq" bigserial PRIMARY KEY, "content_type_key" text NOT NULL, "workspace_id" text NOT NULL, "op" text NOT NULL, "state_json" text NOT NULL, "actor_id" text NOT NULL, "principal_kind" text, "delegated_by_workspace_id" text, "delegated_by_id" text, "recorded_at" text NOT NULL);',
  'CREATE INDEX "idx_content_type_revisions_workspace_key" ON "content_type_revisions" ("workspace_id", "content_type_key", "seq");',
  'CREATE TABLE "content_types" ("id" text PRIMARY KEY NOT NULL, "workspace_id" text NOT NULL, "key" text NOT NULL, "label" text NOT NULL, "fields_json" text NOT NULL, "status" text NOT NULL, "version" integer NOT NULL, "tombstoned_at" text);',
  'CREATE UNIQUE INDEX "content_types_workspace_key_unique" ON "content_types" ("workspace_id", "key");',
  'CREATE INDEX "idx_content_types_workspace" ON "content_types" ("workspace_id");',
];

/** Apply the two content-type tables and their indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
