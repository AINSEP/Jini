import assert from "node:assert/strict";
import { test } from "vitest";

import * as taxonomy from "../index.js";
import {
  InMemoryContentLookup,
  InMemoryEntryTermRepo,
  InMemoryTaxonomyRepo,
  InMemoryTaxonomyRevisionRepo,
  InMemoryTermRepo,
  noopStampWatermark,
  toTaxonomyOutbox,
} from "../repo.memory.js";
import type { Taxonomy, Term, WriteServiceDeps } from "../write-service.js";

/**
 * @file The in-memory taxonomy adapters — the dev/test persistence a hermetic host composes. Each
 * adapter is tested against the port contract it claims (`write-service.ts`/`list.ts`), and the
 * last group drives the real write-service chokepoints through the package's public barrel so the
 * adapters are proven to satisfy those chokepoints end to end, not just individually.
 */

const T0 = "2026-10-01T00:00:00.000Z";

function taxonomyRow(overrides: Partial<Taxonomy> = {}): Taxonomy {
  return { id: "tx-1", name: "Category", hierarchical: true, status: "active", updatedAt: T0, version: 1, ...overrides };
}

function termRow(overrides: Partial<Term> = {}): Term {
  return { id: "t-1", taxonomyId: "tx-1", parentId: null, name: "News", status: "active", updatedAt: T0, version: 1, ...overrides };
}

test("InMemoryTaxonomyRepo: findById narrows to {id, hierarchical}; findByIdFull returns the whole row; unknown ids are null", async () => {
  const repo = new InMemoryTaxonomyRepo();
  await repo.insert(taxonomyRow());

  assert.deepEqual(await repo.findById({ id: "tx-1" }), { id: "tx-1", hierarchical: true });
  assert.deepEqual(await repo.findByIdFull({ id: "tx-1" }), taxonomyRow());
  assert.equal(await repo.findById({ id: "nope" }), null);
  assert.equal(await repo.findByIdFull({ id: "nope" }), null);
});

test("InMemoryTaxonomyRepo: stored rows are copies — mutating an inserted or returned object never changes the store", async () => {
  const repo = new InMemoryTaxonomyRepo();
  const row = taxonomyRow();
  await repo.insert(row);
  row.name = "mutated after insert";

  const listed = await repo.list();
  listed[0]!.name = "mutated after list";
  const full = await repo.findByIdFull({ id: "tx-1" });
  full!.name = "mutated after read";

  assert.equal((await repo.findByIdFull({ id: "tx-1" }))!.name, "Category");
});

test("InMemoryTaxonomyRepo: update writes in place (same id), list returns every row, delete removes one", async () => {
  const repo = new InMemoryTaxonomyRepo();
  await repo.insert(taxonomyRow());
  await repo.insert(taxonomyRow({ id: "tx-2", name: "Tag", hierarchical: false }));
  await repo.update(taxonomyRow({ name: "Categories", version: 2 }));

  assert.deepEqual(
    (await repo.list()).map((r) => [r.id, r.name, r.version]),
    [["tx-1", "Categories", 2], ["tx-2", "Tag", 1]]
  );

  await repo.delete({ id: "tx-1" });
  assert.deepEqual((await repo.list()).map((r) => r.id), ["tx-2"]);
});

test("InMemoryTaxonomyRepo: transaction runs fn once and resolves with its result (no rollback primitive, by disclosure)", async () => {
  const repo = new InMemoryTaxonomyRepo();
  let runs = 0;
  const result = await repo.transaction({ fn: async () => { runs += 1; return "done"; } });
  assert.equal(result, "done");
  assert.equal(runs, 1);
});

test("InMemoryTermRepo: findById narrows, findByIdFull copies, update replaces, delete removes", async () => {
  const repo = new InMemoryTermRepo();
  await repo.insert(termRow());

  assert.deepEqual(await repo.findById({ id: "t-1" }), { id: "t-1", taxonomyId: "tx-1", name: "News" });
  assert.equal(await repo.findById({ id: "nope" }), null);
  assert.equal(await repo.findByIdFull({ id: "nope" }), null);

  await repo.update(termRow({ name: "Breaking", version: 2 }));
  assert.deepEqual(await repo.findByIdFull({ id: "t-1" }), termRow({ name: "Breaking", version: 2 }));

  await repo.delete({ id: "t-1" });
  assert.equal(await repo.findById({ id: "t-1" }), null);
});

test("InMemoryTermRepo: listByTaxonomy returns only that taxonomy's terms", async () => {
  const repo = new InMemoryTermRepo();
  await repo.insert(termRow({ id: "a", taxonomyId: "tx-1" }));
  await repo.insert(termRow({ id: "b", taxonomyId: "tx-2" }));
  await repo.insert(termRow({ id: "c", taxonomyId: "tx-1" }));

  assert.deepEqual((await repo.listByTaxonomy({ taxonomyId: "tx-1" })).map((t) => t.id), ["a", "c"]);
  assert.deepEqual(await repo.listByTaxonomy({ taxonomyId: "tx-9" }), []);
});

test("InMemoryTermRepo: getParentId walks one level up, null for a root or an unknown term", async () => {
  const repo = new InMemoryTermRepo();
  await repo.insert(termRow({ id: "root" }));
  await repo.insert(termRow({ id: "child", parentId: "root" }));

  assert.equal(repo.getParentId({ termId: "child" }), "root");
  assert.equal(repo.getParentId({ termId: "root" }), null);
  assert.equal(repo.getParentId({ termId: "missing" }), null);
});

test("InMemoryTermRepo: countChildren counts direct children only, never grandchildren", async () => {
  const repo = new InMemoryTermRepo();
  await repo.insert(termRow({ id: "root" }));
  await repo.insert(termRow({ id: "c1", parentId: "root" }));
  await repo.insert(termRow({ id: "c2", parentId: "root" }));
  await repo.insert(termRow({ id: "g1", parentId: "c1" }));

  assert.equal(await repo.countChildren({ parentId: "root" }), 2);
  assert.equal(await repo.countChildren({ parentId: "c1" }), 1);
  assert.equal(await repo.countChildren({ parentId: "g1" }), 0);
});

test("InMemoryEntryTermRepo: upsert is idempotent per (contentType, contentId, termId), replacing addedAt", async () => {
  const repo = new InMemoryEntryTermRepo();
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t1", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t1", addedAt: "2026-10-02T00:00:00.000Z" });
  await repo.upsert({ contentType: "page", contentId: "p1", termId: "t1", addedAt: T0 });

  assert.equal(await repo.countByTerm({ termId: "t1" }), 2);
});

test("InMemoryEntryTermRepo: deleteByContent removes only that content's rows and returns the removed count", async () => {
  const repo = new InMemoryEntryTermRepo();
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t1", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t2", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p2", termId: "t1", addedAt: T0 });
  await repo.upsert({ contentType: "page", contentId: "p1", termId: "t1", addedAt: T0 });

  assert.equal(await repo.deleteByContent({ workspaceId: "w", contentType: "post", contentId: "p1" }), 2);
  assert.equal(await repo.deleteByContent({ workspaceId: "w", contentType: "post", contentId: "p1" }), 0);
  assert.equal(await repo.countByTerm({ termId: "t1" }), 2);
  assert.equal(await repo.countByTerm({ termId: "t2" }), 0);
});

test("InMemoryEntryTermRepo: countOverlap counts content assigned to BOTH terms, keyed by contentType as well as id", async () => {
  const repo = new InMemoryEntryTermRepo();
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "from", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "into", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p2", termId: "from", addedAt: T0 });
  // Same id, different content type: NOT an overlap.
  await repo.upsert({ contentType: "page", contentId: "p2", termId: "into", addedAt: T0 });

  assert.equal(await repo.countOverlap({ fromTermId: "from", intoTermId: "into" }), 1);
});

test("InMemoryEntryTermRepo: repointTerm moves every 'from' row onto 'into', deduplicating overlaps", async () => {
  const repo = new InMemoryEntryTermRepo();
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "from", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "into", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p2", termId: "from", addedAt: T0 });

  assert.deepEqual(await repo.repointTerm({ fromTermId: "from", intoTermId: "into" }), { repointedCount: 2 });
  assert.equal(await repo.countByTerm({ termId: "from" }), 0);
  // p1's overlap collapsed into one row: the pre-merge loss mergeTerm's plan discloses.
  assert.equal(await repo.countByTerm({ termId: "into" }), 2);
});

test("InMemoryEntryTermRepo: remove deletes exactly one assignment and reports 1, or 0 for a no-op", async () => {
  const repo = new InMemoryEntryTermRepo();
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t1", addedAt: T0 });
  await repo.upsert({ contentType: "post", contentId: "p1", termId: "t2", addedAt: T0 });

  assert.equal(await repo.remove({ contentType: "post", contentId: "p1", termId: "t1" }), 1);
  assert.equal(await repo.remove({ contentType: "post", contentId: "p1", termId: "t1" }), 0);
  assert.equal(await repo.countByTerm({ termId: "t2" }), 1);
});

test("InMemoryTaxonomyRevisionRepo: insert appends rows in order", async () => {
  const repo = new InMemoryTaxonomyRevisionRepo();
  await repo.insert({ taxonomyId: "tx-1", op: "create", previousState: null, actorId: "u", recordedAt: T0 });
  await repo.insert({ taxonomyId: "tx-1", op: "rename", previousState: { name: "a" }, actorId: "u", recordedAt: T0 });
  assert.deepEqual(repo.rows.map((r) => r.op), ["create", "rename"]);
});

test("InMemoryContentLookup: resolves seeded and set rows by (contentType, contentId); unknown pairs are null", async () => {
  const lookup = new InMemoryContentLookup({}, { seed: [{ contentType: "post", contentId: "p1", workspaceId: "w", kind: "post" }] });
  lookup.set({ contentType: "page", contentId: "p1", value: { workspaceId: "w", kind: "page" } });

  assert.deepEqual(await lookup.resolve({ contentType: "post", contentId: "p1" }), { workspaceId: "w", kind: "post" });
  assert.deepEqual(await lookup.resolve({ contentType: "page", contentId: "p1" }), { workspaceId: "w", kind: "page" });
  assert.equal(await lookup.resolve({ contentType: "post", contentId: "p2" }), null);
  assert.equal(await new InMemoryContentLookup({}).resolve({ contentType: "post", contentId: "p1" }), null);
});

test("noopStampWatermark: returns nothing and accepts the stamp call shape", () => {
  assert.equal(noopStampWatermark(), undefined);
});

test("toTaxonomyOutbox: forwards a well-formed event's own name/occurredAt and stamps the bound workspace and a fresh id", async () => {
  const enqueued: unknown[] = [];
  const outbox = toTaxonomyOutbox({
    outbox: { async enqueue(event) { enqueued.push(event); } },
    clock: { nowMs: () => Date.parse("2026-10-05T00:00:00.000Z") },
    idGen: { newId: () => "evt-1" },
    workspaceId: "ws-1",
  });

  const event = { name: "taxonomy.created", taxonomyId: "tx-1", actorId: "u", occurredAt: T0 };
  await outbox.enqueue({ event });

  assert.deepEqual(enqueued, [{ id: "evt-1", workspaceId: "ws-1", name: "taxonomy.created", occurredAt: T0, payload: event }]);
});

test("toTaxonomyOutbox: an event without string name/occurredAt falls back to 'taxonomy.event' and the clock's now", async () => {
  const enqueued: Array<{ name: string; occurredAt: string }> = [];
  const outbox = toTaxonomyOutbox({
    outbox: { async enqueue(event) { enqueued.push(event); } },
    clock: { nowMs: () => Date.parse("2026-10-05T00:00:00.000Z") },
    idGen: { newId: () => "evt-2" },
    workspaceId: "ws-1",
  });

  await outbox.enqueue({ event: { name: 42, occurredAt: null } });

  assert.equal(enqueued[0]!.name, "taxonomy.event");
  assert.equal(enqueued[0]!.occurredAt, "2026-10-05T00:00:00.000Z");
});

test("public barrel: the in-memory adapters compose with the real write-service chokepoints end to end", async () => {
  const taxonomies = new taxonomy.InMemoryTaxonomyRepo();
  const terms = new taxonomy.InMemoryTermRepo();
  const entryTerms = new taxonomy.InMemoryEntryTermRepo();
  const revisions = new taxonomy.InMemoryTaxonomyRevisionRepo();
  const events: unknown[] = [];
  let nextId = 0;
  const deps: WriteServiceDeps = {
    authorize: async () => ({ allowed: true, reason: "test" }),
    clock: { nowMs: () => Date.parse(T0) },
    idGen: { newId: () => `id-${++nextId}` },
    taxonomies,
    terms,
    entryTerms,
    revisions,
    stampWatermark: taxonomy.noopStampWatermark,
    outbox: { enqueue: async ({ event }) => { events.push(event); } },
    workspaceId: "ws-1",
    contentLookup: new taxonomy.InMemoryContentLookup({}, { seed: [{ contentType: "post", contentId: "p1", workspaceId: "ws-1", kind: "post" }] }),
  };

  const category = await taxonomy.createTaxonomy({ deps, principalId: "u", name: "Category", hierarchical: true });
  const parent = await taxonomy.createTerm({ deps, principalId: "u", taxonomyId: category.id, name: "News" });
  const child = await taxonomy.createTerm({ deps, principalId: "u", taxonomyId: category.id, name: "Local" }, { parentId: parent.id });
  await taxonomy.assignTerms({ deps, principalId: "u", contentType: "post", contentId: "p1", termIds: [child.id] });

  const deleteDeps = { ...deps, terms, entryTerms, transaction: taxonomies.transaction.bind(taxonomies) };
  await assert.rejects(taxonomy.deleteTerm({ deps: deleteDeps, principalId: "u", termId: parent.id }), taxonomy.TermHasChildTermsError);
  await assert.rejects(taxonomy.deleteTerm({ deps: deleteDeps, principalId: "u", termId: child.id }), taxonomy.TermHasAssignedContentError);

  const listed = await taxonomy.listTaxonomiesWithTerms({ taxonomies, terms });
  assert.deepEqual(
    listed.items.map((item) => [item.taxonomy.name, item.terms.map((t) => [t.name, t.parentId])]),
    [["Category", [["News", null], ["Local", parent.id]]]]
  );
  assert.deepEqual(revisions.rows.map((r) => r.op), ["create", "create", "create"]);
  assert.equal(events.length, 4);
});
