import { expect, it } from "vitest";
import type { Term } from "../../index.js";
import type { TaxonomyPublishPorts } from "../../publish-ports.js";
import type { PackedEntity } from "../../../publish/transfer/packed-entity.js";
import { contributeTermPublish } from "../publish-content.js";

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
  const handler = contributeTermPublish().build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "event" }, ports: { term: ports },
    authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {} }, mutationActor: { id: "owner", kind: "user" } });
  const packed: PackedEntity[] = [];
  for await (const entity of handler.pack()) packed.push(entity);
  expect(packed.map(entity => entity.id)).toEqual(["parent", "child"]);
  for (const entity of packed) await handler.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: entity.id });
  expect(writes).toEqual(["parent", "child"]);
  expect(destination.get("child")?.parentId).toBe("parent");
});
