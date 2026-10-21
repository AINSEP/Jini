import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";

import { buildRestoreHooks, type BuildRestoreHooksInput, RestorePointNotFoundError, toRecoveryResult } from "../../recovery/restore-hooks.js";

/**
 * @file The restore hooks' refusal of an unknown restore point (at plan and again at execute), and
 * `toRecoveryResult`'s mapping of the gateway's typed errors to stable codes. The success paths are
 * in `owner-contract.test.ts`.
 */

function hooksFor(points: Array<{ id: string; createdAt: string; artifactRef: string }>) {
  const effects: string[] = [];
  const input: BuildRestoreHooksInput = {
    workspaceId: "site",
    actorId: "operator",
    restorePointId: "rp1",
    clock: { nowMs: () => 0 },
    idGen: { newId: () => "id" },
    planHashOf: () => "hash",
    resolveActorClassIdentity: async ({ principalId }) => principalId,
    restorePointsRepo: { list: async () => points },
    databaseLedgerRepo: { append: async () => void effects.push("ledger") },
    dbOps: { restoreFromArtifact: async () => (effects.push("restore"), { restartRequired: false }) },
    migrationRunsRepo: { findNonTerminalForSite: async () => null, markResolved: async () => void effects.push("resolved") },
    siteStatus: { get: async () => "SERVING", set: async () => void effects.push("status") },
  };
  return { hooks: buildRestoreHooks(input), effects };
}

test("planning a restore to an unknown point is refused, so no confirmation token is ever minted for it", async () => {
  const { hooks } = hooksFor([{ id: "rp-other", createdAt: "x", artifactRef: "/a.db" }]);
  await assert.rejects(hooks.computePlan({}), (error: unknown) => {
    assert.ok(error instanceof RestorePointNotFoundError);
    assert.equal(error.name, "RestorePointNotFoundError");
    assert.equal(error.message, "restore point 'rp1' was not found");
    return true;
  });
});

test("a point deleted after the plan is caught again at execute, before any file swap or ledger row", async () => {
  const points = [{ id: "rp1", createdAt: "x", artifactRef: "/rp1.db" }];
  const { hooks, effects } = hooksFor(points);
  const plan = await hooks.computePlan({});
  points.length = 0;

  await assert.rejects(hooks.executeMutation(plan), RestorePointNotFoundError);
  assert.deepEqual(effects, []);
});

test("toRecoveryResult wraps a value, and maps each gateway error to its stable code with its message", async () => {
  assert.deepEqual(await toRecoveryResult({ run: async () => 42 }), { ok: true, value: 42 });

  const cases: Array<[unknown, { code: string; message: string }]> = [
    [new ForbiddenError({ message: "not an owner", reasonCode: "NOT_INSTANCE_OWNER" }), { code: "NOT_INSTANCE_OWNER", message: "not an owner" }],
    [new PlanStaleError({ message: "plan changed" }), { code: "PLAN_STALE", message: "plan changed" }],
    [new TokenExpiredError({ message: "too late" }), { code: "TOKEN_EXPIRED", message: "too late" }],
    [new TokenAlreadyRedeemedError({ message: "used" }), { code: "TOKEN_ALREADY_REDEEMED", message: "used" }],
    [new RestorePointNotFoundError("gone"), { code: "RESTORE_POINT_NOT_FOUND", message: "gone" }],
    [new TypeError("bug"), { code: "INTERNAL_ERROR", message: "bug" }],
    ["a thrown string", { code: "INTERNAL_ERROR", message: "internal error" }],
  ];
  for (const [thrown, error] of cases) {
    assert.deepEqual(await toRecoveryResult({ run: async () => Promise.reject(thrown) }, {}), { ok: false, error });
  }
});
