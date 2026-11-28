import { applyRunActor, createRepoPublishHandler } from "../../../publish/content/repo-handler.js";
import { updateMenuTree } from "@jini-ai/cms/navigation/node";
import { expect, it, vi } from "vitest";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo, type NavMenuEntry } from "../../index.js";
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

it("publishes a scoped menu, assigns its bound locations and reports nested page references", async () => {
  const repo = new InMemoryMenuRepo({});
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  const enqueue = vi.fn<OutboxPort["enqueue"]>();
  let n = 0;
  const deps = { workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => `event-${++n}` },
    ports: { menu: { repo, bindingRepo } }, outbox: { enqueue, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } };
  const handler = contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build(deps);
  const state = { slug: "primary", title: "Primary navigation", status: "published", locations: ["header"],
    doc: { type: "menu", version: 1, items: [{ id: "parent", label: "Parent", target: { kind: "url", href: "/" },
      children: [{ id: "child", label: "Booking", target: { kind: "entryRef", entryId: "page-7" } }] }] },
  };
  const entity = { entityType: "menu", id: "primary-id", schemaVersion: 1, hashVersion: 1, requiredBlobs: [], contentHash: "hash", state };
  expect(await handler.precheck({ entity })).toBeNull();
  await handler.apply({ entity, expectedVersion: undefined, principalId: "editor", idempotencyKey: "publish-navigation" });
  expect(await repo.findById({ workspaceId: "w", id: "primary-id" })).toEqual({
    ...state, id: "primary-id", workspaceId: "w", version: 1, updatedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(await bindingRepo.findByLocation({ workspaceId: "w", locationKey: "header" })).toEqual({
    workspaceId: "w", locationKey: "header", menuId: "primary-id", boundAt: "1970-01-01T00:00:00.000Z",
  });
  expect(await handler.referencesTo!({ ids: ["other", "page-7"] })).toEqual([
    { entityType: "menu", entityId: "primary-id", entityLabel: "Primary navigation", referencedId: "page-7" },
  ]);
  expect(enqueue.mock.calls.map(([event]) => [event.aggregateId, event.payload])).toEqual([
    ["primary-id", { menuId: "primary-id", slug: "primary" }],
    ["primary-id", { locationKey: "header", menuId: "primary-id" }],
  ]);
});

it("precheck reports the invalid menu tree and an unwired apply leaves no menu or binding", async () => {
  const repo = new InMemoryMenuRepo({});
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  const handler = contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build({
    workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: { menu: { repo, bindingRepo } },
  });
  const entity = { entityType: "menu", id: "primary-id", schemaVersion: 1, hashVersion: 1, requiredBlobs: [], contentHash: "hash",
    state: { slug: "primary", title: "Primary navigation", status: "published", doc: { type: "menu", version: 1, items: [] } },
  };
  const item = { id: "twice", label: "First", target: { kind: "url", href: "/" } };
  const invalid = { ...entity, state: { ...entity.state, doc: { ...entity.state.doc, items: [item, { ...item, label: "Second" }] } } };
  expect(await handler.precheck({ entity: invalid })).toMatch(/duplicate.*twice/i);
  await expect(handler.apply({ entity, expectedVersion: undefined, principalId: "editor", idempotencyKey: "publish-navigation" }))
    .rejects.toThrow("menu.apply() requires PublishContentDeps.outbox");
  expect(await repo.list({ workspaceId: "w" })).toEqual([]);
  expect(await bindingRepo.listByWorkspace({ workspaceId: "w" })).toEqual([]);
});

function repointFixture({ bumpOnEvenReads = false, authorize = vi.fn(async () => ({ allowed: true, reason: "grant" })), wired = true }: {
  bumpOnEvenReads?: boolean; authorize?: () => Promise<{ allowed: boolean; reason: string }>; wired?: boolean;
} = {}) {
  const menu: NavMenuEntry = { id: "nested", workspaceId: "w", slug: "nested", title: "Nested", status: "published", locations: [], updatedAt: "now", version: 1,
    doc: { type: "menu", version: 1, items: [{ id: "child", label: "Child", target: { kind: "entryRef", entryId: "old" } }] } };
  const repo = new InMemoryMenuRepo({}, { initialRows: [menu] });
  const originalFind = repo.findById.bind(repo);
  let reads = 0;
  repo.findById = async input => {
    const row = await originalFind(input);
    if (row && bumpOnEvenReads && ++reads % 2 === 0) { const changed = { ...row, version: row.version + 1 }; await repo.save(changed); return changed; }
    return row;
  };
  const outbox = { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort;
  const handler = contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "change" },
    ports: { menu: { repo, bindingRepo: {} as never } }, ...(wired ? { authorize, outbox, changeSets: new InMemoryChangeSetRepo() } : {}), mutationActor: { id: "owner", kind: "user" } });
  const repoint = () => handler.repointReferences!({ replacements: [{ entityType: "post", oldId: "old", newId: "new" }], skipIds: new Set(), principalId: "owner", runId: "run" });
  return { repoint, originalFind, menu };
}

it("a second repoint conflict reports the menu as not updated instead of failing the publish", async () => {
  const { repoint, originalFind, menu } = repointFixture({ bumpOnEvenReads: true });
  expect(await repoint()).toEqual({ changeSetIds: [], linksUpdated: 0, notUpdated: ["Menu 'Nested' was not updated: it changed during publish."] });
  expect((await originalFind({ workspaceId: "w", id: "nested" }))?.doc.items).toEqual(menu.doc.items);
});

it("a grant that does not cover menus is reported, while any other authorization fault is rethrown", async () => {
  const denied = repointFixture({ authorize: async () => ({ allowed: false, reason: "no menus" }) });
  expect(await denied.repoint()).toEqual({ changeSetIds: [], linksUpdated: 0,
    notUpdated: ["Menu links were not updated: this publishing grant doesn't cover menus."] });
  expect((await denied.originalFind({ workspaceId: "w", id: "nested" }))?.doc.items).toEqual(denied.menu.doc.items);
  const faulty = repointFixture({ authorize: async () => { throw new Error("grant store offline"); } });
  await expect(faulty.repoint()).rejects.toThrow("grant store offline");
});

it("repointing without the change-set, authorization and outbox ports is a named wiring error", async () => {
  const { repoint, originalFind, menu } = repointFixture({ wired: false });
  await expect(repoint()).rejects.toThrow("publish-content: menu.repointReferences() requires PublishContentDeps.ports.menu.repo, .changeSets, .authorize and .outbox");
  expect(await originalFind({ workspaceId: "w", id: "nested" })).toEqual(menu);
});

function wiredMenuHandler({ repo, changeSets = new InMemoryChangeSetRepo() }: { repo: InMemoryMenuRepo; changeSets?: InMemoryChangeSetRepo }) {
  const outbox = { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort;
  return contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "change" },
    ports: { menu: { repo, bindingRepo: new InMemoryNavLocationBindingRepo({}) } }, authorize: async () => ({ allowed: true, reason: "grant" }), outbox, changeSets,
    mutationActor: { id: "owner", kind: "user" } });
}

const linkedMenu: NavMenuEntry = { id: "nested", workspaceId: "w", slug: "nested", title: "Nested", status: "published", locations: [], updatedAt: "now", version: 1,
  doc: { type: "menu", version: 1, items: [{ id: "child", label: "Child", target: { kind: "entryRef", entryId: "old" } }] } };
const replaceOld = { replacements: [{ entityType: "post" as const, oldId: "old", newId: "new" }], skipIds: new Set<string>(), principalId: "owner", runId: "run" };

it("a change-set record that fails after the repoint landed puts the prior tree back and surfaces the fault", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [linkedMenu] });
  const changeSets = new InMemoryChangeSetRepo();
  changeSets.insert = async () => { throw new Error("ledger offline"); };
  await expect(wiredMenuHandler({ repo, changeSets }).repointReferences!(replaceOld)).rejects.toThrow("ledger offline");
  const restored = await repo.findById({ workspaceId: "w", id: "nested" });
  expect(restored?.doc.items).toEqual(linkedMenu.doc.items);
  // written at version 2 by the repoint, then rolled back under OCC against that version
  expect(restored?.version).toBe(3);
});

it("a menu that vanished, or was already repointed by a peer, after the snapshot is skipped without a write", async () => {
  for (const fresh of [null, { ...linkedMenu, doc: { ...linkedMenu.doc, items: [{ id: "child", label: "Child", target: { kind: "entryRef" as const, entryId: "new" } }] } }]) {
    const repo = new InMemoryMenuRepo({}, { initialRows: [linkedMenu] });
    const insert = vi.fn();
    const changeSets = new InMemoryChangeSetRepo();
    changeSets.insert = insert;
    repo.findById = async () => fresh;
    expect(await wiredMenuHandler({ repo, changeSets }).repointReferences!(replaceOld)).toEqual({ changeSetIds: [], linksUpdated: 0, notUpdated: [] });
    expect(insert).not.toHaveBeenCalled();
    expect((await repo.list({ workspaceId: "w" }))[0]).toEqual(linkedMenu);
  }
});

it("packs every live menu with its transferred state and leaves a trashed menu out", async () => {
  const trashed: NavMenuEntry = { ...linkedMenu, id: "binned", slug: "binned", title: "Binned", status: "trash" };
  const repo = new InMemoryMenuRepo({}, { initialRows: [linkedMenu, trashed] });
  const packed = [];
  for await (const entity of wiredMenuHandler({ repo }).pack()) packed.push(entity);
  expect(packed.map(entity => [entity.id, entity.state])).toEqual([
    ["nested", { slug: "nested", title: "Nested", status: "published", doc: linkedMenu.doc, locations: [] }],
  ]);
});

it("an update apply carries the expected version and a state without locations clears them", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [{ ...linkedMenu, locations: ["header"] }] });
  const handler = wiredMenuHandler({ repo });
  const state = { slug: "nested", title: "Renamed", status: "published", doc: linkedMenu.doc };
  const entity = { entityType: "menu", id: "nested", schemaVersion: 1, hashVersion: 1, requiredBlobs: [], contentHash: "hash", state };
  await expect(handler.apply({ entity, expectedVersion: 7, principalId: "editor", idempotencyKey: "stale" })).rejects.toMatchObject({ name: "PublishContentApplyRowError", rowOutcome: "conflict" });
  expect((await repo.findById({ workspaceId: "w", id: "nested" }))?.title).toBe("Nested");
  await handler.apply({ entity, expectedVersion: 1, principalId: "editor", idempotencyKey: "fresh" });
  expect(await repo.findById({ workspaceId: "w", id: "nested" })).toMatchObject({ title: "Renamed", locations: [], version: 2 });
});

it("finding references without a wired menu repo reports no holders", async () => {
  const handler = contributeMenusPublish({ createRepoPublishHandler, updateMenuTree, applyRunActor }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: {} });
  expect(await handler.referencesTo!({ ids: ["old"] })).toEqual([]);
});
