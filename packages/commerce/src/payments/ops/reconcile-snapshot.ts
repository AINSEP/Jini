/**
 * @file What every reconciler pass shares (lot L4): fetching the provider's current snapshot of a
 * payment, putting it through the single writer, and leaving a row open with an `unknown-aged`
 * alert. Used by `reconciler.ts` (intents, refunds) and `reconcile-attempts.ts` (capture/void).
 */
import type { PaymentEvidence } from "../contract/evidence.js";
import type { PaymentProvider } from "../contract/provider.js";
import type { PaymentRecord } from "../ledger/rows.js";
import { applyPaymentEvidence } from "../accounting/apply-evidence.js";
import { dispatch, markAttempt, noteApplied, raiseAlert, resolveContext } from "./common.js";
import type { OpsDeps } from "./deps.js";
import { recoverIntentSnapshot } from "./intent-recovery.js";
import { scopeOf } from "./view.js";

/** What reconciling one row decided; each is a counter of `ReconcileCounts`. */
export type Verdict = "settled" | "failed" | "left" | "errors";

export type Snapshot = { readonly ok: true; readonly evidence: PaymentEvidence; readonly provider: PaymentProvider; readonly recoveryAttemptId?: string } | { readonly ok: false; readonly why: string };

/** A reference-less intent can recover only through a provider's explicit safe replay contract. */
async function snapshotWithoutReference({ deps, payment, provider }: { deps: OpsDeps; payment: PaymentRecord; provider: PaymentProvider }): Promise<Snapshot> {
  if (provider.intentReplayWindowMs === undefined) return { ok: false, why: "no provider reference (the provider never answered)" };
  const resolved = await resolveContext({ deps, scope: scopeOf(payment), provider });
  return resolved.ok ? recoverIntentSnapshot({ deps, payment, provider, ctx: resolved.ctx }) : { ok: false, why: resolved.error.message };
}

/** The provider's current snapshot of a payment, or why there is none. */
export async function retrieveSnapshot({ deps, payment }: { deps: OpsDeps; payment: PaymentRecord }, _optional: Record<string, never> = {}): Promise<Snapshot> {
  const provider = deps.providers.get({ id: payment.providerId })?.provider;
  if (!provider) return { ok: false, why: `provider '${payment.providerId}' is not registered` };
  if (payment.providerRef === null) return snapshotWithoutReference({ deps, payment, provider });
  const retrieve = provider.retrieve;
  if (provider.capabilities.retrieve === "none" || typeof retrieve !== "function") return { ok: false, why: `provider '${provider.id}' cannot retrieve` };
  const resolved = await resolveContext({ deps, scope: scopeOf(payment), provider });
  if (!resolved.ok) return { ok: false, why: resolved.error.message };
  const providerRef = payment.providerRef;
  const outcome = await dispatch({ call: () => retrieve.call(provider, { providerRef, ctx: resolved.ctx }) });
  return outcome.kind === "ok" ? { ok: true, evidence: outcome.value, provider } : { ok: false, why: outcome.error.message };
}

/** True when the writer applied the snapshot; a quarantined one is evidence of nothing. */
export async function applySnapshot(
  { deps, payment, evidence, recoveryAttemptId }: { deps: OpsDeps; payment: PaymentRecord; evidence: PaymentEvidence; recoveryAttemptId?: string },
  _optional: Record<string, never> = {}
): Promise<boolean> {
  const result = await deps.ledger.transaction({ fn: async tx => {
    const applied = await applyPaymentEvidence({
      tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "retrieve", evidence,
    });
    if (recoveryAttemptId !== undefined && applied.kind === "applied") {
      await markAttempt({ tx, deps, attemptId: recoveryAttemptId, outcome: { kind: "ok", value: evidence } });
      await tx.updateAttempt({ id: recoveryAttemptId, patch: { recoveryClaimUntil: null, updatedAt: deps.now() } });
    }
    return applied;
  } });
  return noteApplied({ deps, payment, result });
}

/** Leaves the row open for the next pass or an operator, with an `unknown-aged` alert. */
export async function leave({ deps, payment, detail }: { deps: OpsDeps; payment: PaymentRecord; detail: string }, _optional: Record<string, never> = {}): Promise<Verdict> {
  await raiseAlert({ deps, kind: "unknown-aged", payment, detail });
  return "left";
}
