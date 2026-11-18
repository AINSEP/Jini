import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import type { ContentKernel } from "../../../core/__tests__/support/dialect-matrix.js";
import type { NavigationTables } from "../../sql/index.js";

/** The table names the dialect tests pass in: the adapter has no defaults, so the fixture names them. */
export const NAVIGATION_TABLES: NavigationTables = { menus: "menus", navLocationBindings: "nav_location_bindings" };

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0003_steady_peter_quill.sql:1-23 (the two tables, their
 * unique and lookup indexes). The Postgres form is the same column set with `integer` for `version`, so it reads
 * back as a number on both dialects, and `jsonb` for the two document columns as in the host's Postgres baseline.
 */
const sqliteStatements = [
  "CREATE TABLE `menus` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`workspace_id` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`title` text NOT NULL,\n\t`status` text NOT NULL,\n\t`doc_json` text NOT NULL,\n\t`locations_json` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`version` integer NOT NULL\n)",
  "CREATE UNIQUE INDEX `menus_workspace_slug_unique` ON `menus` (`workspace_id`,`slug`)",
  "CREATE INDEX `idx_menus_workspace` ON `menus` (`workspace_id`)",
  "CREATE TABLE `nav_location_bindings` (\n\t`workspace_id` text NOT NULL,\n\t`location_key` text NOT NULL,\n\t`menu_id` text NOT NULL,\n\t`bound_at` text NOT NULL\n)",
  "CREATE UNIQUE INDEX `nav_location_bindings_workspace_location_unique` ON `nav_location_bindings` (`workspace_id`,`location_key`)",
  "CREATE INDEX `idx_nav_location_bindings_menu` ON `nav_location_bindings` (`workspace_id`,`menu_id`)",
];

const postgresStatements = [
  'CREATE TABLE "menus" ("id" text NOT NULL, "workspace_id" text NOT NULL, "slug" text NOT NULL, "title" text NOT NULL, "status" text NOT NULL, "doc_json" jsonb NOT NULL, "locations_json" jsonb NOT NULL, "updated_at" text NOT NULL, "version" integer NOT NULL, PRIMARY KEY ("id"));',
  'CREATE UNIQUE INDEX "menus_workspace_slug_unique" ON "menus" ("workspace_id", "slug");',
  'CREATE INDEX "idx_menus_workspace" ON "menus" ("workspace_id");',
  'CREATE TABLE "nav_location_bindings" ("workspace_id" text NOT NULL, "location_key" text NOT NULL, "menu_id" text NOT NULL, "bound_at" text NOT NULL);',
  'CREATE UNIQUE INDEX "nav_location_bindings_workspace_location_unique" ON "nav_location_bindings" ("workspace_id", "location_key");',
  'CREATE INDEX "idx_nav_location_bindings_menu" ON "nav_location_bindings" ("workspace_id", "menu_id");',
];

/** Apply the two navigation tables and their indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
