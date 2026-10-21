import assert from "node:assert/strict";
import { test } from "vitest";

import { confirmMergeTerm, executeMergeTerm, planMergeTerm } from "../merge-term.js";

/**
 * @file `mergeTerm`'s gated-mutation instantiation via `core/gated-mutations`.
 *
 * This suite tests only this domain's OWN wrapping logic (the self-merge guard, and the
 * plan's overlap-loss disclosure) — the plan/confirm/execute ordering itself, token TTL,
 * and actor-class rule are `core/gated-mutations`' own certified contract (see
 * `src/core/gated-mutations/__tests__/unit/gateway.unit.test.ts`), consumed here via a fake
 * `core/gated-mutations.plan` seam, not re-tested.
 *
 * Assumed seam design:
 *
 * ```ts
 * export class SameTermMergeError extends Error {}
 *
 * export async function planMergeTerm(
 * required: {
 * principalId: string; principalKind: "user" | "agent" | "api_key";
 * fromTermId: string; intoTermId: string;
 * computeOverlap: => Promise<{ overlappingContentCount: number }>;
 * gatewayPlan: (details: unknown) => Promise<{ planId: string; planHash: string; details: unknown }>;
 * },
 * optional?: {}
 * ): Promise<{ planId: string; planHash: string; details: { overlapLossDisclosed: boolean; overlappingContentCount: number } }>;
 * throws SameTermMergeError if fromTermId === intoTermId, BEFORE computeOverlap is ever called
 * ```
 */ 

test("AC-22a / REQ-15a / INV-08: planMergeTerm rejects fromTermId === intoTermId with SameTermMergeError before any overlap computation runs", async () => {
  let overlapComputed = false;

  await assert.rejects(
    planMergeTerm({
      principalId: "u-1",
      principalKind: "user",
      fromTermId: "term-1",
      intoTermId: "term-1",
      computeOverlap: async () => {
        overlapComputed = true;
        return { overlappingContentCount: 0 };
      },
      gatewayPlan: async (details) => ({ planId: "p-1", planHash: "sha256:" + "1".repeat(64), details }),
    }),
    (err: unknown) => err instanceof Error && err.constructor.name === "SameTermMergeError"
  );

  assert.equal(overlapComputed, false, "REQ-15a: self-merge must be rejected structurally before any overlap computation");
});

test("AC-23 / REQ-16: plan() discloses irrecoverable pre-merge assignment loss when overlapping content exists", async () => {
  const plan = await planMergeTerm({
    principalId: "u-1",
    principalKind: "user",
    fromTermId: "term-1",
    intoTermId: "term-2",
    computeOverlap: async () => ({ overlappingContentCount: 3 }),
    gatewayPlan: async (details) => ({ planId: "p-1", planHash: "sha256:" + "1".repeat(64), details: details as object }),
  });

  assert.equal(plan.details.overlapLossDisclosed, true);
  assert.equal(plan.details.overlappingContentCount, 3);
});

test("AC-24: plan() states no loss when no overlap exists", async () => {
  const plan = await planMergeTerm({
    principalId: "u-1",
    principalKind: "user",
    fromTermId: "term-1",
    intoTermId: "term-2",
    computeOverlap: async () => ({ overlappingContentCount: 0 }),
    gatewayPlan: async (details) => ({ planId: "p-1", planHash: "sha256:" + "1".repeat(64), details: details as object }),
  });

  assert.equal(plan.details.overlapLossDisclosed, false);
});

test("AC-21: no direct single-call mergeTerm entry point exists — only planMergeTerm/confirmMergeTerm/executeMergeTerm are exported", async () => {
  const mergeModule = await import("../merge-term.js");
  const exportedNames = Object.keys(mergeModule);
  const disallowed = exportedNames.filter(
    (name) => /merge/i.test(name) && !["planMergeTerm", "confirmMergeTerm", "executeMergeTerm", "SameTermMergeError"].includes(name)
  );
  assert.deepEqual(disallowed, [], "no export beyond the plan/confirm/execute trio may perform a merge directly");
});

test("planMergeTerm: when the gateway echoes no details back, the plan still carries the domain's own disclosure", async () => {
  const plan = await planMergeTerm({
    principalId: "u-1",
    principalKind: "user",
    fromTermId: "term-1",
    intoTermId: "term-2",
    computeOverlap: async () => ({ overlappingContentCount: 0 }),
    gatewayPlan: async () => ({ planId: "p-9", planHash: "h-9", details: undefined }),
  });

  assert.deepEqual(plan, {
    planId: "p-9",
    planHash: "h-9",
    details: { fromTermId: "term-1", intoTermId: "term-2", overlapLossDisclosed: false, overlappingContentCount: 0 },
  });
});

test("confirmMergeTerm: forwards exactly the plan id/hash to the gateway's confirm and returns its token", async () => {
  const calls: unknown[] = [];
  const result = await confirmMergeTerm({
    principalId: "u-1",
    principalKind: "user",
    planId: "p-1",
    planHash: "h-1",
    gatewayConfirm: async (params) => {
      calls.push(params);
      return { token: "tok-1" };
    },
  });

  assert.deepEqual(result, { token: "tok-1" });
  assert.deepEqual(calls, [{ planId: "p-1", planHash: "h-1" }]);
});

test("confirmMergeTerm: a gateway refusal (e.g. an agent confirming) propagates unchanged", async () => {
  const refusal = new Error("agents may not confirm");
  await assert.rejects(
    confirmMergeTerm({
      principalId: "a-1",
      principalKind: "agent",
      planId: "p-1",
      planHash: "h-1",
      gatewayConfirm: async () => {
        throw refusal;
      },
    }),
    (err: unknown) => err === refusal
  );
});

test("executeMergeTerm: redeems only the confirmation token through the gateway and returns the merged count", async () => {
  const calls: unknown[] = [];
  const result = await executeMergeTerm({
    confirmationToken: "tok-1",
    gatewayExecute: async (params) => {
      calls.push(params);
      return { mergedCount: 4 };
    },
  });

  assert.deepEqual(result, { mergedCount: 4 });
  assert.deepEqual(calls, [{ confirmationToken: "tok-1" }]);
});
