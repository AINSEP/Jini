import assert from "node:assert/strict";
import { test } from "vitest";
import { describeEachDialect } from "./support/dialect-matrix.fixture.js";
import { createSubmissionIpRetentionRepo } from "./support/repo-ports.fixture.js";
import type { ContentKernel } from "./support/dialect-matrix.fixture.js";

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

