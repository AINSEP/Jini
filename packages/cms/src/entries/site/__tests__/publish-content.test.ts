import { expect, test, vi } from "vitest";
import { InMemoryEntryRepo, type EntryRecord } from "../../index.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { contributeCollectionEntryPublish } from "../publish-content.js";

const row: EntryRecord = { id: "entry", workspaceId: "site", type: "recipe", slug: "soup", title: "Soup", status: "draft",
  fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null, createdAt: "now", updatedAt: "now", version: 1 };
const entity = { entityType: "collection-entry", id: "entry", schemaVersion: 2, hashVersion: 1, contentHash: "hash", requiredBlobs: [], state: { ...row } };

async function fixture() {
  const entries = new InMemoryEntryRepo();
  const contentTypes = new InMemoryContentTypeRepo();
  await contentTypes.save({ workspaceId: "site", key: "recipe", label: "Recipes", fields: [], status: "active", version: 1, tombstonedAt: null });
  const save = vi.spyOn(entries, "save");
  const authorize = vi.fn(async (_input: { permission: string }) => ({ allowed: true, reason: "grant" }));
  const terms = { entryTerms: { listForContent: async () => [] }, terms: { findAnyById: vi.fn(async () => null) } };
  const ports = { entries: Object.assign(entries, {
    findAnyById: async (input: { workspaceId: string; id: string }) => { const found = await entries.findById(input); return found && { ...found, deletedAt: null }; },
    findAnyBySlug: vi.fn(async () => null),
    listByWorkspaceExcludingTypes: vi.fn(async ({ excludeTypes }: { excludeTypes: readonly string[] }) => (await entries.listByWorkspace({ workspaceId: "site" })).filter(entry => !excludeTypes.includes(entry.type))),
  }), contentTypes, terms };
  const deps = { workspaceId: "site", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, mutationActor: { id: "human", kind: "user" },
    authorize, changeSets: {}, outbox: { enqueue: vi.fn() }, ports: { "collection-entry": ports } };
  const handler = contributeCollectionEntryPublish({ excludedTypes: ["widget", "widget_area"] }).build(deps as unknown as Parameters<ReturnType<typeof contributeCollectionEntryPublish>["build"]>[0]);
  return { entries, contentTypes, ports, terms, save, authorize, handler };
}

test("export excludes the injected types and preserves schema version 2", async () => {
  const f = await fixture();
  await f.entries.save(row);
  await f.entries.save({ ...row, id: "widget", type: "widget" });
  await f.entries.save({ ...row, id: "area", type: "widget_area" });
  const packed = [];
  for await (const item of f.handler.pack()) packed.push(item);
  expect(packed.map(item => [item.id, item.schemaVersion])).toEqual([["entry", 2]]);
  expect(f.ports.entries.listByWorkspaceExcludingTypes).toHaveBeenCalledWith({ workspaceId: "site", excludeTypes: ["widget", "widget_area"] });
});

test("excluded types are refused at precheck and apply with no entry write", async () => {
  const f = await fixture();
  const inbound = { ...entity, state: { ...entity.state, type: "widget_area" } };
  expect(await f.handler.precheck({ entity: inbound })).toContain("publishes on its own");
  await expect(f.handler.apply({ entity: inbound, expectedVersion: undefined, principalId: "human", idempotencyKey: "excluded" })).rejects.toThrow("publishes on its own");
  expect(f.save).not.toHaveBeenCalled();
});

test("a tombstoned owner blocks precheck while a missing owner may arrive in the bundle", async () => {
  const f = await fixture();
  await f.contentTypes.save({ workspaceId: "site", key: "recipe", label: "Recipes", fields: [], status: "tombstone", version: 2, tombstonedAt: "now" });
  expect(await f.handler.precheck({ entity })).toBe("content-type 'recipe' is permanently removed at this destination and cannot be republished over");
  expect(await f.handler.precheck({ entity: { ...entity, state: { ...entity.state, type: "missing" } } })).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});

test("missing or unauthorized terms cause no entry write", async () => {
  for (const denied of [false, true]) {
    const f = await fixture();
    f.authorize.mockImplementation(async input => ({ allowed: !(denied && input.permission === "admin.taxonomy.manage"), reason: "grant" }));
    await expect(f.handler.apply({ entity: { ...entity, state: { ...entity.state, termIds: ["missing"] } }, expectedVersion: undefined, principalId: "human", idempotencyKey: "terms" })).rejects.toThrow(denied ? "need 'admin.taxonomy.manage'" : "missing");
    expect(f.save).not.toHaveBeenCalled();
    expect(await f.entries.findById({ workspaceId: "site", id: "entry" })).toBeNull();
  }
});
