import assert from "node:assert/strict";
import { test } from "vitest";
import { describeEachDialect } from "./support/dialect-matrix.fixture.js";
import { createSubmissionIpRetentionRepo } from "./support/repo-ports.fixture.js";
import type { ContentKernel } from "./support/dialect-matrix.fixture.js";
import { sql } from "kysely";
import type { StorageDialect } from "@jini-ai/db/kernel";
import { eachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables } from "./support/forms-tables.fixture.js";

/** Owner retention decision 2026-10-04 / DR-002: prove real SQL writes on SQLite and PGlite. */
const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const CUTOFF = new Date(NOW - 90 * DAY).toISOString();

async function seed(kernel: ContentKernel, rows: { id: string; age: number; workspaceId?: string; trashed?: boolean }[]) {
  await kernel.run(db => db.insertInto("form_definitions").values({
    id: "def", workspace_id: "ws", name: "Contact", slug: "contact", fields_json: "[]", notify_json: "{}",
    status: "active", created_at: CUTOFF, updated_at: CUTOFF, version: 1,
  }).execute());
  await kernel.run(db => db.insertInto("form_submissions").values(rows.map(row => ({
    id: row.id, workspace_id: row.workspaceId ?? "ws", form_definition_id: "def", data_json: '{"message":"preserve me"}',
    source_ip: "203.0.113.8", submitted_at: new Date(NOW - row.age).toISOString(),
    deleted_at: row.trashed ? CUTOFF : null, version: 7,
  }))).execute());
}

describeEachDialect("submission IP retention adapter and migration 0006", {
  tables: ["form_submissions", "form_definitions"], make: kernel => ({ kernel, repo: createSubmissionIpRetentionRepo({ kernel }) }),
}, make => {
  test("bounded batches cover more than 500 records; concurrent passes count each cleared row once", async () => {
    const { kernel, repo } = make();
    await seed(kernel, Array.from({ length: 501 }, (_, i) => ({ id: `s-${i}`, age: 91 * DAY })));
    const counts = await Promise.all([
      repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }, { limit: 500 }),
      createSubmissionIpRetentionRepo({ kernel }).clearExpiredIps({ submittedBeforeOrAt: CUTOFF }, { limit: 500 }),
    ]);
    assert.ok(counts.every(count => count <= 500));
    const tail = await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }, { limit: 500 });
    assert.equal(counts.reduce((a, b) => a + b, 0) + tail, 501);
    const rows = await kernel.run(db => db.selectFrom("form_submissions").selectAll().execute());
    assert.equal(rows.length, 501);
    assert.ok(rows.every(row => row.source_ip === null && row.data_json === '{"message":"preserve me"}' && row.version === 7));
    assert.equal(await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }, { limit: 500 }), 0);
  });
});


describeEachDialect("submission IP retention adapter input bounds", {
  tables: ["form_submissions", "form_definitions"], make: kernel => ({ kernel, repo: createSubmissionIpRetentionRepo({ kernel }) }),
}, make => {
  test("a non-positive or non-integer batch limit is refused before any IP is cleared", async () => {
    const { kernel, repo } = make();
    await seed(kernel, [{ id: "old", age: 91 * DAY }]);
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }, { limit }), RangeError, String(limit));
    }
    const rows = await kernel.run(db => db.selectFrom("form_submissions").select("source_ip").execute());
    assert.deepEqual(rows, [{ source_ip: "203.0.113.8" }]);
    assert.equal(await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), 1);
  });
});

/** The pre-0006 schema: `source_ip` still NOT NULL, built from the current DDL so nothing else differs. */
async function createPre0006Tables(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  await createTables(kernel, dialect);
  await kernel.execute(sql.raw("DROP INDEX idx_form_submissions_ip_retention"));
  if (dialect === "postgres") {
    await kernel.execute(sql.raw("ALTER TABLE form_submissions ALTER COLUMN source_ip SET NOT NULL"));
    return;
  }
  await kernel.execute(sql.raw("DROP TABLE form_submissions"));
  await kernel.execute(sql.raw("CREATE TABLE form_submissions (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, form_definition_id text NOT NULL, data_json text NOT NULL, source_ip text NOT NULL, submitted_at text NOT NULL, deleted_at text, version integer DEFAULT 1 NOT NULL)"));
}

/** Migration 0006's effect on each dialect: SQLite rebuilds the table, Postgres drops the constraint. */
async function applyNullableIpMigration(kernel: ContentKernel, dialect: StorageDialect): Promise<void> {
  if (dialect === "postgres") {
    await kernel.execute(sql.raw("ALTER TABLE form_submissions ALTER COLUMN source_ip DROP NOT NULL"));
    return;
  }
  await kernel.execute(sql.raw("CREATE TABLE form_submissions_0006 (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, form_definition_id text NOT NULL, data_json text NOT NULL, source_ip text, submitted_at text NOT NULL, deleted_at text, version integer DEFAULT 1 NOT NULL)"));
  await kernel.execute(sql.raw("INSERT INTO form_submissions_0006 SELECT * FROM form_submissions"));
  await kernel.execute(sql.raw("DROP TABLE form_submissions"));
  await kernel.execute(sql.raw("ALTER TABLE form_submissions_0006 RENAME TO form_submissions"));
}

for (const each of eachDialect({ tables: ["form_submissions", "form_definitions"], make: (kernel: ContentKernel) => kernel, createTables: createPre0006Tables }, {})) {
  test(`[${each.name}] before migration 0006 the adapter refuses without writing, and re-probes once the migration lands`, async () => {
    const kernel = each.make();
    const repo = createSubmissionIpRetentionRepo({ kernel });
    await seed(kernel, [{ id: "old", age: 91 * DAY }]);
    for (let pass = 0; pass < 2; pass++) {
      await assert.rejects(repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), /requires the nullable source_ip migration \(0006\)/);
    }
    assert.deepEqual(await kernel.run(db => db.selectFrom("form_submissions").select("source_ip").execute()), [{ source_ip: "203.0.113.8" }]);
    await applyNullableIpMigration(kernel, each.dialect);
    assert.equal(await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), 1);
    assert.deepEqual(await kernel.run(db => db.selectFrom("form_submissions").select("source_ip").execute()), [{ source_ip: null }]);
  });
}
