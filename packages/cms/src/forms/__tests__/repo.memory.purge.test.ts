import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryFormSubmissionRepo } from "../repo.memory.js";

test("form purge enumeration includes trashed answers, is tenant scoped and returns independent copies", async () => {
  const repo = new InMemoryFormSubmissionRepo();
  const row = { id: "answer", workspaceId: "ws-1", formDefinitionId: "form-1", data: { message: "Answer" }, sourceIp: null, submittedAt: "2026-10-01T00:00:00Z" };
  await repo.create(row);
  await repo.create({ ...row, id: "other-form", formDefinitionId: "form-2" });
  await repo.create({ ...row, id: "other-workspace", workspaceId: "ws-2" });
  const stored = (await repo.findAnyById({ workspaceId: "ws-1", id: "answer" }))!;
  await repo.save({ ...stored, deletedAt: "2026-10-02T00:00:00Z" });
  assert.deepEqual((await repo.listByDefinition({ workspaceId: "ws-1", formDefinitionId: "form-1", limit: 10 })).items, []);
  const all = await repo.listAllForDefinition({ workspaceId: "ws-1", formDefinitionId: "form-1" });
  assert.deepEqual(all.map(answer => answer.id), ["answer"]);
  all[0]!.data.message = "Changed copy";
  assert.equal((await repo.findAnyById({ workspaceId: "ws-1", id: "answer" }))!.data.message, "Answer");
  await repo.deleteAllForDefinition({ workspaceId: "ws-1", formDefinitionId: "form-1" });
  assert.deepEqual(await repo.listAllForDefinition({ workspaceId: "ws-1", formDefinitionId: "form-1" }), []);
  assert.ok(await repo.findById({ workspaceId: "ws-1", id: "other-form" }));
  assert.ok(await repo.findById({ workspaceId: "ws-2", id: "other-workspace" }));
});
