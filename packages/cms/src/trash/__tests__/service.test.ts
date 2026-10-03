import assert from "node:assert/strict";
import { test } from "vitest";
import { harness, removal, WS, AT, ACTOR, ALLOW_ALL } from "./fixture.js";
import { createTrashService, computePurgeAfter, bindRemoveEntity, bindForgetRemovedEntity, TrashAdapterMissingError } from "../write-service.js";

// Generalized from trash.contract, prior-marker.contract and on-changed.contract suites.
test("hide and restore never parse or rewrite the entity payload; listing uses the snapshot", async () => {
  const h = harness();
  assert.deepEqual(await h.trash.trash(removal), { ok: true, version: 2 });
  assert.equal(h.records.records.get("record-1")!.bodyJson, "{corrupt");
  assert.equal((await h.trash.list({ workspaceId: WS, now: AT, limit: 10 })).items[0]!.displayTitle, "Snapshot title");
  assert.equal(await h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT }), "restored");
  assert.equal(h.records.records.get("record-1")!.bodyJson, "{corrupt");
  assert.equal(h.records.records.get("record-1")!.version, 3);
  assert.equal(h.repo.all({}).length, 0);
});
test("index insert failure rolls back the marker flip", async () => {
  const h = harness();
  h.repo.insert = async () => { throw new Error("disk full"); };
  await assert.rejects(() => h.trash.trash(removal), /disk full/);
  assert.equal(h.records.records.get("record-1")!.version, 1);
  assert.equal(h.records.records.get("record-1")!.deletedAt, undefined);
  assert.equal(h.repo.all({}).length, 0);
});
test("domain removal may enter an existing transaction", async () => {
  const h = harness();
  const remove = bindRemoveEntity({ trash: h.trash, entityType: "record" });
  await h.deps.transaction({ work: () => remove({ workspaceId: WS, id: "record-1", actor: ACTOR, display: removal.display, at: AT, expectedVersion: 1 }) });
  assert.equal(h.records.records.get("record-1")!.version, 2);
  assert.equal(h.repo.all({}).length, 1);
});
test("missing adapters list snapshots but degrade on restore and purge; adapters resolve per call", async () => {
  const h = harness();
  await h.trash.trash(removal);
  h.adapters.clear();
  assert.equal((await h.trash.list({ workspaceId: WS, now: AT, limit: 10 })).items.length, 1);
  assert.equal(await h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT }), "adapter-unavailable");
  assert.deepEqual((await h.trash.purgeSelected({ workspaceId: WS, ids: ["trash-1"], actor: ACTOR, authorizeItem: ALLOW_ALL })).results, [{ id: "trash-1", outcome: "adapter-unavailable" }]);
  await assert.rejects(() => h.trash.trash(removal), TrashAdapterMissingError);
  h.adapters.set("record", h.adapter);
  assert.equal(await h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT }), "restored");
});
test("authorization receives stored rows and gates destruction before adapter resolution", async () => {
  const h = harness();
  await h.trash.trash(removal);
  h.adapters.clear();
  const seen: string[] = [];
  const report = await h.trash.purgeSelected({ workspaceId: WS, ids: ["trash-1", "unknown"], actor: ACTOR,
    authorizeItem: async ({ item }) => { seen.push(item.entityType); return false; } });
  assert.deepEqual(seen, ["record"]);
  assert.deepEqual(report.results, [{ id: "trash-1", outcome: "forbidden" }, { id: "unknown", outcome: "not-found" }]);
  assert.equal(h.repo.all({}).length, 1);
  assert.ok(h.records.records.get("record-1"));
});
test("a stale version stands down and preserves the index; vanished rows remove only the index", async () => {
  const h = harness();
  await h.trash.trash(removal);
  h.records.records.get("record-1")!.version++;
  const input = { workspaceId: WS, ids: ["trash-1"], actor: ACTOR, authorizeItem: ALLOW_ALL };
  assert.equal((await h.trash.purgeSelected(input)).results[0]!.outcome, "version-changed");
  assert.equal(h.repo.all({}).length, 1);
  h.records.records.delete("record-1");
  assert.equal((await h.trash.purgeSelected(input)).results[0]!.outcome, "already-gone");
  assert.equal(h.repo.all({}).length, 0);
});
test("notifications are in arg 2 and cannot undo a mutation when reporting fails", async () => {
  const seen: string[] = [];
  const h = harness({ onChanged: async event => { seen.push(event.change); throw new Error("notifier failed"); }, onError: () => { throw new Error("reporter failed"); } });
  await h.trash.trash(removal);
  await h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT });
  await h.trash.trash({ ...removal, expectedVersion: 3 });
  assert.equal((await h.trash.purgeSelected({ workspaceId: WS, ids: ["trash-2"], actor: ACTOR, authorizeItem: ALLOW_ALL })).purged, 1);
  assert.deepEqual(seen, ["trash", "restore", "trash", "purge"]);
  assert.equal(h.records.records.size, 0);
});
test("retention and entity policy are host-owned and evaluated at the operation", async () => {
  const h = harness();
  const short = createTrashService(h.deps, { retentionDays: 2 });
  await short.trash(removal);
  assert.equal(h.repo.all({})[0]!.purgeAfter, "2026-09-22T12:00:00.000Z");
  assert.equal((await short.list({ workspaceId: WS, now: "2026-09-22T12:00:00.000Z", limit: 10 })).items.length, 0);
  assert.equal(computePurgeAfter({ at: AT }, { retentionDays: 60 }), "2026-11-19T12:00:00.000Z");
  const denied = createTrashService({ ...h.deps, entityPolicy: () => false });
  await assert.rejects(() => denied.trash(removal), TrashAdapterMissingError);
  assert.throws(() => computePurgeAfter({ at: "invalid" }, { retentionDays: 60 }), RangeError);
});
test("prior marker from the adapter wins; fallback and index-only cleanup remain available", async () => {
  const h = harness();
  h.adapters.set("record", { ...h.adapter, hide: async () => ({ ok: true, version: 2, priorMarker: "draft" }) });
  await h.trash.trash(removal, { priorMarker: "published" });
  assert.equal(h.repo.all({})[0]!.priorMarker, "draft");
  await bindForgetRemovedEntity({ repo: h.repo, entityType: "record" })({ workspaceId: WS, id: "record-1" });
  assert.equal(h.repo.all({}).length, 0);
});
