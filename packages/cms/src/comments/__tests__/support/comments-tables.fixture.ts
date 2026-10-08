import { sql } from "kysely";
import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";

/**
 * Literal DDL emitted for COMMENTS_DATA_MODULE in
 * Tovu/apps/website/src/features/comments/types.ts by declareDataModule's columnSql,
 * indexSql and applyTableCreate in Tovu/apps/website/src/features/plugins/data-module.ts.
 * Type spellings come from @jini-ai/db/kernel's columnTypeSql: TEXT/INTEGER/REAL on SQLite;
 * text/bigint/double precision on Postgres. No FK or extra NOT NULL is introduced.
 * Only the domain tables/indexes are needed; the Tovu migration journal stays in Tovu.
 */
export const tables = {
  comments: "p_comments__comments",
  moderationLog: "p_comments__moderation_log",
};
export const tableNames = [tables.comments, tables.moderationLog];

const sqliteDdl = [
  `CREATE TABLE "p_comments__comments" (
    "id" TEXT PRIMARY KEY, "workspace_id" TEXT NOT NULL, "entry_id" TEXT NOT NULL,
    "parent_id" TEXT, "thread_root_id" TEXT NOT NULL, "depth" INTEGER NOT NULL,
    "status" TEXT NOT NULL, "author_principal_id" TEXT, "author_name" TEXT NOT NULL,
    "author_email" TEXT, "author_url" TEXT, "author_ip_hash" TEXT, "body_text" TEXT NOT NULL,
    "spam_score" REAL, "spam_provider" TEXT, "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL, "version" INTEGER NOT NULL
  )`,
  `CREATE INDEX "idx_p_comments__comments__moderation_queue" ON "p_comments__comments" ("workspace_id", "status", "created_at")`,
  `CREATE INDEX "idx_p_comments__comments__thread" ON "p_comments__comments" ("workspace_id", "entry_id", "thread_root_id")`,
  `CREATE TABLE "p_comments__moderation_log" (
    "id" TEXT PRIMARY KEY, "workspace_id" TEXT NOT NULL, "comment_id" TEXT NOT NULL,
    "actor_principal_id" TEXT NOT NULL, "action" TEXT NOT NULL, "from_status" TEXT,
    "to_status" TEXT NOT NULL, "at" TEXT NOT NULL, "note" TEXT
  )`,
  `CREATE INDEX "idx_p_comments__moderation_log__by_comment" ON "p_comments__moderation_log" ("workspace_id", "comment_id")`,
];

const postgresDdl = [
  `CREATE TABLE "p_comments__comments" (
    "id" text PRIMARY KEY, "workspace_id" text NOT NULL, "entry_id" text NOT NULL,
    "parent_id" text, "thread_root_id" text NOT NULL, "depth" bigint NOT NULL,
    "status" text NOT NULL, "author_principal_id" text, "author_name" text NOT NULL,
    "author_email" text, "author_url" text, "author_ip_hash" text, "body_text" text NOT NULL,
    "spam_score" double precision, "spam_provider" text, "created_at" text NOT NULL,
    "updated_at" text NOT NULL, "version" bigint NOT NULL
  )`,
  `CREATE INDEX "idx_p_comments__comments__moderation_queue" ON "p_comments__comments" ("workspace_id", "status", "created_at")`,
  `CREATE INDEX "idx_p_comments__comments__thread" ON "p_comments__comments" ("workspace_id", "entry_id", "thread_root_id")`,
  `CREATE TABLE "p_comments__moderation_log" (
    "id" text PRIMARY KEY, "workspace_id" text NOT NULL, "comment_id" text NOT NULL,
    "actor_principal_id" text NOT NULL, "action" text NOT NULL, "from_status" text,
    "to_status" text NOT NULL, "at" text NOT NULL, "note" text
  )`,
  `CREATE INDEX "idx_p_comments__moderation_log__by_comment" ON "p_comments__moderation_log" ("workspace_id", "comment_id")`,
];

/** Creates exactly the host's two comment tables for p1's dialect matrix.
 * Errors reject, so a resolved fixture means every DDL statement succeeded.
 * @complexity O(1) statements and space; driver DDL cost depends on the database.
 */
export async function createTables(kernel: StorageKernel<unknown>, dialect: StorageDialect): Promise<void> {
  for (const statement of dialect === "sqlite" ? sqliteDdl : postgresDdl) {
    await kernel.execute(sql.raw(statement));
  }
}
