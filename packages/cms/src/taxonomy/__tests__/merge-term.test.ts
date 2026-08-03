import assert from "node:assert/strict";
import { test } from "vitest";

import { planMergeTerm } from "../merge-term.js";

/**
 * @file SPEC-018 C-207 / REQ-15 / REQ-15a / REQ-16 / INV-06 / INV-08 — `mergeTerm`'s gated-mutation
 * instantiation via `core/gated-mutations`.
 *
 * This suite tests only this domain's OWN wrapping logic (the self-merge guard REQ-15a, and the
 * plan's overlap-loss disclosure REQ-16) — the plan/confirm/execute ordering itself, token TTL,
 * and actor-class rule are SPEC-016's own certified contract (see
 * `src/core/gated-mutations/__tests__/unit/gateway.unit.test.ts`), consumed here via a fake
 * `core/gated-mutations.plan()` seam, not re-tested.
 *
 * Assumed seam design:
 *
 * ```ts
 * export class SameTermMergeError extends Error {}
 *
 * export async function planMergeTerm(
 *   required: {
 *     principalId: string; principalKind: "user" | "agent" | "api_key";
 *     fromTermId: string; intoTermId: string;
 *     computeOverlap: () => Promise<{ overlappingContentCount: number }>;
 *     gatewayPlan: (details: unknown) => Promise<{ planId: string; planHash: string; details: unknown }>;
 *   },
 *   optional?: {}
 * ): Promise<{ planId: string; planHash: string; details: { overlapLossDisclosed: boolean; overlappingContentCount: number } }>;
 * // throws SameTermMergeError if fromTermId === intoTermId, BEFORE computeOverlap is ever called
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
