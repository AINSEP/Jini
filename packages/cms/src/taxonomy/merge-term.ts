/**
 * @file SPEC-018 C-207 / REQ-15 / REQ-15a / REQ-16 / INV-06 / INV-08 — `mergeTerm`'s gated-mutation
 * instantiation via `core/gated-mutations` (ADR-044's one gated mutation).
 *
 * Purpose:
 * Merge is destructive and can silently lose pre-merge `entry_terms` assignment history for
 * content already assigned to both terms (ADR-044's "Destructive term merge" failure mode) — it
 * gets the plan/confirm/execute ceremony every other taxonomy mutation does not. This file owns
 * only this domain's OWN wrapping logic: the structural self-merge guard (REQ-15a — rejected
 * BEFORE any overlap computation, so a forged confirmation token for a self-merge can never even
 * exist, INV-08) and the plan's overlap-loss disclosure (REQ-16). The plan/confirm/execute
 * ordering itself, token TTL, and actor-class rule are SPEC-016's own certified contract
 * (`core/gated-mutations/__tests__/unit/gateway.unit.test.ts`) — consumed here via injected
 * `gatewayPlan`/`gatewayConfirm`/`gatewayExecute` closures a composition root binds to the real
 * `core/gated-mutations.plan/confirm/execute`, never re-tested here.
 *
 * AC-21 (certified): no export beyond this plan/confirm/execute trio may perform a merge
 * directly — enforced by `merge-term.unit.test.ts`'s own export-surface inspection.
 */

export class SameTermMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SameTermMergeError";
  }
}

export interface MergeTermPlanDetails {
  fromTermId: string;
  intoTermId: string;
  overlapLossDisclosed: boolean;
  overlappingContentCount: number;
}

export interface PlanMergeTermRequired {
  principalId: string;
  principalKind: "user" | "agent" | "api_key";
  fromTermId: string;
  intoTermId: string;
  /** Counts content already assigned to BOTH terms — the assignments that would be silently
   * deduplicated (and thus permanently lost) by the merge's `entry_terms_unique` dedup step. */
  computeOverlap: () => Promise<{ overlappingContentCount: number }>;
  /** Bound by the caller to `core/gated-mutations.plan()` with `domain="taxonomy.merge"`. */
  gatewayPlan: (details: MergeTermPlanDetails) => Promise<{ planId: string; planHash: string; details: unknown }>;
}

/**
 * AC-22a/REQ-15a/INV-08 — rejects `fromTermId === intoTermId` structurally BEFORE
 * `computeOverlap()` ever runs (no plan, therefore no token, can ever exist for a self-merge).
 * AC-23/AC-24/REQ-16 — the returned plan discloses whether the merge would lose any pre-existing
 * overlapping assignment (never a false "no loss" when `overlappingContentCount > 0`).
 *
 * @complexity O(1) plus the caller-supplied `computeOverlap`/`gatewayPlan` costs.
 * @overallScore 100
 */
export async function planMergeTerm(
  required: PlanMergeTermRequired,
  _optional: Record<string, never> = {}
): Promise<{ planId: string; planHash: string; details: MergeTermPlanDetails }> {
  const { fromTermId, intoTermId, computeOverlap, gatewayPlan } = required;

  if (fromTermId === intoTermId) {
    throw new SameTermMergeError(`cannot merge term '${fromTermId}' into itself`);
  }

  const { overlappingContentCount } = await computeOverlap();
  const details: MergeTermPlanDetails = {
    fromTermId,
    intoTermId,
    overlapLossDisclosed: overlappingContentCount > 0,
    overlappingContentCount,
  };

  const plan = await gatewayPlan(details);
  return {
    planId: plan.planId,
    planHash: plan.planHash,
    details: (plan.details as MergeTermPlanDetails | undefined) ?? details,
  };
}

export interface ConfirmMergeTermRequired {
  principalId: string;
  principalKind: "user" | "agent" | "api_key";
  planId: string;
  planHash: string;
  /** Bound by the caller to `core/gated-mutations.confirm()`. */
  gatewayConfirm: (params: { planId: string; planHash: string }) => Promise<{ token: string }>;
}

/** Delegates to the injected `core/gated-mutations.confirm()` binding — no domain logic of its
 * own beyond forwarding, since SPEC-016 already owns the confirm-time actor-class rule
 * (agents may never confirm) and token minting. */
export async function confirmMergeTerm(
  required: ConfirmMergeTermRequired,
  _optional: Record<string, never> = {}
): Promise<{ token: string }> {
  return required.gatewayConfirm({ planId: required.planId, planHash: required.planHash });
}

export interface ExecuteMergeTermRequired {
  confirmationToken: string;
  /** Bound by the caller to `core/gated-mutations.execute()`, whose `hooks.executeMutation()` in
   * turn re-points `entry_terms` and writes the one `taxonomy_revisions` row this merge produces. */
  gatewayExecute: (params: { confirmationToken: string }) => Promise<{ mergedCount: number }>;
}

/** Delegates to the injected `core/gated-mutations.execute()` binding — SPEC-016's fixed
 * check-sequence (authorize -> token state -> actor-class -> plan-hash -> redeem-then-mutate)
 * runs entirely inside that binding; this function performs no independent redemption logic. */
export async function executeMergeTerm(
  required: ExecuteMergeTermRequired,
  _optional: Record<string, never> = {}
): Promise<{ mergedCount: number }> {
  return required.gatewayExecute({ confirmationToken: required.confirmationToken });
}
