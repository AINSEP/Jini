import { createRepoPublishHandler, gatewayDeps } from "../../../publish/content/repo-handler.js";
import { expect, it } from "vitest";
import type { Term } from "../../index.js";
import type { TaxonomyPublishPorts } from "../../publish-ports.js";
import type { PackedEntity } from "../../../publish/transfer/packed-entity.js";
import { contributeTaxonomyPublish, contributeTermPublish } from "../publish-content.js";
import { InMemoryChangeSetRepo } from "../../../forms/__tests__/change-set.fixture.js";
import { InMemoryContentLookup, InMemoryEntryTermRepo, InMemoryTaxonomyRepo, InMemoryTaxonomyRevisionRepo, InMemoryTermRepo } from "../../repo.memory.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

it("packs child-first input parent-first and applies the parent before its child", async () => {
  const rows: Term[] = [{ id: "child", taxonomyId: "taxonomy", parentId: "parent", name: "Child", status: "active", updatedAt: "now", version: 1 },
    { id: "parent", taxonomyId: "taxonomy", parentId: null, name: "Parent", status: "active", updatedAt: "now", version: 1 }];
  const destination = new Map<string, Term>();
  const writes: string[] = [];
  const ports = { taxonomies: { list: async () => [{ id: "taxonomy" }], findById: async () => ({ id: "taxonomy", hierarchical: true, status: "active" }) },
    terms: { listByTaxonomy: async () => rows, findAnyById: async ({ id }: { id: string }) => destination.get(id) ?? null,
      findByIdFull: async ({ id }: { id: string }) => destination.get(id) ?? null, findById: async ({ id }: { id: string }) => destination.get(id) ?? null,
      getParentId: ({ termId }: { termId: string }) => destination.get(termId)?.parentId ?? null,
      insert: async (term: Term) => { writes.push(term.id); destination.set(term.id, term); } },
    revisions: { insert: async () => {} }, stampWatermark: () => {} } as unknown as TaxonomyPublishPorts;
  const handler = contributeTermPublish({ createRepoPublishHandler, gatewayDeps }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "event" }, ports: { term: ports },
    authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort, mutationActor: { id: "owner", kind: "user" }, changeSets: new InMemoryChangeSetRepo() });
  const packed: PackedEntity[] = [];
  for await (const entity of handler.pack()) packed.push(entity);
  expect(packed.map(entity => entity.id)).toEqual(["parent", "child"]);
  for (const entity of packed) await handler.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: entity.id });
  expect(writes).toEqual(["parent", "child"]);
  expect(destination.get("child")?.parentId).toBe("parent");
});

it("taxonomy publish carries the original ID and hierarchy flag, and blocks a held destination name", async () => {
  const source = new InMemoryTaxonomyRepo();
  const destination = new InMemoryTaxonomyRepo();
  const row = { id: "topics", name: "Topics", hierarchical: true, status: "active" as const, updatedAt: "source", version: 9 };
  await source.insert(row);
  await source.insert({ ...row, id: "discarded", status: "trash" });
  await destination.insert({ ...row, id: "overlap" });
  const deps = {
    workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "event" },
    authorize: async () => ({ allowed: true, reason: "grant" }),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort,
    changeSets: new InMemoryChangeSetRepo(), mutationActor: { id: "owner", kind: "user" as const },
  };
  const terms = new InMemoryTermRepo();
  const entryTerms = new InMemoryEntryTermRepo();
  const ports = (taxonomies: InMemoryTaxonomyRepo): TaxonomyPublishPorts => ({
    taxonomies: Object.assign(taxonomies, { findAnyById: taxonomies.findByIdFull.bind(taxonomies) }),
    terms: Object.assign(terms, { findAnyById: terms.findByIdFull.bind(terms) }),
    entryTerms: Object.assign(entryTerms, { listForContent: async () => [] }),
    revisions: new InMemoryTaxonomyRevisionRepo(), stampWatermark: () => {},
    contentLookup: new InMemoryContentLookup({}), contentTypeTaxonomyPolicy: { taxonomiesFor: async () => null },
  });
  const contribution = contributeTaxonomyPublish({ createRepoPublishHandler, gatewayDeps });
  const from = contribution.build({ ...deps, ports: { taxonomy: ports(source) } });
  const to = contribution.build({ ...deps, ports: { taxonomy: ports(destination) } });
  const packed: PackedEntity[] = [];
  for await (const entity of from.pack()) packed.push(entity);
  expect(packed.map(entity => ({ id: entity.id, state: entity.state }))).toEqual([{ id: "topics", state: { name: "Topics", hierarchical: true } }]);
  const entity = packed[0]!;
  expect(await to.precheck({ entity })).toContain("overlap");
  expect(await destination.findByIdFull({ id: "topics" })).toBeNull();
  await destination.delete({ id: "overlap" });
  expect(await to.precheck({ entity })).toBeNull();
  await to.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: "topics" });
  expect(await destination.findByIdFull({ id: "topics" })).toEqual({
    id: "topics", name: "Topics", hierarchical: true, status: "active", updatedAt: "1970-01-01T00:00:00.000Z", version: 1,
  });
});

it("term precheck looks for name collisions only among siblings and references the exact parent", async () => {
  const rows: Term[] = [
    { id: "wrong-parent", parentId: "another", taxonomyId: "topics", name: "Camera", status: "active", updatedAt: "now", version: 1 },
    { id: "right-parent", parentId: "equipment", taxonomyId: "topics", name: "Camera", status: "active", updatedAt: "now", version: 1 },
  ];
  const ports = { terms: {
    listByTaxonomy: async ({ taxonomyId }: { taxonomyId: string }) => rows.filter(row => row.taxonomyId === taxonomyId),
    findAnyById: async () => null,
  } } as unknown as TaxonomyPublishPorts;
  const handler = contributeTermPublish({ createRepoPublishHandler, gatewayDeps }).build({
    workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: { term: ports },
  });
  const entity: PackedEntity = { entityType: "term", id: "incoming", schemaVersion: 1, hashVersion: 1, contentHash: "fixture", requiredBlobs: [],
    state: { taxonomyId: "topics", parentId: "equipment", name: "Camera" } };
  expect(handler.references?.({ entity })).toEqual([{ entityType: "taxonomy", key: "topics" }, { entityType: "term", key: "equipment" }]);
  const collision = await handler.precheck({ entity });
  expect(collision).toContain("right-parent");
  expect(collision).not.toContain("wrong-parent");
  const root = { ...entity, state: { taxonomyId: "topics", name: "Camera", parentId: null } };
  expect(handler.references?.({ entity: root })).toEqual([{ entityType: "taxonomy", key: "topics" }]);
  expect(await handler.precheck({ entity: root })).toBeNull();
});
