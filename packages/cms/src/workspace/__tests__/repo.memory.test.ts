import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";

import { InMemoryWorkspaceRepo } from "../repo.memory.js";

/** Behaviour of the in-memory `WorkspaceRepoPort` adapter that slice tests rely on. */

const first = { id: "first", name: "First", slug: "first", createdAt: "t0", version: 1 };

test("update replaces the matching row and never inserts a row for an unknown id", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: [first] });
  await repo.update({ id: "ghost", name: "Ghost", slug: "ghost", createdAt: "t1", version: 1 });
  assert.deepEqual(await repo.list(), [first]);
  await repo.update({ ...first, name: "Renamed" });
  assert.deepEqual(await repo.list(), [{ ...first, name: "Renamed" }]);
});

test("the constructor copies initialRows so later caller mutation does not leak in", async () => {
  const initialRows = [first];
  const repo = new InMemoryWorkspaceRepo({}, { initialRows });
  initialRows.push({ id: "second", name: "Second", slug: "second", createdAt: "t0", version: 1 });
  assert.deepEqual(await repo.list(), [first]);
  assert.deepEqual(await new InMemoryWorkspaceRepo({}).list(), []);
});

test("a guarded update reports a deleted workspace without recreating it", async () => {
  const other = { id: "second", name: "Second", slug: "second", createdAt: "t0", version: 3 };
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: [first, other] });
  await repo.delete({ id: first.id });
  await assert.rejects(
    repo.update({ ...first, name: "Stale rename", version: 2 }, { expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.recordKind === "workspace" &&
      error.recordId === "first" && error.expectedVersion === 1 && error.currentVersion === null,
  );
  assert.equal(await repo.findById({ id: "first" }), null);
  assert.deepEqual(await repo.findById({ id: "second" }), other);
});
