import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import type { ContentKernel } from "../../../core/__tests__/support/dialect-matrix.js";
import type { PresentationTables } from "../../sql/index.js";

/** The table name the dialect tests pass in: the adapter has no defaults, so the fixture names it. */
export const PRESENTATION_TABLES: PresentationTables = { presentationSettings: "presentation_settings" };

/** DDL copied from Tovu apps/website/src/platform/db/drizzle/0000_yellow_ravenous.sql:14-18 (one row per workspace). */
const sqliteStatements = [
  "CREATE TABLE `presentation_settings` (\n\t`workspace_id` text PRIMARY KEY NOT NULL,\n\t`active_theme_id` text NOT NULL,\n\t`updated_at` text NOT NULL\n)",
];

const postgresStatements = [
  'CREATE TABLE "presentation_settings" ("workspace_id" text PRIMARY KEY NOT NULL, "active_theme_id" text NOT NULL, "updated_at" text NOT NULL);',
];

/** Apply the presentation-settings table; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  const statements = dialect === "sqlite" ? sqliteStatements : postgresStatements;
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
