import assert from "node:assert/strict";
import { test } from "vitest";
import { withFollowUps } from "../follow-ups.js";
import { harness, removal, WS, AT, ACTOR, ALLOW_ALL } from "./fixture.js";

// Generalized transactional outcomes from the original follow-ups.test.ts.
test("throwing hide/restore follow-ups roll back both entity state and index", async () => {
  const h = harness();
  const wrapped = withFollowUps({ adapter: h.adapter }, { afterHide: async () => { throw new Error("afterHide"); } });
  h.adapters.set("record", wrapped);
  await assert.rejects(() => h.trash.trash(removal), /afterHide/);
  assert.equal(h.records.records.get("record-1")!.version, 1);
  assert.equal(h.repo.all({}).length, 0);
  h.adapters.set("record", h.adapter);
  await h.trash.trash(removal, { priorMarker: "draft" });
  h.adapters.set("record", withFollowUps({ adapter: h.adapter }, { afterUnhide: async () => { throw new Error("afterUnhide"); } }));
  await assert.rejects(() => h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT }), /afterUnhide/);
  assert.equal(h.records.records.get("record-1")!.version, 2);
  assert.equal(h.records.records.get("record-1")!.deletedAt, AT);
  assert.equal(h.repo.all({}).length, 1);
});
test("follow-ups skip explicit noops, refusals and failed physical deletes", async () => {
  const h = harness();
  let calls = 0;
  const wrapped = withFollowUps({ adapter: { ...h.adapter,
    hide: async () => ({ ok: true, version: 1, noop: true }),
    unhide: async () => ({ ok: false, reason: "version-changed" }),
    purge: async () => "already-gone",
  } }, { afterHide: async () => { calls++; }, afterUnhide: async () => { calls++; }, afterPurge: async () => { calls++; } });
  await wrapped.hide({ workspaceId: WS, entityId: "record-1", at: AT, expectedVersion: 1 });
  await wrapped.unhide({ workspaceId: WS, entityId: "record-1", at: AT, expectedVersion: 1 }, { priorMarker: "draft" });
  await wrapped.purge({ workspaceId: WS, entityId: "record-1", expectedVersion: 1 });
  assert.equal(calls, 0);
});
test("the record adapter marks a repeated hide as a noop so follow-ups fire once", async () => {
  const h = harness();
  let calls = 0;
  h.adapters.set("record", withFollowUps({ adapter: h.adapter }, { afterHide: async () => { calls++; } }));
  await h.trash.trash(removal);
  const repeated = await h.trash.trash({ ...removal, expectedVersion: 2 });
  assert.deepEqual(repeated, { ok: true, version: 2, noop: true });
  assert.equal(calls, 1);
  assert.equal(h.repo.all({}).length, 1);
});
test("before purge sees the record, after purge sees it removed and receives prior state; errors roll back", async () => {
  const h = harness();
  await h.trash.trash(removal);
  const observed: unknown[] = [];
  h.adapters.set("record", withFollowUps({ adapter: h.adapter }, {
    beforePurge: async ({ entityId }) => structuredClone(h.records.records.get(entityId)),
    afterPurge: async ({ entityId, priorState }) => { observed.push(priorState); assert.equal(h.records.records.has(entityId), false); throw new Error("afterPurge"); },
  }));
  await assert.rejects(() => h.trash.purgeSelected({ workspaceId: WS, ids: ["trash-1"], actor: ACTOR, authorizeItem: ALLOW_ALL }), /afterPurge/);
  assert.equal((observed[0] as { version: number }).version, 2);
  assert.equal(h.records.records.get("record-1")!.version, 2);
  assert.equal(h.repo.all({}).length, 1);
});
