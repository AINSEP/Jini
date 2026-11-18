import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/core/contracts/storage";
import type { ContentKernel } from "../../../core/__tests__/support/dialect-matrix.js";
import type { TrashTables } from "../../sql/index.js";

/** The table name the dialect tests pass in: the adapter has no default, so the fixture names it. */
export const TRASH_TABLES: TrashTables = { trashedItems: "trashed_items" };

/**
 * DDL copied from Tovu apps/website/src/platform/db/drizzle/0070_trashed_items.sql (the table and its three indexes) plus
 * 0072's `prior_marker`. The `workspaces` foreign key is left out: the adapter never reads that table.
 */
const statements = [
  "CREATE TABLE trashed_items (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, trashed_at TEXT NOT NULL, purge_after TEXT NOT NULL, actor_principal_id TEXT NOT NULL, actor_plugin_id TEXT, display_title TEXT NOT NULL, display_subtitle TEXT, entity_version INTEGER, prior_marker TEXT, purge_lease_owner TEXT, purge_lease_expires_at TEXT)",
  "CREATE UNIQUE INDEX trashed_items_identity_unique ON trashed_items (workspace_id, entity_type, entity_id)",
  "CREATE INDEX idx_trashed_items_purge_after ON trashed_items (purge_after)",
  "CREATE INDEX idx_trashed_items_workspace_trashed_at ON trashed_items (workspace_id, trashed_at)",
];

/** Apply the table and its indexes; schema failures propagate.
 * @complexity O(1) statements, plus driver DDL cost.
 */
export async function createTables(kernel: ContentKernel, _dialect: StorageDialect): Promise<void> {
  for (const statement of statements) await kernel.execute(sql.raw(statement));
}
