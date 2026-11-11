import { sql, type RawBuilder } from "kysely";
import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";
import type { FormsTables } from "./tables.js";

/**
 * @file The forms tables, created on a host-passed kernel. Idempotent DDL (`IF NOT EXISTS`) for the
 * current schema the forms repos read and write; it is not a migration chain and records nothing.
 * A host that versions its schema can call this from one of its own migration steps instead.
 */

type Names = { definitions: RawBuilder<unknown>; submissions: RawBuilder<unknown>; id: (name: string) => RawBuilder<unknown> };

function definitionsTable(n: Names, dialect: StorageDialect): RawBuilder<unknown> {
  const json = dialect === "postgres" ? sql.raw("jsonb") : sql.raw("text");
  const version = dialect === "postgres" ? sql.raw("bigint") : sql.raw("integer");
  return sql`CREATE TABLE IF NOT EXISTS ${n.definitions} (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, name text NOT NULL, slug text NOT NULL, fields_json ${json} NOT NULL, notify_json ${json} NOT NULL, status text DEFAULT 'active' NOT NULL, created_at text NOT NULL, updated_at text NOT NULL, deleted_at text, version ${version} DEFAULT 1 NOT NULL)`;
}

function submissionsTable(n: Names, dialect: StorageDialect, fk: string): RawBuilder<unknown> {
  const json = dialect === "postgres" ? sql.raw("jsonb") : sql.raw("text");
  const version = dialect === "postgres" ? sql.raw("bigint") : sql.raw("integer");
  return sql`CREATE TABLE IF NOT EXISTS ${n.submissions} (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, form_definition_id text NOT NULL, data_json ${json} NOT NULL, source_ip text, submitted_at text NOT NULL, deleted_at text, version ${version} DEFAULT 1 NOT NULL, CONSTRAINT ${n.id(fk)} FOREIGN KEY (form_definition_id) REFERENCES ${n.definitions} (id) ON UPDATE NO ACTION ON DELETE RESTRICT)`;
}

/**
 * Create the forms definition and submission tables (and their indexes) if they do not exist.
 * Safe to run on every start: a second run changes nothing and keeps existing rows. Index and
 * constraint names derive from the table names, e.g. `idx_<submissions>_workspace`.
 *
 * @agent-note `kernel`: in your app, pass the SQLite or Postgres kernel you already opened (for
 *   SQLite, `sqliteKernel(openSqliteConnection({ filePath, open }))` from `@jini-ai/db/kernel/sqlite`
 *   and `@jini-ai/db/sqlite`), the same one you then hand to `formDefinitionRepoFor` and
 *   `formSubmissionRepoFor`. `tables`: the names your app chose, passed unchanged to those repos.
 * @param required.kernel the host's storage kernel; its `dialect` picks the column types.
 * @param required.tables the host's table names (no defaults).
 * @throws whatever the kernel throws executing DDL (e.g. a same-named table with another shape is
 *   left as is, and the repos then fail on it).
 * @complexity O(1) statements (seven); cost is the database's DDL cost.
 * @example await createFormsTables({ kernel, tables: { definitions: "form_definitions", submissions: "form_submissions" } });
 */
export async function createFormsTables<DB>(
  required: { kernel: StorageKernel<DB>; tables: FormsTables },
  _optional: Record<string, never> = {},
): Promise<void> {
  const { kernel, tables } = required;
  const n: Names = { definitions: sql.table(tables.definitions), submissions: sql.table(tables.submissions), id: (name) => sql.id(name) };
  const d = tables.definitions;
  const s = tables.submissions;
  const statements: RawBuilder<unknown>[] = [
    definitionsTable(n, kernel.dialect),
    sql`CREATE UNIQUE INDEX IF NOT EXISTS ${n.id(`${d}_workspace_slug_unique`)} ON ${n.definitions} (workspace_id, slug)`,
    sql`CREATE INDEX IF NOT EXISTS ${n.id(`idx_${d}_workspace`)} ON ${n.definitions} (workspace_id)`,
    submissionsTable(n, kernel.dialect, `${s}_form_definition_id_${d}_id_fk`),
    sql`CREATE INDEX IF NOT EXISTS ${n.id(`idx_${s}_definition`)} ON ${n.submissions} (form_definition_id, submitted_at)`,
    sql`CREATE INDEX IF NOT EXISTS ${n.id(`idx_${s}_workspace`)} ON ${n.submissions} (workspace_id)`,
    // Partial index for the IP-retention sweep (`submission-ip-retention-repo.ts`).
    sql`CREATE INDEX IF NOT EXISTS ${n.id(`idx_${s}_ip_retention`)} ON ${n.submissions} (submitted_at, id) WHERE source_ip IS NOT NULL`,
  ];
  for (const statement of statements) await kernel.execute(statement);
}
