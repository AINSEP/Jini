import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";
import { buildWorkspaceRegistrations } from "../tool-registrations.js";

const seed = { id: "ws", name: "Original", slug: "original", createdAt: "t0", version: 1 };

function context(input: unknown): ToolExecutionContext {
  return { executionId: "exec", principal: { id: "editor" }, run: { id: "run" }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

test("workspace tools expose the version and reject missing or stale editor bases", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: [seed] });
  const registrations = buildWorkspaceRegistrations({
    workspaceId: "ws", workspaceRepo: repo, authorize: async () => ({ allowed: true, reason: "ok" }),
  });
  const read = registrations.find((item) => item.descriptor.id === "workspace_get");
  const write = registrations.find((item) => item.descriptor.id === "workspace_update");
  assert.ok(read && write);
  assert.deepEqual(await read.handler(context({})), { workspace: seed });
  await assert.rejects(write.handler(context({ name: "Missing" })), /workspace_get/);
  const first = await write.handler(context({ name: "First", expectedVersion: 1 }));
  assert.deepEqual(first, { workspace: { ...seed, name: "First", version: 2 } });
  await assert.rejects(write.handler(context({ name: "Second", expectedVersion: 1 })), (error: unknown) =>
    error instanceof RecordVersionConflictError && error.currentVersion === 2);
  assert.equal((await repo.findById({ id: "ws" }))?.name, "First");
});

test("a host can name its published workspace read tool in version guidance", async () => {
  const repo = new InMemoryWorkspaceRepo({}, { initialRows: [seed] });
  const registrations = buildWorkspaceRegistrations({
    workspaceId: "ws", workspaceRepo: repo, authorize: async () => ({ allowed: true, reason: "ok" }),
  }, { readToolId: "content_read.workspace" });
  const write = registrations.find((item) => item.descriptor.id === "workspace_update");
  assert.ok(write);
  await assert.rejects(write.handler(context({ name: "Missing" })), /content_read\.workspace/);
});
