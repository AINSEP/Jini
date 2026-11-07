import { expect, test } from "vitest";
import {
  createRevertRegistry,
  InMemoryChangeSetRepo,
  revertChangeSet,
  RevertForbiddenError,
  type ChangeSetRecord,
  type ChangeSetItemRecord,
} from "@jini-ai/cms/core/commands";

test("public commands entry reverts in reverse order and preserves the agent force guard", async () => {
  const record: ChangeSetRecord = {
    id: "change", workspaceId: "workspace", status: "applied", summary: "Update",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const items: ChangeSetItemRecord[] = [0, 1].map(position => ({
    id: `item-${position}`, changeSetId: record.id, entityType: "document", entityId: `doc-${position}`,
    operation: "update", position, entityVersionAtApply: 2, inversePayload: { value: "before" },
  }));
  const applied: string[] = [];
  const repo = new InMemoryChangeSetRepo([record], items);
  const registry = createRevertRegistry({}, {});
  registry.register("document", "update", {
    currentVersion: async () => 2,
    applyInverse: async ({ item }) => { applied.push(item.entityId); },
  });
  const deps = {
    changeSets: repo, registry, clock: { nowMs: () => Date.parse("2026-11-07T01:00:00.000Z") },
    idGen: { newId: () => "event" },
  };
  await expect(revertChangeSet({ deps, input: {
    workspaceId: "workspace", changeSetId: "change", force: true, principalKind: "agent",
  } }, {})).rejects.toBeInstanceOf(RevertForbiddenError);
  expect(applied).toEqual([]);
  expect(await repo.findById({ workspaceId: "other", id: "change" })).toBeNull();
  const reverted = await revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {});
  expect(applied).toEqual(["doc-1", "doc-0"]);
  expect(reverted.status).toBe("reverted");
  expect(reverted.revertedAt).toBe("2026-11-07T01:00:00.000Z");
  expect((await repo.findById({ workspaceId: "workspace", id: "change" }))?.changeSet).toEqual(reverted);
});
