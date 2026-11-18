import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { sqliteKernel } from "../../../kernel/sqlite/index.js";
import { openPgliteKernel } from "../../../kernel/pglite/index.js";
import type { KyselyKernel } from "../../../kernel/port.js";
import type { OriginTables } from "../../repo.sql.js";

/** The host-owned table name used by the tests (the adapter has no default). */
export const TABLES: OriginTables = { origins: "origin_settings" };

/** DDL copied from the host schema's migration: one row per workspace, allowlists default to an empty JSON list. */
const DDL = "CREATE TABLE origin_settings (workspace_id text PRIMARY KEY NOT NULL, scheme text NOT NULL, host text NOT NULL, port integer, base_path text, verified_at text NOT NULL, source text NOT NULL, redirect_allowlist_json text DEFAULT '[]' NOT NULL, egress_allowlist_json text DEFAULT '[]' NOT NULL)";

/** A fresh in-memory database of the dialect with the origin table applied. */
export async function openOriginKernel({ dialect }: { dialect: "sqlite" | "postgres" }, _optional: Record<string, never> = {}): Promise<KyselyKernel<unknown>> {
  const kernel: KyselyKernel<unknown> = dialect === "sqlite" ? sqliteKernel<unknown>(new Database(":memory:")) : openPgliteKernel({ PGlite });
  await kernel.execute(sql.raw(DDL));
  return kernel;
}

/** Sets both allowlists of a workspace's row directly (the adapter writes none). */
export async function setAllowlists(
  { kernel, workspaceId, redirect, egress }: { kernel: KyselyKernel<unknown>; workspaceId: string; redirect: string[]; egress: string[] },
  _optional: Record<string, never> = {},
): Promise<void> {
  await kernel.execute(sql`UPDATE origin_settings SET redirect_allowlist_json = ${JSON.stringify(redirect)}, egress_allowlist_json = ${JSON.stringify(egress)} WHERE workspace_id = ${workspaceId}`);
}
