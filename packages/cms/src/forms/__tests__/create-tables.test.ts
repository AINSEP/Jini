import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { createFormsTables, formDefinitionRepoFor, formSubmissionRepoFor } from "../sql/index.js";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../index.js";

/**
 * @file `createFormsTables` on a fresh kernel: host-chosen (non-default) table names, idempotent on a
 * second run, and the package repos then save and read a form and a submission through it. SQLite
 * uses a real file, reopened, so the rows are shown to persist.
 */

const require = createRequire(new URL("../../../package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof BetterSqlite3;
const tables = { definitions: "app_forms", submissions: "app_form_entries" };
const dir = mkdtempSync(join(tmpdir(), "forms-create-tables-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const T0 = "2026-11-07T00:00:00.000Z";
const form: FormDefinitionRecord = {
  id: "def-1", workspaceId: "ws", name: "Contact", slug: "contact",
  fields: [{ id: "message", label: "Message", type: "textarea", required: true }],
  notify: { enabled: false, recipients: [] }, status: "active", createdAt: T0, updatedAt: T0, version: 1,
};
const entry: FormSubmissionRecord = {
  id: "sub-1", workspaceId: "ws", formDefinitionId: "def-1", data: { message: "hello" }, sourceIp: "203.0.113.9", submittedAt: T0,
};

async function writeThroughRepos<DB>(kernel: StorageKernel<DB>) {
  await formDefinitionRepoFor({ kernel, tables }).create(form);
  await formSubmissionRepoFor({ kernel, tables }).create(entry);
}

async function assertReadBack<DB>(kernel: StorageKernel<DB>) {
  assert.deepEqual(await formDefinitionRepoFor({ kernel, tables }).findBySlug({ workspaceId: "ws", slug: "contact" }), form);
  const page = await formSubmissionRepoFor({ kernel, tables }).listByDefinition({ workspaceId: "ws", formDefinitionId: "def-1", limit: 10 });
  assert.deepEqual(page, { items: [entry], nextCursor: null });
}

test("sqlite file: creates the tables, a second run is a no-op that keeps rows, repos round-trip across reopen", async () => {
  const filePath = join(dir, "app.db");
  const first = new Database(filePath);
  first.pragma("foreign_keys = ON");
  const kernel = sqliteKernel(first);
  await createFormsTables({ kernel, tables });
  await writeThroughRepos(kernel);
  await createFormsTables({ kernel, tables });
  await assertReadBack(kernel);
  const names = first.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  assert.deepEqual(names.map((row) => (row as { name: string }).name), [
    "app_form_entries", "app_forms", "app_forms_workspace_slug_unique", "idx_app_form_entries_definition",
    "idx_app_form_entries_ip_retention", "idx_app_form_entries_workspace", "idx_app_forms_workspace",
  ]);
  first.close();

  const reopened = new Database(filePath);
  try {
    const again = sqliteKernel(reopened);
    await createFormsTables({ kernel: again, tables });
    await assertReadBack(again);
  } finally {
    reopened.close();
  }
});

test("sqlite: the submission foreign key restricts deleting a form that has entries", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  try {
    const kernel = sqliteKernel(db);
    await createFormsTables({ kernel, tables });
    await writeThroughRepos(kernel);
    assert.throws(() => db.prepare("DELETE FROM app_forms WHERE id = 'def-1'").run(), /FOREIGN KEY/);
  } finally {
    db.close();
  }
});

test("pglite: creates the tables, is idempotent, and the repos round-trip", async () => {
  const kernel = openPgliteKernel({ PGlite }, {});
  try {
    await createFormsTables({ kernel, tables });
    await createFormsTables({ kernel, tables });
    await writeThroughRepos(kernel);
    await createFormsTables({ kernel, tables });
    await assertReadBack(kernel);
  } finally {
    await kernel.close();
  }
});

// Postgres cuts identifiers at 63 bytes. Index names derived from long table names used to cut to
// the same 63-byte prefix, so `CREATE INDEX IF NOT EXISTS` saw the first one and silently skipped
// the rest. 59 + 4 ("idx_") already reaches the limit before the `_definition`/`_workspace` suffix.
const longTables = { definitions: `forms_${"d".repeat(53)}`, submissions: `forms_${"s".repeat(53)}` };
const byteLength = (name: string) => new TextEncoder().encode(name).length;

test("sqlite: index and constraint names stay within 63 bytes and distinct for long table names", async () => {
  const db = new Database(":memory:");
  try {
    await createFormsTables({ kernel: sqliteKernel(db), tables: longTables });
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((row) => row.name);
    assert.equal(names.length, 5);
    assert.equal(new Set(names).size, 5);
    for (const name of names) assert.ok(byteLength(name) <= 63, `${name} is ${byteLength(name)} bytes`);
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(longTables.submissions) as { sql: string }).sql;
    const constraint = /CONSTRAINT "([^"]+)"/.exec(ddl)?.[1] ?? "";
    assert.ok(constraint && byteLength(constraint) <= 63, `${constraint} is ${byteLength(constraint)} bytes`);
  } finally {
    db.close();
  }
});

test("pglite: every index is created for long table names (none skipped by truncation)", async () => {
  const kernel = openPgliteKernel({ PGlite }, {});
  try {
    await createFormsTables({ kernel, tables: longTables });
    await createFormsTables({ kernel, tables: longTables });
    const rows = await kernel.query<{ indexname: string }>(sql`SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename IN (${longTables.definitions}, ${longTables.submissions})`);
    assert.equal(rows.length, 7, rows.map((row) => row.indexname).join(", "));
  } finally {
    await kernel.close();
  }
});
