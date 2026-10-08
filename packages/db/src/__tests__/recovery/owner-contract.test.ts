import assert from "node:assert/strict";
import { test } from "vitest";
import { createOperationLock } from "../../recovery/operation-lock.js";
import { buildRestoreHooks } from "../../recovery/restore-hooks.js";
import { buildMigrateForwardHooks } from "../../recovery/migrate-forward-hooks.js";

const clock = { nowMs: () => Date.parse("2026-10-07T00:00:00.000Z") };
const identity = async ({ principalId }: { principalId: string }) => principalId;

test("one host lock excludes restore and migration, isolated hosts do not share state, and stale holders cannot release a successor", async () => {
  const host = createOperationLock({}, {});
  const otherHost = createOperationLock({}, {});
  const required = { deps: { clock }, input: { siteId: "site", operationKind: "migration" } };
  const [migration, restore] = await Promise.all([
    host.acquireOperationLock(required, {}),
    host.acquireOperationLock({ ...required, input: { siteId: "site", operationKind: "restore" } }, {}),
  ]);
  assert.equal(migration.ok, true);
  if (!migration.ok) throw new Error("migration must acquire first");
  assert.deepEqual(restore, { ok: false, error: { code: "OPERATION_IN_FLIGHT", message: "an operation is already in flight for site 'site'" } });
  assert.equal(host.isOperationInFlight({ siteId: "site" }, {}), true);
  assert.equal(otherHost.isOperationInFlight({ siteId: "site" }, {}), false);
  await host.releaseOperationLock({ deps: { clock }, input: { siteId: "site", handle: migration.value } }, {});
  const successor = await host.acquireOperationLock(required, {});
  assert.equal(successor.ok, true);
  if (!successor.ok) throw new Error("successor must acquire released lock");
  await host.releaseOperationLock({ deps: { clock }, input: { siteId: "site", handle: migration.value } }, {});
  assert.equal(host.isOperationInFlight({ siteId: "site" }, {}), true);
  await host.releaseOperationLock({ deps: { clock }, input: { siteId: "site", handle: successor.value } }, {});
  assert.equal(host.isOperationInFlight({ siteId: "site" }, {}), false);
});

for (const restartRequired of [true, false]) {
  test(`restore uses the supplied plan policy and physical artifact before durable resolution; restartRequired=${restartRequired}`, async () => {
    const trace: unknown[] = [];
    let sequence = 0;
    const hooks = buildRestoreHooks({
      workspaceId: "site", actorId: "operator", restorePointId: "point", clock,
      idGen: { newId: () => `id-${++sequence}` },
      planHashOf: ({ details }) => {
        assert.deepEqual(details, { restorePointId: "point" });
        return "host-verified-hash";
      },
      resolveActorClassIdentity: identity,
      restorePointsRepo: { list: async () => [{ id: "point", createdAt: "before", artifactRef: "/snapshots/point.db" }] },
      dbOps: { restoreFromArtifact: async (input) => { trace.push(["restore", input]); return { restartRequired }; } },
      databaseLedgerRepo: { append: async (row) => { trace.push(["ledger", row]); } },
      migrationRunsRepo: {
        findNonTerminalForSite: async (siteId) => { assert.equal(siteId, "site"); return { id: "interrupted", status: "DDL_IN_PROGRESS" }; },
        markResolved: async (input) => { trace.push(["resolved", input]); },
      },
      siteStatus: { get: async () => "BLOCKED_PENDING_RECOVERY", set: async (siteId, status) => { trace.push(["status", siteId, status]); } },
    }, {});
    assert.equal(hooks.scopeKind, "instance");
    assert.equal(hooks.resolveActorClassIdentity, identity);
    const verified = await hooks.computePlan({});
    assert.deepEqual(verified, { planHash: "host-verified-hash", details: { restorePointId: "point" } });
    assert.deepEqual(trace, []);
    assert.deepEqual(await hooks.executeMutation(verified), { restoreRunId: "id-1", state: "RESTORED", restartRequired });
    assert.deepEqual(trace, [
      ["restore", { artifactRef: "/snapshots/point.db" }],
      ["ledger", { id: "id-2", kind: "restore.executed", restorePointId: "point", outcome: "success",
        detailJson: JSON.stringify({ restoreRunId: "id-1", restartRequired }), actorWorkspaceId: "site", actorId: "operator", createdAt: "2026-10-07T00:00:00.000Z" }],
      ["resolved", { id: "interrupted" }],
      ...(restartRequired ? [] : [["status", "site", "SERVING"]]),
    ]);
  });
}

test("migrate hooks use the supplied hash and fresh capture capabilities, retaining the real artifact and watermark", async () => {
  let capabilityReads = 0;
  let sequence = 0;
  const saved: unknown[] = [];
  const ledger: unknown[] = [];
  const hooks = buildMigrateForwardHooks({
    workspaceId: "site", actorId: "operator", clock, idGen: { newId: () => `id-${++sequence}` },
    planHashOf: ({ details }) => { assert.deepEqual(details, { costClass: "cheap", siteId: "site" }); return "host-verified-hash"; },
    resolveActorClassIdentity: identity,
    dbOps: {
      getCapabilities: async () => ({ restorePoint: { costClass: ++capabilityReads === 1 ? "cheap" : "expensive", kind: "provider-snapshot" } }),
      captureRestorePoint: async (input) => { assert.deepEqual(input, { scopeId: "site" }); return { artifactRef: "/snapshots/captured.db", watermarkAtCapture: 7 }; },
    },
    restorePointsRepo: { save: async (row) => { saved.push(row); } },
    databaseLedgerRepo: { append: async (row) => { ledger.push(row); } },
  }, {});
  assert.equal(hooks.scopeKind, "instance");
  const verified = await hooks.computePlan({});
  assert.deepEqual(await hooks.executeMutation(verified), { migrated: true });
  assert.equal(capabilityReads, 2);
  assert.deepEqual(saved, [{ restorePointId: "id-1", idempotencyKey: "id-1", trigger: "migrate-forward",
    createdAt: "2026-10-07T00:00:00.000Z", createdBy: "operator", costClass: "expensive", kind: "provider-snapshot", watermarkAtCapture: 7, artifactRef: "/snapshots/captured.db" }]);
  assert.deepEqual(ledger, [{ id: "id-2", kind: "core.migration", restorePointId: "id-1", outcome: "success",
    detailJson: '{"artifactRef":"/snapshots/captured.db"}', actorWorkspaceId: "site", actorId: "operator", createdAt: "2026-10-07T00:00:00.000Z" }]);
});
