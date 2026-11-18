import assert from "node:assert/strict";
import { test } from "vitest";
import { describeEachDialect, type ContentKernel } from "./support/dialect-matrix.fixture.js";
import { tables } from "./support/forms-tables.fixture.js";
import { createSubmissionIpRetentionRepo, type ColumnCatalogPort } from "../sql/index.js";

/**
 * The retention adapter asks its host for the table's columns instead of importing a database
 * toolkit. A fake catalog port drives it over a real database, so the probe contract (which table,
 * when, how often) and its refusal branch are pinned independently of any dialect's catalog spelling.
 */
const CUTOFF = "2026-07-06T12:00:00.000Z";
const nullableIp = [{ name: "source_ip", notNull: false }] as const;
const requiredIp = [{ name: "source_ip", notNull: true }] as const;

async function seedOneExpiredRow(kernel: ContentKernel): Promise<void> {
  await kernel.run(db => db.insertInto("form_definitions").values({
    id: "def", workspace_id: "ws", name: "Contact", slug: "contact", fields_json: "[]", notify_json: "{}",
    status: "active", created_at: CUTOFF, updated_at: CUTOFF, version: 1,
  }).execute());
  await kernel.run(db => db.insertInto("form_submissions").values({
    id: "old", workspace_id: "ws", form_definition_id: "def", data_json: "{}",
    source_ip: "203.0.113.8", submitted_at: "2026-01-01T00:00:00.000Z", deleted_at: null, version: 1,
  }).execute());
}

const sourceIps = (kernel: ContentKernel) => kernel.run(db => db.selectFrom("form_submissions").select("source_ip").execute());

/** A recording fake catalog: each call returns the next scripted answer (or throws a scripted error). */
function scriptedCatalog(answers: readonly (readonly { name: string; notNull: boolean }[] | Error)[]) {
  const calls: { table: string }[] = [];
  const columns: ColumnCatalogPort = async required => {
    calls.push(required);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === undefined) throw new RangeError("scripted catalog has no answers");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, columns };
}

describeEachDialect("submission IP retention column catalog port", {
  tables: ["form_submissions", "form_definitions"], make: kernel => kernel,
}, make => {
  test("a nullable source_ip lets the update run, and the probe is asked about the submissions table", async () => {
    const kernel = make();
    await seedOneExpiredRow(kernel);
    const { calls, columns } = scriptedCatalog([nullableIp]);
    const repo = createSubmissionIpRetentionRepo({ kernel, tables, columns });
    assert.equal(await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), 1);
    assert.deepEqual(calls, [{ table: tables.submissions }]);
    assert.deepEqual(await sourceIps(kernel), [{ source_ip: null }]);
  });

  test("a NOT NULL source_ip is refused with the migration message and issues no write", async () => {
    const kernel = make();
    await seedOneExpiredRow(kernel);
    const repo = createSubmissionIpRetentionRepo({ kernel, tables, columns: scriptedCatalog([requiredIp]).columns });
    await assert.rejects(repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), /requires the nullable source_ip migration \(0006\)/);
    assert.deepEqual(await sourceIps(kernel), [{ source_ip: "203.0.113.8" }]);
  });

  test("after one success the probe is not repeated", async () => {
    const kernel = make();
    await seedOneExpiredRow(kernel);
    const { calls, columns } = scriptedCatalog([nullableIp]);
    const repo = createSubmissionIpRetentionRepo({ kernel, tables, columns });
    await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF });
    await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF });
    assert.equal(calls.length, 1);
  });

  test("a refused probe is asked again on the next pass, and a failing probe rejects with its own error", async () => {
    const kernel = make();
    await seedOneExpiredRow(kernel);
    const catalogDown = new Error("catalog unavailable");
    const { calls, columns } = scriptedCatalog([requiredIp, catalogDown, nullableIp]);
    const repo = createSubmissionIpRetentionRepo({ kernel, tables, columns });
    await assert.rejects(repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), /requires the nullable source_ip migration/);
    await assert.rejects(repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), catalogDown);
    assert.equal(await repo.clearExpiredIps({ submittedBeforeOrAt: CUTOFF }), 1);
    assert.equal(calls.length, 3);
  });
});
