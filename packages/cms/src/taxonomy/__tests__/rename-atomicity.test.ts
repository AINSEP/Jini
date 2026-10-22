import assert from "node:assert/strict";
import { test } from "vitest";
import { ForbiddenError } from "../../core/commands/command.js";
import { renameTerm, type RenameTermRequired, type Term, type TaxonomyRevisionRow } from "../write-service.js";

function fixture(failAt?: "revision" | "watermark" | "outbox") {
  const prior: Term = { id: "term-1", taxonomyId: "tax-1", name: "Before", parentId: null,
    status: "active", updatedAt: "t0", version: 3 };
  let state = { term: { ...prior }, revisions: [] as TaxonomyRevisionRow[], watermark: 0, events: [] as unknown[] };
  let inside = false;
  let transactions = 0;
  const error = new Error(`injected ${failAt}`);
  function check(stage: string) {
    assert.equal(inside, true, `${stage} must share the transaction`);
    if (stage === failAt) throw error;
  }
  const transaction = async <T>({ fn }: { fn: () => Promise<T> }): Promise<T> => {
    assert.equal(inside, false);
    transactions++;
    const before = structuredClone(state);
    inside = true;
    try { return await fn(); } catch (error) { state = before; throw error; } finally { inside = false; }
  };
  const deps: RenameTermRequired["deps"] = {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: "ws-1", clock: { nowMs: () => Date.parse("2026-10-02T00:00:00.000Z")}, idGen: { newId: () => "id" },
    transaction,
    taxonomies: { findById: async () => null, insert: async () => {} },
    terms: { findById: async () => { check("lookup"); return { ...state.term }; }, insert: async () => {},
      update: async (row) => { check("update"); state.term = row; } },
    entryTerms: { upsert: async () => {} }, contentLookup: { resolve: async () => null },
    revisions: { insert: async (row) => { check("revision"); state.revisions.push(row); } },
    stampWatermark: () => { check("watermark"); state.watermark++; },
    outbox: { enqueue: async ({ event }) => { check("outbox"); state.events.push(event); } },
  };
  return { deps, error, prior, state: () => state, transactions: () => transactions };
}

test("rename commits its lookup, row, revision, watermark and event in exactly one transaction", async () => {
  const f = fixture();
  const term = await renameTerm({ deps: f.deps, principalId: "actor", termId: "term-1", newName: "After" });
  assert.deepEqual(term, { ...f.prior, name: "After", version: 4, updatedAt: "2026-10-02T00:00:00.000Z" });
  assert.equal(f.transactions(), 1);
  assert.deepEqual(f.state().revisions, [{ taxonomyId: "tax-1", op: "rename", previousState: { name: "Before" }, actorId: "actor", recordedAt: "2026-10-02T00:00:00.000Z" }]);
  assert.equal(f.state().watermark, 1);
  assert.deepEqual(f.state().events, [{ name: "taxonomy.term_renamed", termId: "term-1", actorId: "actor", occurredAt: "2026-10-02T00:00:00.000Z" }]);
});

for (const failAt of ["revision", "watermark", "outbox"] as const) {
  test(`rename rolls back all writes when ${failAt} rejects`, async () => {
    const f = fixture(failAt);
    await assert.rejects(renameTerm({ deps: f.deps, principalId: "actor", termId: "term-1", newName: "After" }),
      (error) => error === f.error);
    assert.equal(f.transactions(), 1);
    assert.deepEqual(f.state(), { term: f.prior, revisions: [], watermark: 0, events: [] });
  });
}

// REGRESSION: fails if renameTerm again discovers a transaction by casting the repo.
test("rename requires an explicitly bound transaction even when the repo has one", async () => {
  const f = fixture();
  const { transaction, ...unbound } = f.deps;
  Object.assign(unbound.taxonomies, { transaction });
  // @ts-expect-error Deliberate JavaScript caller without the required transaction.
  await assert.rejects(renameTerm({ deps: unbound, principalId: "actor", termId: "term-1", newName: "After" }),
    { message: "term rename requires a transaction port" });
  assert.equal(f.transactions(), 0);
});

// PARITY: denied callers still fail authorization before reaching any transaction.
test("rename fails closed without a transaction and authorization still runs first", async () => {
  const f = fixture();
  const { transaction, ...unbound } = f.deps;
  // @ts-expect-error Deliberate JavaScript caller without the required transaction.
  await assert.rejects(renameTerm({ deps: unbound, principalId: "actor", termId: "term-1", newName: "After" }),
    { message: "term rename requires a transaction port" });
  assert.deepEqual(f.state().term, f.prior);
  unbound.authorize = async () => ({ allowed: false, reason: "denied" });
  // @ts-expect-error Deliberate JavaScript caller without the required transaction.
  await assert.rejects(renameTerm({ deps: unbound, principalId: "actor", termId: "term-1", newName: "After" }), ForbiddenError);
  assert.equal(f.transactions(), 0);
});
