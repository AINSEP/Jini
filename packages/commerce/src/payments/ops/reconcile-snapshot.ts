/**
 * @file What every reconciler pass shares (lot L4): fetching the provider's current snapshot of a
 * payment, putting it through the single writer, and leaving a row open with an `unknown-aged`
 * alert. Used by `reconciler.ts` (intents, refunds) and `reconcile-attempts.ts` (capture/void).
 */
import type { PaymentEvidence } from "../contract/evidence.js";
import type { PaymentProvider } from "../contract/provider.js";
import type { PaymentRecord } from "../ledger/rows.js";
import { applyPaymentEvidence } from "../accounting/apply-evidence.js";
import { dispatch, noteApplied, raiseAlert, resolveContext } from "./common.js";
import type { OpsDeps } from "./deps.js";
import { scopeOf } from "./view.js";

/** What reconciling one row decided; each is a counter of `ReconcileCounts`. */
export type Verdict = "settled" | "failed" | "left" | "errors";

export type Snapshot = { readonly ok: true; readonly evidence: PaymentEvidence; readonly provider: PaymentProvider } | { readonly ok: false; readonly why: string };

/** The provider's current snapshot of a payment, or why there is none. */
export async function retrieveSnapshot({ deps, payment }: { deps: OpsDeps; payment: PaymentRecord }, _optional: Record<string, never> = {}): Promise<Snapshot> {
  const provider = deps.providers.get({ id: payment.providerId })?.provider;
  if (!provider) return { ok: false, why: `provider '${payment.providerId}' is not registered` };
  const retrieve = provider.retrieve;
  if (provider.capabilities.retrieve === "none" || typeof retrieve !== "function") return { ok: false, why: `provider '${provider.id}' cannot retrieve` };
  const providerRef = payment.providerRef;
  if (providerRef === null) return { ok: false, why: "no provider reference (the provider never answered)" };
  const resolved = await resolveContext({ deps, scope: scopeOf(payment), provider });
  if (!resolved.ok) return { ok: false, why: resolved.error.message };
  const outcome = await dispatch({ call: () => retrieve.call(provider, { providerRef, ctx: resolved.ctx }) });
  return outcome.kind === "ok" ? { ok: true, evidence: outcome.value, provider } : { ok: false, why: outcome.error.message };
}

/** True when the writer applied the snapshot; a quarantined one is evidence of nothing. */
export async function applySnapshot(
  { deps, payment, evidence }: { deps: OpsDeps; payment: PaymentRecord; evidence: PaymentEvidence },
  _optional: Record<string, never> = {}
): Promise<boolean> {
  const result = await deps.ledger.transaction((tx) => applyPaymentEvidence({
    tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "retrieve", evidence,
  }));
  return noteApplied({ deps, payment, result });
}

/** Leaves the row open for the next pass or an operator, with an `unknown-aged` alert. */
export async function leave({ deps, payment, detail }: { deps: OpsDeps; payment: PaymentRecord; detail: string }, _optional: Record<string, never> = {}): Promise<Verdict> {
  await raiseAlert({ deps, kind: "unknown-aged", payment, detail });
  return "left";
}
