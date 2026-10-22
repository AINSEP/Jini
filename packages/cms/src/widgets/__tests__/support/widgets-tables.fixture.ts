import { sql } from "kysely";
import type { StorageKernel, StorageDialect } from "@jini-ai/db/kernel";

// Schema contract: Tovu apps/website/src/platform/db/schema.sqlite.ts:1592–1603.
// Literal SQLite DDL: platform/db/drizzle/0017_magical_rawhide_kid.sql:13–21.
// Literal PostgreSQL DDL: platform/db/migrations/0000_legacy_baseline.postgres.ts:74,172–173.
const SQLITE_DDL = [
  "CREATE TABLE `widget_region_bindings` (\n\t`workspace_id` text NOT NULL,\n\t`region_key` text NOT NULL,\n\t`area_entry_id` text NOT NULL,\n\t`updated_at` text NOT NULL\n);",
  "CREATE UNIQUE INDEX `widget_region_bindings_workspace_region_unique` ON `widget_region_bindings` (`workspace_id`,`region_key`);",
  "CREATE INDEX `idx_widget_region_bindings_area` ON `widget_region_bindings` (`workspace_id`,`area_entry_id`);"
];
const POSTGRES_DDL = [
  "CREATE TABLE \"widget_region_bindings\" (\"workspace_id\" text NOT NULL, \"region_key\" text NOT NULL, \"area_entry_id\" text NOT NULL, \"updated_at\" text NOT NULL);",
  "CREATE UNIQUE INDEX \"widget_region_bindings_workspace_region_unique\" ON \"widget_region_bindings\" (\"workspace_id\", \"region_key\");",
  "CREATE INDEX \"idx_widget_region_bindings_area\" ON \"widget_region_bindings\" (\"workspace_id\", \"area_entry_id\");"
];

/** Apply precisely the host's region-index schema on the matrix's embedded dialect. */
export async function createWidgetsTables<DB>(
  kernel: StorageKernel<DB>, dialect: StorageDialect,
): Promise<void> {
  for (const statement of dialect === "sqlite" ? SQLITE_DDL : POSTGRES_DDL) {
    await kernel.execute(sql.raw(statement));
  }
}
