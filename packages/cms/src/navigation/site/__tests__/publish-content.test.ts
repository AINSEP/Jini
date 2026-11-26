import { applyRunActor, createRepoPublishHandler } from "../../../publish/content/repo-handler.js";
import { updateMenuTree } from "@jini-ai/cms/navigation/node";
import { expect, it, vi } from "vitest";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { InMemoryMenuRepo, type NavMenuEntry } from "../../index.js";
import { contributeMenusPublish } from "../publish-content.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

it("retries one nested repoint conflict, records the final change set, and leaves an unrelated menu untouched", async () => {
  const nested: NavMenuEntry = { id: "nested", workspaceId: "w", slug: "nested", title: "Nested", status: "published", locations: [], updatedAt: "now", version: 1,
    doc: { type: "menu", version: 1, items: [{ id: "parent", label: "Parent", target: { kind: "url", href: "/" }, children: [{ id: "child", label: "Child", target: { kind: "entryRef", entryId: "old" } }] }] } };
  const untouched: NavMenuEntry = { ...nested, id: "untouched", slug: "untouched", doc: { type: "menu", version: 1, items: [] } };
  const repo = new InMemoryMenuRepo({}, { initialRows: [nested, untouched] });
  const originalFind = repo.findById.bind(repo);
  let reads = 0;
  repo.findById = async input => {
    const row = await originalFind(input);
    if (row && input.id === "nested" && ++reads === 2) { const changed = { ...row, version: row.version + 1 }; await repo.save(changed); return changed; }
    return row;
  };
  const authorize = vi.fn(async () => ({ allowed: true, reason: "grant" }));
  const changeSets = new InMemoryChangeSetRepo();
  const handler = contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "change" },
    ports: { menu: { repo, bindingRepo: {} as never } }, authorize, outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort, changeSets, mutationActor: { id: "owner", kind: "user" } });
  expect(await handler.repointReferences!({ replacements: [{ entityType: "post", oldId: "old", newId: "new" }], skipIds: new Set(), principalId: "owner", runId: "run" })).toEqual({
    changeSetIds: ["change"], linksUpdated: 1, notUpdated: [],
  });
  expect(authorize).toHaveBeenCalledTimes(2);
  const repointed = await originalFind({ workspaceId: "w", id: "nested" });
  expect(repointed?.doc.items.find(item => item.id === "parent")?.children?.find(item => item.id === "child")?.target)
    .toEqual({ kind: "entryRef", entryId: "new" });
  const saved = await changeSets.findById({ workspaceId: "w", id: "change" });
  expect(saved?.items).toHaveLength(1);
  expect(saved?.items[0]).toMatchObject({ entityId: "nested", entityVersionAtApply: 3 });
  expect(saved?.items[0]?.inversePayload).toEqual({ items: nested.doc.items });
  expect(await originalFind({ workspaceId: "w", id: "untouched" })).toEqual(untouched);
});
