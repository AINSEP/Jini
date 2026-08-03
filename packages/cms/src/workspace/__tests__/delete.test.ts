import assert from "node:assert/strict";
import { test } from "vitest";

import { WorkspaceLastRemainingError, WorkspaceNotFoundError } from "../create.js";
import { deleteWorkspace } from "../delete.js";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";

/**
 * Specification tests for SPEC-044 REQ-05/INV-03 (`DELETE_WORKSPACE`) — AC-06, EC-04-adjacent
 * (EC-04's :workspaceId-mismatch case is a route-layer 404, exercised in the HTTP integration
 * suite; these tests cover the domain-level guard directly).
 */
test("deleteWorkspace refuses to delete the install's only workspace (AC-06, INV-03)", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "Only", slug: "only", createdAt: "t0" }]);

  await assert.rejects(
    () => deleteWorkspace({ deps: { repo }, input: { id: "ws-1" } }),
    WorkspaceLastRemainingError
  );
  assert.ok(await repo.findById("ws-1"), "the row is not deleted");
});

test("deleteWorkspace succeeds when a second workspace row exists", async () => {
  const repo = new InMemoryWorkspaceRepo([
    { id: "ws-1", name: "First", slug: "first", createdAt: "t0" },
    { id: "ws-2", name: "Second", slug: "second", createdAt: "t0" },
  ]);

  await deleteWorkspace({ deps: { repo }, input: { id: "ws-1" } });

  assert.equal(await repo.findById("ws-1"), null);
  assert.ok(await repo.findById("ws-2"), "the other row is untouched");
});

test("deleteWorkspace throws WorkspaceNotFoundError for an unknown id", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "Only", slug: "only", createdAt: "t0" }]);

  await assert.rejects(() => deleteWorkspace({ deps: { repo }, input: { id: "missing" } }), WorkspaceNotFoundError);
});
