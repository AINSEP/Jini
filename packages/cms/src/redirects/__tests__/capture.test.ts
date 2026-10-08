import assert from "node:assert/strict";
import { test } from "vitest";

import type { SlugChangeCaptureInput } from "../ports.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { RedirectSlugChangeCapture } from "../capture.js";
import type { RedirectDbHandle } from "../ports.internal.js";
import type { RedirectRecord, RedirectRevision } from "../types.js";

/**
 * @file T005 (AC-18, AC-20, INV-01, INV-02, EC-05) — `capture.ts`'s
 * `RedirectSlugChangeCapture.onSlugChange` is called directly inside a
 * manufactured open transaction (no HTTP layer, no real content chokepoint —
 * see tasks.md's "Known Scope Boundary"). Certifies: atomicity (the row is
 * queryable via the same handle before any commit concept), idempotency by
 * retried input (AC-20), and that the implementation issues NO transaction
 * control of its own (EC-05, Decision A).
 */

function makeFakeDb() {
  const begins: string[] = [];
  const records: RedirectRecord[] = [];
  const revisions: RedirectRevision[] = [];
  const db: RedirectDbHandle = {
    insertRedirect(record) {
      records.push(record);
    },
    insertRevision(revision) {
      revisions.push(revision);
    },
  };
  return { db, begins, records, revisions };
}

function makeFakeRepo(existing: RedirectRecord[] = []) {
  return {
    async lookupExact(required: { workspaceId: string; path: string; includeOverrideOnly: boolean }) {
      return (
        existing.find(
          (r) => r.workspaceId === required.workspaceId && r.fromPattern === required.path
        ) ?? null
      );
    },
  };
}

const clock = { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") };
let idCounter = 0;
function makeIdGen() {
  idCounter = 0;
  return { newId: () => `redirect-${++idCounter}` };
}

const baseInput: SlugChangeCaptureInput = {
  workspaceId: "workspace-1",
  entryId: "post-1",
  oldPath: "/old-slug",
  newPath: "/new-slug",
  actor: "user-1",
  changeSetId: "cs-1",
};

test("onSlugChange inserts exactly one redirects row + one revision row, queryable via the same handle before any commit", async () => {
  const { db, records, revisions } = makeFakeDb();
  const repo = makeFakeRepo();
  const capture = new RedirectSlugChangeCapture({ repo, db, clock, idGen: makeIdGen() });

  await capture.onSlugChange(baseInput);

  // "queryable via the same transaction handle before commit" (AC-18): since
  // this is a manufactured (non-real) transaction, the assertion is that the
  // fake db handle's own state reflects the write immediately, synchronously
  // with the call — no deferred/async-outbox-only write (which would violate
  // INV-02, see the rejected "async outbox only" alternative in ADR-PIPE-009).
  assert.equal(records.length, 1);
  assert.equal(revisions.length, 1);
  assert.ok(records[0]);
  assert.equal(records[0].fromPattern, "/old-slug");
  assert.equal(records[0].toTarget, "/new-slug");
  assert.equal(records[0].source, "auto_slug_change");
  assert.equal(records[0].matchType, "exact");
  assert.equal(records[0].status, "active");
  assert.equal(records[0].sourceEntryId, "post-1");
  assert.equal(records[0].createdByPrincipal, "user-1");
  assert.ok(revisions[0]);
  assert.equal(revisions[0].redirectId, records[0].id);
  assert.equal(revisions[0].seq, 1);
  assert.equal(revisions[0].tombstoned, false);
});

test("onSlugChange retrying the same change (same oldPath/newPath) does not duplicate the rule (AC-20)", async () => {
  const { db, records, revisions } = makeFakeDb();
  const repo = makeFakeRepo();
  const capture = new RedirectSlugChangeCapture({ repo, db, clock, idGen: makeIdGen() });

  await capture.onSlugChange(baseInput);
  // Simulate the retry seeing the just-created row via a fresh repo view.
  const repoAfterFirst = makeFakeRepo(records);
  const captureRetry = new RedirectSlugChangeCapture({
    repo: repoAfterFirst,
    db,
    clock,
    idGen: makeIdGen(),
  });
  await captureRetry.onSlugChange(baseInput);

  assert.equal(records.length, 1, "no duplicate redirect row on retry");
  assert.equal(revisions.length, 1, "no duplicate revision row on retry");
});

test("onSlugChange issues NO transaction control of its own (EC-05, Decision A)", async () => {
  const { db, records, revisions } = makeFakeDb();
  const txCalls: string[] = [];
  const observed = { ...db, begin: () => txCalls.push("begin"), commit: () => txCalls.push("commit"),
    rollback: () => txCalls.push("rollback"), transaction: () => txCalls.push("transaction") };
  await new RedirectSlugChangeCapture({ repo: makeFakeRepo(), db: observed,
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") }, idGen: makeIdGen() }).onSlugChange(baseInput);
  assert.equal(records.length, 1);
  assert.equal(revisions.length, 1);
  assert.deepEqual(txCalls, []);
});

test("onSlugChange propagates an unexpected throw uncaught", async () => {
  const repo = makeFakeRepo();
  const db: RedirectDbHandle = {
    insertRedirect() {
      throw new Error("disk full");
    },
    insertRevision() {
      throw new Error("should not be reached");
    },
  };
  const capture = new RedirectSlugChangeCapture({ repo, db, clock, idGen: makeIdGen() });

  await assert.rejects(() => capture.onSlugChange(baseInput), /disk full/);
});

test("onSlugChange for distinct old paths preserves both redirects and their revisions in keyed storage", async () => {
  const repo = new InMemoryRedirectRepo();
  const ids = makeIdGen();
  const capture = new RedirectSlugChangeCapture({ repo, db: repo,
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") }, idGen: ids });
  await capture.onSlugChange(baseInput);
  await capture.onSlugChange({ ...baseInput, oldPath: "/another-old-slug", newPath: "/another-new-slug", changeSetId: "cs-2" });
  const first = await repo.findByFromPattern({ workspaceId: baseInput.workspaceId, fromPattern: baseInput.oldPath });
  const second = await repo.findByFromPattern({ workspaceId: baseInput.workspaceId, fromPattern: "/another-old-slug" });
  assert.equal(first?.toTarget, "/new-slug");
  assert.equal(second?.toTarget, "/another-new-slug");
  assert.notEqual(first?.id, second?.id);
  assert.equal((await repo.list({ workspaceId: baseInput.workspaceId })).length, 2);
  for (const row of [first, second]) {
    assert.ok(row);
    assert.deepEqual(repo.listRevisionsForTests({ redirectId: row.id }, {}).map(r => [r.redirectId, r.seq, r.state]), [[row.id, 1, row]]);
  }
});

for (const overrides of [
  { source: "manual", toTarget: "/new-slug" },
  { source: "auto_slug_change", toTarget: "/different-target" },
  { source: "auto_slug_change", toTarget: "/new-slug", status: "disabled" },
] as const) {
  test(`existing ${overrides.source}/${overrides.toTarget}/${overrides.status ?? "active"} is not an exact active retry`, async () => {
    const repo = new InMemoryRedirectRepo();
    const capture = new RedirectSlugChangeCapture({ repo, db: repo,
      clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") }, idGen: makeIdGen() });
    await capture.onSlugChange(baseInput);
    const prior = (await repo.findByFromPattern({ workspaceId: baseInput.workspaceId, fromPattern: baseInput.oldPath }))!;
    repo.insertRedirect({ ...prior, ...overrides });
    await capture.onSlugChange(baseInput);
    const rows = await repo.list({ workspaceId: baseInput.workspaceId });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(r => r.source === "auto_slug_change" && r.status === "active" && r.toTarget === "/new-slug").length, 1);
    assert.deepEqual(await repo.findById({ workspaceId: baseInput.workspaceId, id: prior.id }), { ...prior, ...overrides });
  });
}

test("repeated renames a→b→a→c→a→b leave /a pointing at the live /b, not into a /a→/c→/a loop", async () => {
  // Ids ascend with creation and the clock ticks per capture, so the first `/a → /b` rule sorts
  // before the later `/a → /c` one by id while resolution (newest wins) picks `/a → /c`.
  const repo = new InMemoryRedirectRepo();
  let ms = Date.parse("2026-07-13T00:00:00.000Z");
  const capture = new RedirectSlugChangeCapture({ repo, db: repo,
    clock: { nowMs: () => (ms += 1000) }, idGen: makeIdGen() });
  const path = ["/a", "/b", "/a", "/c", "/a", "/b"];
  for (let i = 1; i < path.length; i++) {
    const oldPath = path[i - 1], newPath = path[i];
    assert.ok(oldPath);
    assert.ok(newPath);
    await capture.onSlugChange({ ...baseInput, oldPath, newPath, changeSetId: `cs-${i}` });
  }
  const winner = await repo.lookupExact({ workspaceId: baseInput.workspaceId, path: "/a", includeOverrideOnly: false });
  assert.equal(winner?.toTarget, "/b");
});
