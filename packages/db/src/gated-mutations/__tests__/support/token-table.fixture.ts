import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { sqliteKernel } from "../../../kernel/sqlite/index.js";
import { openPgliteKernel } from "../../../kernel/pglite/index.js";
import type { KyselyKernel } from "../../../kernel/port.js";
import type { TokenStoreTables } from "../../repo.sql.js";

/** The host-owned table name used by the tests (the adapter has no default). */
export const TABLES: TokenStoreTables = { tokens: "gated_mutation_tokens" };

/** DDL copied from the host schema's migration: one primary-keyed text table, no foreign keys. */
const DDL = "CREATE TABLE gated_mutation_tokens (confirmation_token text PRIMARY KEY NOT NULL, plan_hash text NOT NULL, scope_id text NOT NULL, confirmer_principal_id text NOT NULL, status text NOT NULL, created_at text NOT NULL, expires_at text NOT NULL)";

/** A fresh in-memory database of the dialect with the token table applied. */
export async function openTokenKernel({ dialect }: { dialect: "sqlite" | "postgres" }, _optional: Record<string, never> = {}): Promise<KyselyKernel<unknown>> {
  const kernel: KyselyKernel<unknown> = dialect === "sqlite" ? sqliteKernel<unknown>({ source: new Database(":memory:") }) : openPgliteKernel({ PGlite });
  await kernel.execute(sql.raw(DDL));
  return kernel;
}
