import assert from "node:assert/strict";
import { test } from "vitest";

import type { Clock } from "@jini-ai/core/primitives";

import {
  confirmRestore,
  type ConfirmRestoreRequired,
  executeRestore,
  type ExecuteRestoreOperationLockPort,
  type ExecuteRestoreRequired,
  planRestore,
  type PlanRestoreRequired,
} from "../../recovery/recovery-orchestrator.js";
import { createOperationLock } from "../../recovery/operation-lock.js";

/**
 * @file The restore ceremony's three separate steps and the binding rules each layers around the
 * injected gateway: a fresh cost-class recheck, a strict acknowledgment gate, and the shared site
 * lock held across execute and always released.
 */

const clock: Clock = { nowMs: () => Date.parse("2026-10-21T08:00:00.000Z") };

test("plan rechecks the cost class on every call and never reaches the gateway once it is unavailable", async () => {
  const costClasses: Array<"cheap" | "expensive" | "unavailable"> = ["expensive", "unavailable"];
  let reads = 0;
  const planned: unknown[] = [];
  const required: PlanRestoreRequired = {
    deps: {
      dbOps: { getCapabilities: async () => ({ costClass: costClasses[reads++] ?? "cheap", restorePointKind: "sqlite-file" }) },
      gateway: { plan: async (input: unknown) => (planned.push(input), { ok: true as const, value: { planId: "plan-1" } }) },
    },
    input: { principalId: "user-1", principalKind: "user", restorePointId: "rp1" },
  };

  assert.deepEqual(await planRestore(required), { ok: true, value: { planId: "plan-1" } });
  assert.deepEqual(await planRestore(required, {}), {
    ok: false,
    error: { code: "COST_CLASS_UNAVAILABLE", message: "restore point 'rp1' has no available restore mechanism for this site (no attestation override)" },
  });
  assert.deepEqual(planned, [{ principalId: "user-1", principalKind: "user", restorePointId: "rp1", costClass: "expensive" }]);
  assert.equal(reads, 2);
});

test("confirm mints nothing unless the disclosure acknowledgment is exactly true", async () => {
  const confirmed: unknown[] = [];
  const deps = { gateway: { confirm: async (input: unknown) => (confirmed.push(input), { ok: true as const, value: { token: "t-1" } }) } };
  // A request body is untyped JSON: a truthy non-boolean must not pass for `true`.
  const fromJson: ConfirmRestoreRequired["input"][] = [
    JSON.parse('{"principalId":"u","principalKind":"user","planId":"p","planHash":"h","disclosureAcknowledged":"true"}'),
    JSON.parse('{"principalId":"u","principalKind":"user","planId":"p","planHash":"h","disclosureAcknowledged":1}'),
    { principalId: "u", principalKind: "user", planId: "p", planHash: "h", disclosureAcknowledged: false },
  ];
  for (const input of fromJson) {
    assert.deepEqual(await confirmRestore({ deps, input }), {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "disclosureAcknowledged must be exactly true before a restore confirmation token may be minted" },
    });
  }
  assert.deepEqual(confirmed, []);

  const accepted = await confirmRestore({ deps, input: { principalId: "u", principalKind: "user", planId: "p", planHash: "h", disclosureAcknowledged: true } }, {});
  assert.deepEqual(accepted, { ok: true, value: { token: "t-1" } });
  assert.deepEqual(confirmed, [{ planId: "p", planHash: "h" }], "only the plan's id and hash reach the gateway");
});

type GatewayResult = Awaited<ReturnType<ExecuteRestoreRequired["deps"]["gateway"]["execute"]>>;

function executeHarness(result: () => Promise<GatewayResult>, lock: ExecuteRestoreOperationLockPort = createOperationLock({})) {
  const executed: unknown[] = [];
  let pendingCleared = 0;
  const deps: ExecuteRestoreRequired["deps"] = {
    gateway: {
      execute: async (input) => {
        executed.push(input);
        return result();
      },
    },
    operationLock: lock,
    clock,
    pendingMigrationTracker: {
      clearPendingMigration: async () => {
        pendingCleared += 1;
      },
    },
  };
  return { deps, executed, cleared: () => pendingCleared };
}

const userInput = { principalId: "user-1", principalKind: "user" as const, confirmationToken: "tok", siteId: "site" };

test("a RESTORED execute attaches the deep link back to the Database Timeline, and never clears PENDING_MIGRATION", async () => {
  const lock = createOperationLock({});
  const h = executeHarness(async () => {
    assert.equal(lock.isOperationInFlight({ siteId: "site" }), true, "the site lock is held while the gateway executes");
    return { ok: true, value: { restoreRunId: "run-1", state: "RESTORED", restartRequired: true } };
  }, lock);

  assert.deepEqual(await executeRestore({ deps: h.deps, input: userInput }), {
    ok: true,
    value: { restoreRunId: "run-1", state: "RESTORED", restartRequired: true, databaseTimelineDeepLink: { v: 1, siteId: "site", intent: "view" } },
  });
  assert.deepEqual(h.executed, [{ confirmationToken: "tok", confirmerPrincipalId: "user-1" }]);
  assert.equal(h.cleared(), 0);
  assert.equal(lock.isOperationInFlight({ siteId: "site" }), false);
});

test("any other completed state gets no deep link", async () => {
  const h = executeHarness(async () => ({ ok: true, value: { restoreRunId: "run-2", state: "RESTORE_FAILED" } }));
  assert.deepEqual(await executeRestore({ deps: h.deps, input: userInput }, {}), { ok: true, value: { restoreRunId: "run-2", state: "RESTORE_FAILED" } });
});

test("an agent confirms as its current delegator, and with no delegator no confirmer is claimed", async () => {
  const h = executeHarness(async () => ({ ok: true, value: { restoreRunId: "run-3", state: "RESTORED" } }));
  await executeRestore({ deps: h.deps, input: { ...userInput, principalId: "agent-1", principalKind: "agent", delegatedByPrincipalId: "user-9" } });
  await executeRestore({ deps: h.deps, input: { ...userInput, principalId: "agent-1", principalKind: "agent" } });
  assert.deepEqual(h.executed, [{ confirmationToken: "tok", confirmerPrincipalId: "user-9" }, { confirmationToken: "tok" }]);
});

test("a gateway refusal is returned as is, and the lock is released", async () => {
  const lock = createOperationLock({});
  const refusal: GatewayResult = { ok: false, error: { code: "TOKEN_EXPIRED", message: "expired" } };
  const h = executeHarness(async () => refusal, lock);
  assert.equal(await executeRestore({ deps: h.deps, input: userInput }), refusal);
  assert.equal(lock.isOperationInFlight({ siteId: "site" }), false);
});

test("a throwing gateway still releases the lock, and the error propagates", async () => {
  const lock = createOperationLock({});
  const failure = new Error("disk full");
  const h = executeHarness(async () => Promise.reject(failure), lock);
  await assert.rejects(executeRestore({ deps: h.deps, input: userInput }), (error: unknown) => error === failure);
  assert.equal(lock.isOperationInFlight({ siteId: "site" }), false);
});

test("a site with a migration in flight refuses the restore before the gateway runs, with the lock's message or a fallback", async () => {
  const lock = createOperationLock({});
  const migration = await lock.acquireOperationLock({ deps: { clock }, input: { siteId: "site", operationKind: "migration" } });
  assert.equal(migration.ok, true);
  const h = executeHarness(async () => ({ ok: true, value: { restoreRunId: "never", state: "RESTORED" } }), lock);

  assert.deepEqual(await executeRestore({ deps: h.deps, input: userInput }), {
    ok: false,
    error: { code: "RESTORE_OPERATION_IN_FLIGHT", message: "an operation is already in flight for site 'site'" },
  });
  assert.deepEqual(h.executed, []);
  assert.equal(lock.isOperationInFlight({ siteId: "site" }), true, "the migration's lock is not released by the refused restore");

  const silent: ExecuteRestoreOperationLockPort = {
    acquireOperationLock: async () => ({ ok: false, error: { code: "BUSY" } }),
    releaseOperationLock: async () => assert.fail("nothing was acquired, so nothing is released"),
  };
  const quiet = executeHarness(async () => ({ ok: true, value: { restoreRunId: "never", state: "RESTORED" } }), silent);
  assert.deepEqual(await executeRestore({ deps: quiet.deps, input: { ...userInput, siteId: "other" } }), {
    ok: false,
    error: { code: "RESTORE_OPERATION_IN_FLIGHT", message: "an operation is already in flight for site 'other'" },
  });
});
