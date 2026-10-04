import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryTrashRepo } from "../repo.memory.js";
import type { TrashItem, TrashRepoPort } from "../ports.js";

/** The same port assertions as host SQL adapters: ordering, expiry, keysets and leases must agree. */
const WS = "workspace-1";
const WS2 = "workspace-2";

function item(overrides: Partial<TrashItem> & Pick<TrashItem, "id" | "entityId">): TrashItem {
  return {
    workspaceId: WS,
    entityType: "post",
    trashedAt: "2026-09-01T00:00:00.000Z",
    purgeAfter: "2026-10-31T00:00:00.000Z",
    actorPrincipalId: "principal-1",
    actorPluginId: null,
    displayTitle: "A post",
    displaySubtitle: "a-post",
    entityVersion: 3,
    priorMarker: null,
    ...overrides,
  };
}

function runSuite(adapterName: string, makeRepo: () => TrashRepoPort) {
  // PARITY
  test(`[${adapterName}] insert is idempotent on (workspace, entity_type, entity_id) — re-trashing never duplicates`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "t1", entityId: "post-1" }) });
    await repo.insert({ row: item({ id: "t2", entityId: "post-1", displayTitle: "Second attempt" }) });

    const page = await repo.list({ workspaceId: WS, now: "2026-09-02T00:00:00.000Z", limit: 50 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.id, "t1");
    assert.equal(page.items[0]?.displayTitle, "A post", "the first row wins; the second is ignored, not merged");
  });

  // PARITY
  test(`[${adapterName}] list hides expired rows the instant it opens, with no sweeper involved`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "live", entityId: "post-1", purgeAfter: "2026-12-01T00:00:00.000Z" }) });
    await repo.insert({ row: item({ id: "expired", entityId: "post-2", purgeAfter: "2026-09-01T00:00:00.000Z" }) });

    const page = await repo.list({ workspaceId: WS, now: "2026-09-02T00:00:00.000Z", limit: 50 });
    assert.deepEqual(page.items.map((i) => i.id), ["live"]);
  });

  // PARITY
  test(`[${adapterName}] list is workspace-scoped, newest first, and filterable by entity type`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "a", entityId: "post-1", trashedAt: "2026-09-01T00:00:00.000Z" }) });
    await repo.insert({ row: item({ id: "b", entityId: "red-1", entityType: "redirect", trashedAt: "2026-09-03T00:00:00.000Z" }) });
    await repo.insert({ row: item({ id: "c", entityId: "post-9", workspaceId: WS2 }) });

    const all = await repo.list({ workspaceId: WS, now: "2026-09-04T00:00:00.000Z", limit: 50 });
    assert.deepEqual(all.items.map((i) => i.id), ["b", "a"]);

    const posts = await repo.list({ workspaceId: WS, now: "2026-09-04T00:00:00.000Z", limit: 50}, { entityTypes: ["post"]});
    assert.deepEqual(posts.items.map((i) => i.id), ["a"]);
  });

  // PARITY
  test(`[${adapterName}] keyset pagination walks every row exactly once`, async () => {
    const repo = makeRepo();
    for (let n = 1; n <= 5; n += 1) {
      await repo.insert({ row: item({ id: `t${n}`, entityId: `post-${n}`, trashedAt: `2026-09-0${n}T00:00:00.000Z` }) });
    }
    for (const id of ["t2a", "t2c", "t2b", "t2d"]) {
      await repo.insert({ row: item({ id, entityId: `post-${id}`, trashedAt: "2026-09-02T00:00:00.000Z" }) });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: TrashItem[]; nextCursor: string | null } = await repo.list({
        workspaceId: WS,
        now: "2026-09-10T00:00:00.000Z",
        limit: 2}, {
        cursor});
      seen.push(...page.items.map((i) => i.id));
      assert.ok(page.items.length <= 2);
      assert.ok(seen.length <= 9, "pagination must terminate without repeating rows");
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ["t5", "t4", "t3", "t2d", "t2c", "t2b", "t2a", "t2", "t1"]);
  });

  // PARITY
  test(`[${adapterName}] claimDue takes only due, unleased rows — and a second claimer gets nothing`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "due", entityId: "post-1", purgeAfter: "2026-09-01T00:00:00.000Z" }) });
    await repo.insert({ row: item({ id: "not-due", entityId: "post-2", purgeAfter: "2026-12-01T00:00:00.000Z" }) });

    const first = await repo.claimDue({
      now: "2026-09-02T00:00:00.000Z",
      leaseOwner: "sweeper-a",
      leaseUntil: "2026-09-02T00:05:00.000Z",
      limit: 10,
    });
    assert.deepEqual(first.map((c) => c.id), ["due"]);

    const second = await repo.claimDue({
      now: "2026-09-02T00:01:00.000Z",
      leaseOwner: "sweeper-b",
      leaseUntil: "2026-09-02T00:06:00.000Z",
      limit: 10,
    });
    assert.deepEqual(second, [], "a live lease keeps a second sweeper off the row");
  });

  // PARITY
  test(`[${adapterName}] an expired lease is reclaimable — this is the crash recovery`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "due", entityId: "post-1", purgeAfter: "2026-09-01T00:00:00.000Z" }) });
    await repo.claimDue({ now: "2026-09-02T00:00:00.000Z", leaseOwner: "crashed", leaseUntil: "2026-09-02T00:05:00.000Z", limit: 10 });

    const reclaimed = await repo.claimDue({
      now: "2026-09-02T00:06:00.000Z",
      leaseOwner: "sweeper-b",
      leaseUntil: "2026-09-02T00:11:00.000Z",
      limit: 10,
    });
    assert.deepEqual(reclaimed.map((c) => c.id), ["due"]);
  });

  // PARITY
  test(`[${adapterName}] claimDue includes the exact expiry boundary and respects the batch limit`, async () => {
    const repo = makeRepo();
    const now = "2026-09-02T00:00:00.000Z";
    await repo.insert({ row: item({ id: "earlier", entityId: "post-earlier", purgeAfter: "2026-09-01T00:00:00.000Z" }) });
    await repo.insert({ row: item({ id: "boundary", entityId: "post-boundary", purgeAfter: now }) });
    await repo.insert({ row: item({ id: "later", entityId: "post-later", purgeAfter: "2026-09-02T00:00:00.001Z" }) });
    const args = { now, leaseOwner: "a", leaseUntil: "2026-09-02T00:05:00.000Z", limit: 1 };
    assert.deepEqual((await repo.claimDue(args)).map((row) => row.id), ["earlier"]);
    assert.deepEqual((await repo.claimDue(args)).map((row) => row.id), ["boundary"]);
    assert.deepEqual(await repo.claimDue(args), []);
  });

  // PARITY
  test(`[${adapterName}] releaseLease hands a stood-down row back to the next pass`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "due", entityId: "post-1", purgeAfter: "2026-09-01T00:00:00.000Z" }) });
    await repo.claimDue({ now: "2026-09-02T00:00:00.000Z", leaseOwner: "a", leaseUntil: "2026-09-02T00:05:00.000Z", limit: 10 });
    await repo.releaseLease({ id: "due" });

    const again = await repo.claimDue({ now: "2026-09-02T00:01:00.000Z", leaseOwner: "b", leaseUntil: "2026-09-02T00:06:00.000Z", limit: 10 });
    assert.deepEqual(again.map((c) => c.id), ["due"]);
  });

  // PARITY
  test(`[${adapterName}] findByIds and deleteById are workspace-scoped`, async () => {
    const repo = makeRepo();
    await repo.insert({ row: item({ id: "mine", entityId: "post-1" }) });
    await repo.insert({ row: item({ id: "theirs", entityId: "post-2", workspaceId: WS2 }) });

    assert.deepEqual((await repo.findByIds({ workspaceId: WS, ids: ["mine", "theirs"] })).map((r) => r.id), ["mine"]);

    await repo.deleteById({ workspaceId: WS, id: "theirs" });
    assert.notEqual(await repo.findByEntity({ workspaceId: WS2, entityType: "post", entityId: "post-2" }), null);
  });
}


runSuite("InMemoryTrashRepo", () => new InMemoryTrashRepo({}));
