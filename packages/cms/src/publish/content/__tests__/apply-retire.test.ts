import assert from "node:assert/strict";
import { test } from "vitest";

import { applyRetiringRow, type ApplyRetireCollaborators, type ApplyRetireHandler } from "../apply-retire.js";

type Row = { entityType: string; entityId: string; retires: { entityType: string; entityId: string; hash: string }; outcome?: string; reason?: string };
type Entity = { id: string };
type Result = { kind: string; row: Row; changeSetId?: string; retiredChangeSetId?: string };

const row = (): Row => ({ entityType: "page", entityId: "new", retires: { entityType: "page", entityId: "old", hash: "h1" } });

function setup(overrides: { [K in keyof ApplyRetireHandler<Entity, Row["retires"]>]?: ApplyRetireHandler<Entity, Row["retires"]>[K] | undefined } = {}, current: unknown = null) {
  const calls: string[] = [];
  const keys: string[] = [];
  const handler: ApplyRetireHandler<Entity, Row["retires"]> = {
    planRetire: async () => ({ entityId: "old", hash: "h1" }),
    retire: async ({ idempotencyKey }) => {
      calls.push("retire"); keys.push(idempotencyKey);
      return { changeSetId: "cs-retire", undo: async () => { calls.push("undo"); } };
    },
    apply: async ({ idempotencyKey, expectedVersion }) => {
      calls.push("apply"); keys.push(idempotencyKey);
      assert.equal(expectedVersion, undefined);
      return { changeSetId: "cs-apply" };
    },
    ...(overrides as object),
  };
  const applied: unknown[] = [];
  const ctx = {
    principalId: "operator", runId: "run-1",
    recordContentApplied: async (input: unknown) => { calls.push("record"); applied.push(input); },
  };
  const collaborators: ApplyRetireCollaborators<Row, Entity, typeof handler, typeof ctx, Result> = {
    downgradedRow: ({ row: r, outcome, reason }) => ({ kind: "downgraded", row: { ...r, outcome, reason } }),
    downgradeOrRethrow: ({ error, row: r }) => {
      if (error instanceof Error && error.message === "soft") return { kind: "soft", row: r };
      throw error;
    },
    itemIdempotencyKey: ({ entity }) => `item:${entity.id}`,
    refreshBaseline: async () => { calls.push("refresh"); },
    appliedResult: ({ row: r, changeSetId, retiredChangeSetId }) => ({ kind: "applied", row: r, changeSetId, retiredChangeSetId }),
  };
  const step = { row: row(), ctx, key: "page:new", entity: { id: "new" }, handler, current };
  return { calls, keys, applied, collaborators, step };
}

test("a row whose own id appeared at the destination downgrades to conflict before any write", async () => {
  const s = setup({}, { version: 1 });
  const result = await applyRetiringRow({ step: s.step, collaborators: s.collaborators });
  assert.equal(result.kind, "downgraded");
  assert.equal(result.row.outcome, "conflict");
  assert.equal(result.row.reason, "page 'new' was created on the destination between plan and apply");
  assert.deepEqual(s.calls, []);
});

test("a handler without planRetire/retire blocks the row", async () => {
  const s = setup({ planRetire: undefined });
  const result = await applyRetiringRow({ step: s.step, collaborators: s.collaborators });
  assert.equal(result.row.outcome, "blocked");
  assert.match(result.row.reason!, /^internal inconsistency: no planRetire\(\)\/retire\(\) on the page handler/);
  assert.deepEqual(s.calls, []);
});

test("a changed or vanished retire target downgrades to conflict without writing", async () => {
  for (const fresh of [null, { entityId: "old", hash: "h2" }, { entityId: "other", hash: "h1" }]) {
    const s = setup({ planRetire: async () => fresh });
    const result = await applyRetiringRow({ step: s.step, collaborators: s.collaborators });
    assert.equal(result.row.outcome, "conflict");
    assert.equal(result.row.reason, "the live page at this address changed after this run's plan was built");
    assert.deepEqual(s.calls, []);
  }
});

test("retire, then create, then record and refresh; keys are item key and run-scoped retire key", async () => {
  const s = setup();
  const result = await applyRetiringRow({ step: s.step, collaborators: s.collaborators });
  assert.deepEqual(result, { kind: "applied", row: s.step.row, changeSetId: "cs-apply", retiredChangeSetId: "cs-retire" });
  assert.deepEqual(s.calls, ["retire", "apply", "record", "refresh"]);
  assert.deepEqual(s.keys, ["item:new:retire:run-1", "item:new"]);
  assert.deepEqual(s.applied, [{ itemKey: "page:new", changeSetId: "cs-apply", retiredChangeSetId: "cs-retire" }]);
});

test("a failed create puts the retired holder back and then defers to the host downgrade", async () => {
  const s = setup({ apply: async () => { throw new Error("soft"); } });
  const result = await applyRetiringRow({ step: s.step, collaborators: s.collaborators });
  assert.equal(result.kind, "soft");
  assert.deepEqual(s.calls, ["retire", "undo"]);
});

test("a failed retire has nothing to undo and a hard failure is rethrown", async () => {
  const s = setup({ retire: async () => { throw new Error("hard"); } });
  await assert.rejects(applyRetiringRow({ step: s.step, collaborators: s.collaborators }), { message: "hard" });
  assert.deepEqual(s.calls, []);
});

test("when the undo also fails the error names both causes and points at Trash", async () => {
  const s = setup({
    retire: async () => ({ changeSetId: "cs-retire", undo: async () => { throw new Error("undo broke"); } }),
    apply: async () => { throw new Error("create broke"); },
  });
  await assert.rejects(applyRetiringRow({ step: s.step, collaborators: s.collaborators }), {
    message: "page 'new' was not created (create broke), and putting the retired page 'old' back failed too (undo broke) — restore it from Trash",
  });
});

test("accounting failure after both writes lands does not undo anything", async () => {
  const s = setup();
  s.step.ctx.recordContentApplied = async () => { throw new Error("ledger down"); };
  await assert.rejects(applyRetiringRow({ step: s.step, collaborators: s.collaborators }), { message: "ledger down" });
  assert.deepEqual(s.calls, ["retire", "apply"]);
});
