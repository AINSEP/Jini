import assert from "node:assert/strict";
import { test } from "vitest";
import { createTrashSweep, startTrashSweeper, type TrashSweepReport } from "../sweeper.js";
import { harness, removal, WS, AT } from "./fixture.js";

const claim = { now: "2026-12-01T00:00:00.000Z", leaseOwner: "worker-1", leaseUntil: "2026-12-01T00:05:00.000Z", limit: 50 };
// Generalized from the original sweeper suite: restore wins even without a version column.
test("a restore after claim removes the index before the purge transaction re-read", async () => {
  const h = harness();
  await h.trash.trash(removal);
  const claimDue = h.repo.claimDue.bind(h.repo);
  h.repo.claimDue = async required => {
    const claims = await claimDue(required);
    await h.trash.restore({ workspaceId: WS, entityType: "record", entityId: "record-1", at: AT });
    return claims;
  };
  const report = await createTrashSweep(h.deps)(claim);
  assert.deepEqual(report.results, [{ id: "trash-1", outcome: "not-found" }]);
  assert.equal(h.records.records.get("record-1")!.deletedAt, null);
  assert.equal(h.records.records.get("record-1")!.version, 3);
});
test("version changes and unavailable adapters retain their leases and records", async () => {
  const h = harness();
  await h.trash.trash(removal);
  h.records.records.get("record-1")!.version++;
  const sweep = createTrashSweep(h.deps);
  assert.deepEqual((await sweep(claim)).results, [{ id: "trash-1", outcome: "version-changed" }]);
  assert.equal((await sweep(claim)).claimed, 0);
  h.adapters.clear();
  assert.deepEqual((await sweep({ ...claim, now: "2026-12-01T00:06:00.000Z" })).results, [{ id: "trash-1", outcome: "adapter-unavailable" }]);
  assert.equal(h.repo.all({}).length, 1);
  assert.ok(h.records.records.get("record-1"));
});
test("due rows across workspaces are purged; hard expiry never requires opening the list", async () => {
  const h = harness();
  await h.trash.trash(removal);
  h.records.records.set("record-2", { id: "record-2", workspaceId: "workspace-2", version: 1, updatedAt: AT });
  await h.trash.trash({ ...removal, workspaceId: "workspace-2", entityId: "record-2" });
  const report = await createTrashSweep(h.deps)(claim);
  assert.equal(report.claimed, 2);
  assert.equal(report.purged, 2);
  assert.equal(h.repo.all({}).length, 0);
  assert.equal(h.records.records.size, 0);
});
test("injected timer does not overlap sweeps and stop waits for in-flight work", async () => {
  const scheduled: { delayMs: number; run: () => void }[] = [];
  let finish!: (report: TrashSweepReport) => void;
  let calls = 0;
  const pending = new Promise<TrashSweepReport>(resolve => { finish = resolve; });
  const loop = startTrashSweeper({
    sweep: async () => { calls++; return pending; },
    clock: { nowMs: () => Date.parse(AT)}, leaseOwner: "worker-1",
    scheduler: { schedule(required) { scheduled.push(required); return required; }, cancel() {} },
  }, { batchSize: 1 });
  scheduled.shift()!.run();
  assert.equal(calls, 1);
  assert.equal(scheduled.length, 0);
  let stopped = false;
  const stop = loop.stop({}).then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ claimed: 1, purged: 1, results: [] });
  await stop;
  assert.equal(stopped, true);
  assert.equal(scheduled.length, 0);
});
test("a full batch reschedules immediately and reporting failures retain the idle retry", async () => {
  const scheduled: { delayMs: number; run: () => void }[] = [];
  let calls = 0;
  const loop = startTrashSweeper({
    sweep: async () => {
      if (calls++ === 0) return { claimed: 1, purged: 1, results: [] };
      throw new Error("sweep failed");
    },
    clock: { nowMs: () => Date.parse(AT)}, leaseOwner: "worker-1",
    scheduler: { schedule(required) { scheduled.push(required); return required; }, cancel() {} },
  }, { batchSize: 1, intervalMs: 120, onError: () => { throw new Error("reporter failed"); } });
  scheduled.shift()!.run();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(scheduled[0]!.delayMs, 0);
  scheduled.shift()!.run();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(scheduled[0]!.delayMs, 120);
  await loop.stop({});
});
