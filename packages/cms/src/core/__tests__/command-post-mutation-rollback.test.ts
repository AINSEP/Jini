import assert from "node:assert/strict";
import { test } from "vitest";
import { DuplicateCommandError, executeCommand, type ExecuteCommandDeps, type CommandMutation } from "../commands/command.js";

function fixture(failAt: "version" | "clock" | "id" | "insert" | "none" = "none") {
  let value = "before";
  let rollbacks = 0;
  const records: unknown[] = [];
  const error = new Error(`injected ${failAt}`);
  const deps: ExecuteCommandDeps = {
    clock: { nowMs: () => { if (failAt === "clock") throw error; return Date.parse("2026-10-02T00:00:00.000Z"); } },
    idGen: { newId: () => { if (failAt === "id") throw error; return `id-${records.length}`; } },
    changeSets: {
      insert: async (required, optional) => { if (failAt === "insert") throw error; records.push({ required, optional }); },
      findById: async () => null, findByIdempotencyKey: async () => null,
      listByWorkspace: async () => [], save: async () => {},
    },
  };
  const mutation: CommandMutation<{ version: number }> = {
    entityType: "entry", entityId: "entity-1", operation: "update",
    captureInverse: async () => ({ value }),
    execute: async () => { value = "after"; return { version: 2 }; },
    captureEntityVersion: ({ result }) => { if (failAt === "version") throw error; return result.version; },
    rollback: async () => { rollbacks++; value = "before"; },
  };
  const command = { workspaceId: "ws-1", actor: { id: "actor", kind: "user" as const }, summary: "Update" };
  return { deps, mutation, command, error, records, value: () => value, rollbacks: () => rollbacks };
}

for (const failAt of ["version", "clock", "id", "insert"] as const) {
  test(`a post-mutation ${failAt} failure rolls back before returning the original error`, async () => {
    const f = fixture(failAt);
    await assert.rejects(executeCommand(f), (error) => error === f.error);
    assert.equal(f.value(), "before");
    assert.equal(f.rollbacks(), 1);
    assert.deepEqual(f.records, []);
  });
}

test("without optional rollback a post-mutation failure leaves the applied mutation and still rejects", async () => {
  const f = fixture("version");
  delete f.mutation.rollback;
  await assert.rejects(executeCommand(f), (error) => error === f.error);
  assert.equal(f.value(), "after");
  assert.deepEqual(f.records, []);
});

test("a successful command captures the applied version, records it, and does not roll back", async () => {
  const f = fixture();
  assert.deepEqual(await executeCommand(f), { result: { version: 2 }, changeSetId: "id-0" });
  assert.equal(f.value(), "after");
  assert.equal(f.rollbacks(), 0);
  assert.equal(f.records.length, 1);
  const record = f.records[0] as { required: { items: Array<{ entityVersionAtApply: number }> } };
  assert.equal(record.required.items[0]!.entityVersionAtApply, 2);
});

test("a version-capture error resembling a unique constraint is not misreported as a duplicate command", async () => {
  const f = fixture("version");
  Object.assign(f.error, { code: "SQLITE_CONSTRAINT_UNIQUE" });
  const command = { ...f.command, idempotencyKey: "key" };
  let queries = 0;
  f.deps.changeSets.findByIdempotencyKey = async () => {
    queries++;
    return null;
  };
  await assert.rejects(executeCommand({ ...f, command }), (error) => error === f.error);
  assert.equal(queries, 1, "only the pre-mutation check should query idempotency");
  assert.equal(f.value(), "before");
});

test("a real insert unique conflict still rolls back and reports the winning command", async () => {
  const f = fixture("insert");
  Object.assign(f.error, { code: "SQLITE_CONSTRAINT_UNIQUE" });
  let queries = 0;
  f.deps.changeSets.findByIdempotencyKey = async () => ++queries === 1 ? null : {
    id: "winner", workspaceId: "ws-1", status: "applied", summary: "Prior", createdAt: "t0",
  };
  await assert.rejects(executeCommand({ ...f, command: { ...f.command, idempotencyKey: "key" } }),
    (error) => error instanceof DuplicateCommandError && error.changeSetId === "winner" &&
      error.message === "command with idempotency key 'key' was already executed");
  assert.equal(f.value(), "before");
  assert.equal(f.rollbacks(), 1);
  assert.equal(queries, 2);
});

test("a rollback rejection takes precedence over a post-mutation capture failure", async () => {
  const f = fixture("version");
  const rollbackError = new Error("rollback failed");
  f.mutation.rollback = async () => { throw rollbackError; };
  await assert.rejects(executeCommand(f), (error) => error === rollbackError);
  assert.equal(f.value(), "after");
  assert.deepEqual(f.records, []);
});
