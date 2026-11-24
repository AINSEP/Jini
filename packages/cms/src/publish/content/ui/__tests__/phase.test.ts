/**
 * @file Task 11 — the plan -> confirm -> execute ceremony's state machine, as pure data.
 *
 * The property this file exists for is plan §4 task 11's own acceptance criterion: **the dialog
 * cannot fire execute without a confirmed plan.** That guard is a pure predicate here rather than an
 * `if` buried in a React hook so it can be asserted directly, and so the admin `.tsx` has no way to
 * reach `execute` on its own.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { PublishContentPlanResult, PublishContentReport } from "../contract.js";
import { canConfirmPlan, canRequestPlan, confirmationTokenFor, planOnScreen, reportOnScreen, type PublishContentPhase } from "../phase.js";

const OK_REPORT: PublishContentReport = {
  refused: false,
  refusalReason: null,
  applyOrder: ["post"],
  rows: [{ entityType: "post", entityId: "p1", outcome: "created", writes: true, reason: null }],
};

const PLAN: PublishContentPlanResult = { planId: "plan-1", planHash: "hash-1", bundleId: "bundle-1", details: OK_REPORT, liveCanOverwrite: false };

const EVERY_PHASE: readonly PublishContentPhase[] = [
  { kind: "idle" },
  { kind: "planning" },
  { kind: "planned", plan: PLAN },
  { kind: "confirming", plan: PLAN },
  { kind: "confirmed", plan: PLAN, confirmationToken: "tok-1" },
  { kind: "executing", plan: PLAN, confirmationToken: "tok-1" },
  { kind: "done", result: { restorePointId: "rp-1", runId: "run-1", changeSetIds: ["cs-1"] } },
  { kind: "failed", message: "boom", code: null },
];

test("only a confirmed plan yields an execution token", () => {
  const withToken = EVERY_PHASE.filter((phase) => confirmationTokenFor(phase) !== null).map((phase) => phase.kind);
  assert.deepEqual(withToken, ["confirmed", "executing"]);
});

test("a planned-but-unconfirmed phase yields no execution token", () => {
  assert.equal(confirmationTokenFor({ kind: "planned", plan: PLAN }), null);
});

test("a confirmed phase yields exactly the token confirm returned", () => {
  assert.equal(confirmationTokenFor({ kind: "confirmed", plan: PLAN, confirmationToken: "tok-1" }), "tok-1");
});

test("a refused plan can never be confirmed", () => {
  const refused: PublishContentPlanResult = {
    planId: "plan-2",
    planHash: "hash-2",
    bundleId: "bundle-2",
    liveCanOverwrite: false,
    details: { refused: true, refusalReason: "different content-hash versions", applyOrder: [], rows: [] },
  };
  assert.equal(canConfirmPlan({ kind: "planned", plan: refused }), false);
});

test("a plan whose every row is a conflict can never be confirmed — there is nothing to write", () => {
  const allConflicts: PublishContentPlanResult = {
    planId: "plan-3",
    planHash: "hash-3",
    bundleId: "bundle-3",
    liveCanOverwrite: false,
    details: {
      refused: false,
      refusalReason: null,
      applyOrder: ["post"],
      rows: [{ entityType: "post", entityId: "p1", outcome: "conflict", writes: false, reason: "edited on the live site" }],
    },
  };
  assert.equal(canConfirmPlan({ kind: "planned", plan: allConflicts }), false);
});

test("a plan with at least one writing row can be confirmed", () => {
  assert.equal(canConfirmPlan({ kind: "planned", plan: PLAN }), true);
});

test("confirming is only ever reachable from a planned phase", () => {
  const confirmable = EVERY_PHASE.filter(canConfirmPlan).map((phase) => phase.kind);
  assert.deepEqual(confirmable, ["planned"]);
});

test("a plan can be requested from idle or after a failure, never mid-ceremony", () => {
  const plannable = EVERY_PHASE.filter(canRequestPlan).map((phase) => phase.kind);
  assert.deepEqual(plannable, ["idle", "failed"]);
});

test("the plan on screen survives confirm and execute, and does not exist before one", () => {
  const withPlan = EVERY_PHASE.filter((phase) => planOnScreen(phase) !== null).map((phase) => phase.kind);
  assert.deepEqual(withPlan, ["planned", "confirming", "confirmed", "executing"]);
  assert.equal(planOnScreen({ kind: "planning" }), null);
  assert.equal(planOnScreen({ kind: "confirmed", plan: PLAN, confirmationToken: "tok-1" }), PLAN);
});

test("completion shows the actual applied report, including a race-time refusal", () => {
  const actual = { ...OK_REPORT, rows: [{ ...OK_REPORT.rows[0]!, outcome: "blocked" as const, writes: false, reason: "The live file changed. Plan publishing again." }] };
  assert.equal(reportOnScreen({ phase: { kind: "done", result: { report: actual, restorePointId: "rp", runId: "run", changeSetIds: [] } } }), actual);
  assert.equal(reportOnScreen({ phase: { kind: "planned", plan: PLAN } }), OK_REPORT);
  assert.equal(reportOnScreen({ phase: { kind: "done", result: { restorePointId: "rp", runId: "run", changeSetIds: [] } } }), null);
});
