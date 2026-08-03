import assert from "node:assert/strict";
import { test } from "vitest";

import { WorkspaceConflictError, WorkspaceNotFoundError, WorkspaceValidationError } from "../create.js";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";
import { updateWorkspace } from "../update.js";

/**
 * Specification tests for SPEC-044 REQ-04 (`UPDATE_WORKSPACE`) — AC-05, EC-01, EC-02.
 */
test("updateWorkspace renames name and persists it (AC-05)", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "Old Name", slug: "old-slug", createdAt: "t0" }]);

  const { workspace } = await updateWorkspace({ deps: { repo }, input: { id: "ws-1", name: "New Name" } });

  assert.equal(workspace.name, "New Name");
  assert.equal(workspace.slug, "old-slug", "slug is unchanged when not provided");
  const stored = await repo.findById("ws-1");
  assert.equal(stored?.name, "New Name");
});

test("updateWorkspace rejects a slug colliding with a different workspace row (AC-05)", async () => {
  const repo = new InMemoryWorkspaceRepo([
    { id: "ws-1", name: "A", slug: "a-slug", createdAt: "t0" },
    { id: "ws-2", name: "B", slug: "b-slug", createdAt: "t0" },
  ]);

  await assert.rejects(
    () => updateWorkspace({ deps: { repo }, input: { id: "ws-1", slug: "b-slug" } }),
    WorkspaceConflictError
  );
  const stored = await repo.findById("ws-1");
  assert.equal(stored?.slug, "a-slug", "no change on conflict");
});

test("updateWorkspace accepts a slug identical to the workspace's own current slug (EC-02)", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "A", slug: "a-slug", createdAt: "t0" }]);

  const { workspace } = await updateWorkspace({ deps: { repo }, input: { id: "ws-1", slug: "a-slug" } });
  assert.equal(workspace.slug, "a-slug");
});

test("updateWorkspace rejects an invalid slug pattern", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "A", slug: "a-slug", createdAt: "t0" }]);

  await assert.rejects(
    () => updateWorkspace({ deps: { repo }, input: { id: "ws-1", slug: "Not A Slug" } }),
    WorkspaceValidationError
  );
});

test("updateWorkspace rejects an empty-object update (EC-01, no name and no slug)", async () => {
  const repo = new InMemoryWorkspaceRepo([{ id: "ws-1", name: "A", slug: "a-slug", createdAt: "t0" }]);

  await assert.rejects(() => updateWorkspace({ deps: { repo }, input: { id: "ws-1" } }), WorkspaceValidationError);
});

test("updateWorkspace throws WorkspaceNotFoundError for an unknown id", async () => {
  const repo = new InMemoryWorkspaceRepo([]);

  await assert.rejects(
    () => updateWorkspace({ deps: { repo }, input: { id: "missing", name: "X" } }),
    WorkspaceNotFoundError
  );
});
