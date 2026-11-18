import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import type { ContentKernel } from "../../../core/__tests__/support/dialect-matrix.js";
import type { TaxonomyTables } from "../../sql/index.js";

/** The table names the dialect tests pass in: the adapter has no defaults, so the fixture names them. */
export const TAXONOMY_TABLES: TaxonomyTables = { taxonomies: "taxonomies", terms: "terms", entryTerms: "entry_terms", taxonomyRevisions: "taxonomy_revisions" };

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0010_fixed_marauders.sql:57-100 (the four tables, their
 * unique and lookup indexes). The Postgres form is the same column set with `integer` for the counters, so
 * `version` and `hierarchical` read back as numbers on both dialects, and `text` for the revision state.
 */
const sqliteStatements = [
  "CREATE TABLE `entry_terms` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`content_type` text NOT NULL,\n\t`content_id` text NOT NULL,\n\t`term_id` text NOT NULL,\n\t`added_at` text NOT NULL\n)",
  "CREATE UNIQUE INDEX `entry_terms_unique` ON `entry_terms` (`workspace_id`,`content_type`,`content_id`,`term_id`)",
  "CREATE TABLE `taxonomies` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`hierarchical` integer NOT NULL,\n\t`status` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`version` integer NOT NULL\n)",
  "CREATE INDEX `idx_taxonomies_workspace` ON `taxonomies` (`workspace_id`)",
  "CREATE TABLE `taxonomy_revisions` (\n\t`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`taxonomy_id` text NOT NULL,\n\t`op` text NOT NULL,\n\t`previous_state_json` text,\n\t`actor_id` text NOT NULL,\n\t`recorded_at` text NOT NULL\n)",
  "CREATE INDEX `idx_taxonomy_revisions_workspace_taxonomy` ON `taxonomy_revisions` (`workspace_id`,`taxonomy_id`,`seq`)",
  "CREATE TABLE `terms` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`taxonomy_id` text NOT NULL,\n\t`parent_id` text,\n\t`name` text NOT NULL,\n\t`status` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`version` integer NOT NULL\n)",
  "CREATE INDEX `idx_terms_workspace_taxonomy` ON `terms` (`workspace_id`,`taxonomy_id`)",
];

const postgresStatements = [
  'CREATE TABLE "entry_terms" ("id" integer GENERATED ALWAYS AS IDENTITY NOT NULL, "workspace_id" text NOT NULL, "content_type" text NOT NULL, "content_id" text NOT NULL, "term_id" text NOT NULL, "added_at" text NOT NULL, PRIMARY KEY ("id"));',
  'CREATE UNIQUE INDEX "entry_terms_unique" ON "entry_terms" ("workspace_id", "content_type", "content_id", "term_id");',
  'CREATE TABLE "taxonomies" ("id" text NOT NULL, "workspace_id" text NOT NULL, "name" text NOT NULL, "hierarchical" integer NOT NULL, "status" text NOT NULL, "updated_at" text NOT NULL, "version" integer NOT NULL, PRIMARY KEY ("id"));',
  'CREATE INDEX "idx_taxonomies_workspace" ON "taxonomies" ("workspace_id");',
  'CREATE TABLE "taxonomy_revisions" ("seq" integer GENERATED ALWAYS AS IDENTITY NOT NULL, "workspace_id" text NOT NULL, "taxonomy_id" text NOT NULL, "op" text NOT NULL, "previous_state_json" text, "actor_id" text NOT NULL, "recorded_at" text NOT NULL, PRIMARY KEY ("seq"));',
  'CREATE INDEX "idx_taxonomy_revisions_workspace_taxonomy" ON "taxonomy_revisions" ("workspace_id", "taxonomy_id", "seq");',
  'CREATE TABLE "terms" ("id" text NOT NULL, "workspace_id" text NOT NULL, "taxonomy_id" text NOT NULL, "parent_id" text, "name" text NOT NULL, "status" text NOT NULL, "updated_at" text NOT NULL, "version" integer NOT NULL, PRIMARY KEY ("id"));',
  'CREATE INDEX "idx_terms_workspace_taxonomy" ON "terms" ("workspace_id", "taxonomy_id");',
];

/** Apply the four taxonomy tables and their indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
