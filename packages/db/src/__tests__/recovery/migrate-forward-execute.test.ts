import assert from "node:assert/strict";
import { test } from "vitest";

import type { Clock } from "@jini-ai/core/primitives";

import {
  executeMigrateForward,
  MigrationAlreadyInFlightError,
  type OperationLockPort,
  RestorePointUnavailableError,
} from "../../recovery/migrate-forward-execute.js";
import { createOperationLock, type OperationLockHandle } from "../../recovery/operation-lock.js";

/**
 * @file The forward-migrate wrapper: refuse `unavailable` before any side effect, take the shared
 * site lock before the gated mutation, and always release it afterwards.
 */

const fixedClock: Clock = { nowMs: () => Date.parse("2026-10-21T08:00:00.000Z") };

/** A recording lock that grants or refuses as told; the handle it hands out is what release must get back. */
function recordingLock(outcome: { ok: true } | { ok: false; error: { code: string; message?: string } }) {
  const events: unknown[] = [];
  const handle = { siteId: "site", operationKind: "migration", acquiredAt: "2026-10-21T08:00:00.000Z" };
  const port: OperationLockPort = {
    acquireOperationLock: async (params) => {
      events.push(["acquire", params.input, params.deps.clock.nowMs()]);
      return outcome.ok ? { ok: true, value: handle } : outcome;
    },
    releaseOperationLock: async (params) => {
      events.push(["release", params.input.siteId, params.input.handle === handle]);
    },
  };
  return { events, port };
}

const required = (operationLock: OperationLockPort, gatewayExecute: () => Promise<{ migrated: true }>, costClass: "cheap" | "expensive" | "unavailable" = "cheap") => ({
  siteId: "site",
  confirmationToken: "token",
  costClass,
  operationLock,
  gatewayExecute,
});

test("an unavailable cost class is refused before the lock is ever consulted", async () => {
  const lock = recordingLock({ ok: true });
  let executed = false;
  await assert.rejects(
    executeMigrateForward(required(lock.port, async () => ((executed = true), { migrated: true }), "unavailable")),
    (error: unknown) =>
      error instanceof RestorePointUnavailableError &&
      error.name === "RestorePointUnavailableError" &&
      error.message === "site 'site' has costClass 'unavailable' — the in-product forward migrate is refused with no attestation override"
  );
  assert.deepEqual(lock.events, []);
  assert.equal(executed, false);
});

test("the lock is taken before the mutation and released after it, for cheap and expensive sites alike", async () => {
  for (const costClass of ["cheap", "expensive"] as const) {
    const lock = recordingLock({ ok: true });
    const result = await executeMigrateForward(
      required(lock.port, async () => {
        lock.events.push(["execute"]);
        return { migrated: true };
      }, costClass),
      { clock: fixedClock }
    );
    assert.deepEqual(result, { migrated: true });
    assert.deepEqual(lock.events, [
      ["acquire", { siteId: "site", operationKind: "migration" }, Date.parse("2026-10-21T08:00:00.000Z")],
      ["execute"],
      ["release", "site", true],
    ]);
  }
});

test("a refused lock throws in-flight with the lock's message, or its code when it has none, and runs nothing", async () => {
  const cases: Array<[{ code: string; message?: string }, string]> = [
    [{ code: "OPERATION_IN_FLIGHT", message: "restore running" }, "site 'site': restore running — a migration or restore is already in flight"],
    [{ code: "OPERATION_IN_FLIGHT" }, "site 'site': OPERATION_IN_FLIGHT — a migration or restore is already in flight"],
  ];
  for (const [error, message] of cases) {
    const lock = recordingLock({ ok: false, error });
    let executed = false;
    await assert.rejects(
      executeMigrateForward(required(lock.port, async () => ((executed = true), { migrated: true })), { clock: fixedClock }),
      (thrown: unknown) => thrown instanceof MigrationAlreadyInFlightError && thrown.name === "MigrationAlreadyInFlightError" && thrown.message === message
    );
    assert.equal(executed, false);
    assert.equal(lock.events.length, 1, "acquire only; there is nothing to release");
  }
});

test("a failing mutation still releases the lock, and its error propagates unchanged", async () => {
  const lock = recordingLock({ ok: true });
  const failure = new Error("gateway refused");
  await assert.rejects(
    executeMigrateForward(required(lock.port, async () => Promise.reject(failure)), { clock: fixedClock }),
    (error: unknown) => error === failure
  );
  assert.deepEqual(lock.events.at(-1), ["release", "site", true]);
});

test("with the real shared lock and the default wall clock, a concurrent restore is excluded only while the migration runs", async () => {
  const shared = createOperationLock({});
  let held: OperationLockHandle | undefined;
  const port: OperationLockPort = {
    acquireOperationLock: async (params) => {
      const result = await shared.acquireOperationLock(params);
      if (result.ok) held = result.value;
      return result;
    },
    releaseOperationLock: async (params) => {
      assert.equal(params.input.handle, held, "release gets back the handle acquire returned");
      if (held !== undefined) await shared.releaseOperationLock({ deps: params.deps, input: { siteId: params.input.siteId, handle: held } });
    },
  };
  let restoreDuringMigration: boolean | undefined;
  const before = Date.now();

  await executeMigrateForward(
    required(port, async () => {
      const restore = await shared.acquireOperationLock({ deps: { clock: fixedClock }, input: { siteId: "site", operationKind: "restore" } });
      restoreDuringMigration = restore.ok;
      return { migrated: true };
    })
  );
  const after = Date.now();

  assert.equal(restoreDuringMigration, false, "the restore was refused while the migration held the site");
  const stamped = Date.parse(held?.acquiredAt ?? "");
  assert.ok(stamped >= before && stamped <= after, `the default clock is the wall clock (${held?.acquiredAt})`);
  assert.equal(shared.isOperationInFlight({ siteId: "site" }), false, "released afterwards");
});
