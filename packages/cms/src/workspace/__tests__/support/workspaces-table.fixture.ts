import { sql } from "kysely";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0000_yellow_ravenous.sql:20-27 (the table and its
 * unique slug index) plus the later `version` column (integer, NOT NULL, default 1). The Postgres form uses the
 * same column set with `integer`, so `version` reads back as a number on both dialects.
 */
const sqliteStatements = [
  "CREATE TABLE `workspaces` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`version` integer DEFAULT 1 NOT NULL\n)",
  "CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`)",
];

const postgresStatements = [
  "CREATE TABLE \"workspaces\" (\"id\" text NOT NULL, \"name\" text NOT NULL, \"slug\" text NOT NULL, \"created_at\" text NOT NULL, \"version\" integer DEFAULT 1 NOT NULL, PRIMARY KEY (\"id\"));",
  "CREATE UNIQUE INDEX \"workspaces_slug_unique\" ON \"workspaces\" (\"slug\");",
];

/** Apply the workspaces table and its unique slug index; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables<DB>(kernel: KyselyKernel<DB>, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
