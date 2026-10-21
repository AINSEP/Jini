import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryWorkspaceRepo } from "../repo.memory.js";

/** Behaviour of the in-memory `WorkspaceRepoPort` adapter that slice tests rely on. */

const first = { id: "first", name: "First", slug: "first", createdAt: "t0" };

test("update replaces the matching row and never inserts a row for an unknown id", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: [first] });
  await repo.update({ id: "ghost", name: "Ghost", slug: "ghost", createdAt: "t1" });
  assert.deepEqual(await repo.list(), [first]);
  await repo.update({ ...first, name: "Renamed" });
  assert.deepEqual(await repo.list(), [{ ...first, name: "Renamed" }]);
});

test("the constructor copies initialRows so later caller mutation does not leak in", async () => {
  const initialRows = [first];
  const repo = new InMemoryWorkspaceRepo({}, { initialRows });
  initialRows.push({ id: "second", name: "Second", slug: "second", createdAt: "t0" });
  assert.deepEqual(await repo.list(), [first]);
  assert.deepEqual(await new InMemoryWorkspaceRepo({}).list(), []);
});
