/**
 * @file The unknown-outcome reconciler (lot L4). A host runs `reconcileUnknown` on a schedule; it
 * settles what a timed-out call left behind:
 *
 * - An `unknown` intent with a provider ref, at a provider that can `retrieve`: the snapshot goes
 *   through the single writer (`applyPaymentEvidence`, source `retrieve`).
 * - An unsettled refund (`unknown`/`pending`, or `reserved` older than the cutoff — the process died
 *   between Tx1 and Tx2, so it moves to `unknown` first): the payment snapshot is retrieved and
 *   applied. Then the OWNER RULE (2026-10-21): if the provider returns payments WITH their refunds
 *   (`retrieve: "payment+refunds"`), our refund is still `unknown`, and the snapshot lists no refund
 *   that could be it, the provider never made it → `failed`, releasing the hold.
 * - Anything it cannot settle (no `retrieve`, no provider ref, a provider error, a snapshot that
 *   still leaves it open) is left as is and raises an `unknown-aged` alert for an operator
 *   (`resolveUnknown`).
 *
 * `olderThanMs` must exceed the longest provider call: a refund younger than an in-flight dispatch
 * would otherwise be judged before its own response arrives. A failure on one row is counted and
 * the run moves on.
 */
import type { PaymentEvidence, RefundEvidence } from "../contract/evidence.js";
import type { PaymentProvider } from "../contract/provider.js";
import type { LedgerKeyScope } from "../ledger/repo.js";
import type { PaymentRecord, RefundRecord } from "../ledger/rows.js";
import { applyPaymentEvidence, recordRefundDispatchOutcome, settleUnknownRefund } from "../accounting/apply-evidence.js";
import { dispatch, noteApplied, raiseAlert, resolveContext } from "./common.js";
import type { OpsDeps } from "./deps.js";
import { scopeOf } from "./view.js";

export interface ReconcileCounts {
  readonly scanned: number;
  /** Moved out of `unknown`/unsettled by provider evidence. */
  readonly settled: number;
  /** Refunds marked `failed` by the owner rule (always 0 for payments). */
  readonly failed: number;
  /** Still open: an `unknown-aged` alert was raised for each. */
  readonly left: number;
  /** Rows whose reconcile threw (storage fault, ref conflict); retried on the next run. */
  readonly errors: number;
}

export interface ReconcileReport {
  readonly payments: ReconcileCounts;
  readonly refunds: ReconcileCounts;
}

type Verdict = "settled" | "failed" | "left" | "errors";

type Snapshot = { readonly ok: true; readonly evidence: PaymentEvidence; readonly provider: PaymentProvider } | { readonly ok: false; readonly why: string };

/** The provider's current snapshot of a payment, or why there is none. */
async function retrieveSnapshot(deps: OpsDeps, payment: PaymentRecord): Promise<Snapshot> {
  const provider = deps.providers.get({ id: payment.providerId })?.provider;
  if (!provider) return { ok: false, why: `provider '${payment.providerId}' is not registered` };
  const retrieve = provider.retrieve;
  if (provider.capabilities.retrieve === "none" || typeof retrieve !== "function") return { ok: false, why: `provider '${provider.id}' cannot retrieve` };
  const providerRef = payment.providerRef;
  if (providerRef === null) return { ok: false, why: "no provider reference (the provider never answered)" };
  const resolved = await resolveContext({ deps, scope: scopeOf(payment), provider });
  if (!resolved.ok) return { ok: false, why: resolved.error.message };
  const outcome = await dispatch(() => retrieve.call(provider, { providerRef, ctx: resolved.ctx }));
  return outcome.kind === "ok" ? { ok: true, evidence: outcome.value, provider } : { ok: false, why: outcome.error.message };
}

async function applySnapshot(deps: OpsDeps, payment: PaymentRecord, evidence: PaymentEvidence): Promise<boolean> {
  const result = await deps.ledger.transaction((tx) => applyPaymentEvidence({
    tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "retrieve", evidence,
  }));
  return noteApplied({ deps, payment, result });
}

async function leave(deps: OpsDeps, payment: PaymentRecord, detail: string): Promise<Verdict> {
  await raiseAlert({ deps, kind: "unknown-aged", payment, detail });
  return "left";
}

async function reconcilePayment(deps: OpsDeps, payment: PaymentRecord): Promise<Verdict> {
  const snapshot = await retrieveSnapshot(deps, payment);
  if (!snapshot.ok) return leave(deps, payment, `payment ${payment.id} is unknown: ${snapshot.why}`);
  if (await applySnapshot(deps, payment, snapshot.evidence)) return "settled";
  return leave(deps, payment, `payment ${payment.id} is unknown: its snapshot was quarantined`);
}

/** Could `candidate` (a snapshot refund) be our refund `row`? By our id, its ref, or — when it is bound to no row — anything. */
function couldBe({ candidate, row, refunds }: { candidate: RefundEvidence; row: RefundRecord; refunds: readonly RefundRecord[] }): boolean {
  if (candidate.correlationId === row.id || (row.providerRefundRef !== null && candidate.providerRefundRef === row.providerRefundRef)) return true;
  const boundElsewhere = refunds.some((r) => r.id === candidate.correlationId || r.providerRefundRef === candidate.providerRefundRef);
  return !boundElsewhere;
}

/** The owner rule, after the snapshot was applied: settle `failed` only on a full snapshot that cannot hold our refund. */
async function judgeRefund(
  { deps, payment, refundId, snapshot }: { deps: OpsDeps; payment: PaymentRecord; refundId: string; snapshot: { evidence: PaymentEvidence; provider: PaymentProvider } }
): Promise<Verdict> {
  const refunds = await deps.ledger.transaction((tx) => tx.listRefunds({ paymentId: payment.id }));
  // The refund row exists: it was listed by this run and refunds are never deleted.
  const row = refunds.find((r) => r.id === refundId) as RefundRecord;
  if (row.status === "succeeded" || row.status === "failed") return "settled";
  const label = `refund ${row.id} is ${row.status}`;
  if (row.status !== "unknown") return leave(deps, payment, `${label}: the provider still reports it in progress`);
  if (snapshot.provider.capabilities.retrieve !== "payment+refunds") return leave(deps, payment, `${label}: the provider cannot list refunds`);
  if (snapshot.evidence.refunds.some((candidate) => couldBe({ candidate, row, refunds }))) {
    return leave(deps, payment, `${label}: the snapshot lists a refund that may be it`);
  }
  await deps.ledger.transaction((tx) => settleUnknownRefund({
    tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "retrieve", refundId: row.id, status: "failed",
  }));
  return "failed";
}

async function reconcileRefund(deps: OpsDeps, refund: RefundRecord): Promise<Verdict> {
  const target = { workspaceId: refund.workspaceId, mode: refund.mode, paymentId: refund.paymentId };
  // A refund's payment exists in its scope: the composite foreign key guarantees it.
  const payment = (await deps.ledger.transaction((tx) => tx.getPayment({ ...target, id: refund.paymentId }))) as PaymentRecord;
  if (refund.status === "reserved") {
    // Dispatched (Tx1 committed) but never settled: its outcome is unknown, never failed.
    await deps.ledger.transaction((tx) => recordRefundDispatchOutcome({ tx, deps: deps.writer, ...target, refundId: refund.id, outcome: "unknown" }));
  }
  const snapshot = await retrieveSnapshot(deps, payment);
  if (!snapshot.ok) return leave(deps, payment, `refund ${refund.id} is unsettled: ${snapshot.why}`);
  // A snapshot the writer refused is not evidence of anything: its empty refund list must not fail ours.
  if (!(await applySnapshot(deps, payment, snapshot.evidence))) return leave(deps, payment, `refund ${refund.id} is unsettled: its snapshot was quarantined`);
  return judgeRefund({ deps, payment, refundId: refund.id, snapshot });
}

async function tally<R>(rows: readonly R[], judge: (row: R) => Promise<Verdict>): Promise<ReconcileCounts> {
  const counts = { scanned: rows.length, settled: 0, failed: 0, left: 0, errors: 0 };
  for (const row of rows) {
    const verdict = await judge(row).catch((): Verdict => "errors");
    counts[verdict] += 1;
  }
  return counts;
}

/**
 * One reconcile pass over rows last updated more than `olderThanMs` ago, at most `limit` payments
 * and `limit` refunds, least recently updated first.
 * @param optional.scope - Narrow to one workspace + mode; default: every workspace.
 */
export async function reconcileUnknown(
  { deps, olderThanMs, limit }: { deps: OpsDeps; olderThanMs: number; limit: number },
  optional: { scope?: LedgerKeyScope } = {}
): Promise<ReconcileReport> {
  const updatedBefore = deps.now() - olderThanMs;
  const scan = optional.scope === undefined ? {} : { scope: optional.scope };
  const { payments, refunds } = await deps.ledger.transaction(async (tx) => ({
    payments: await tx.listUnknownPayments({ updatedBefore, limit }, scan),
    refunds: await tx.listUnsettledRefunds({ updatedBefore, limit }, scan),
  }));
  return {
    payments: await tally(payments, (payment) => reconcilePayment(deps, payment)),
    refunds: await tally(refunds, (refund) => reconcileRefund(deps, refund)),
  };
}
