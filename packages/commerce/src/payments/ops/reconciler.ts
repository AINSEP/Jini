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
 * - A capture or void whose response was lost (its attempt still `dispatched`/`unknown`, the
 *   payment as it was): closed from the payment's status or the provider's snapshot
 *   (`reconcile-attempts.ts`).
 * - Anything it cannot settle (no `retrieve`, no provider ref, a provider error, a snapshot that
 *   still leaves it open) is left as is and raises an `unknown-aged` alert for an operator
 *   (`resolveUnknown`).
 *
 * Progress: each scan is limited, so a pass returns a {@link ReconcileCursor} — where each scan
 * stopped — and the next pass resumes after it (a scan that came back short starts over). Rows
 * that never settle therefore cannot pin every pass to the same oldest batch and starve newer rows.
 * `createPaymentsOperator` keeps the cursor between passes itself; a host may also pass its own.
 *
 * `olderThanMs` must exceed the longest provider call: a refund younger than an in-flight dispatch
 * would otherwise be judged before its own response arrives. A failure on one row is counted and
 * the run moves on.
 */
import type { PaymentEvidence, RefundEvidence } from "../contract/evidence.js";
import type { PaymentProvider } from "../contract/provider.js";
import type { LedgerKeyScope, ScanCursor } from "../ledger/repo.js";
import type { PaymentRecord, RefundRecord } from "../ledger/rows.js";
import { recordRefundDispatchOutcome, settleUnknownRefund } from "../accounting/apply-evidence.js";
import type { OpsDeps } from "./deps.js";
import { RECONCILED_ATTEMPT_OPS, reconcileAttempt } from "./reconcile-attempts.js";
import { applySnapshot, leave, retrieveSnapshot, type Verdict } from "./reconcile-snapshot.js";

export interface ReconcileCounts {
  readonly scanned: number;
  /** Moved out of `unknown`/unsettled by provider evidence (an attempt: closed `ok`). */
  readonly settled: number;
  /** Refunds marked `failed` by the owner rule; capture/void attempts closed `rejected` (always 0 for payments). */
  readonly failed: number;
  /** Still open: an `unknown-aged` alert was raised for each. */
  readonly left: number;
  /** Rows whose reconcile threw (storage fault, ref conflict); retried on the next run. */
  readonly errors: number;
}

/** Where each scan of a pass stopped; null = it saw fewer rows than its limit, so the next pass starts over. */
export interface ReconcileCursor {
  readonly payments: ScanCursor | null;
  readonly refunds: ScanCursor | null;
  readonly attempts: ScanCursor | null;
}

export interface ReconcileReport {
  readonly payments: ReconcileCounts;
  readonly refunds: ReconcileCounts;
  readonly attempts: ReconcileCounts;
  /** Pass it back (or let `createPaymentsOperator` keep it) so the next pass resumes after these rows. */
  readonly cursor: ReconcileCursor;
}

export interface ReconcileOptions {
  /** Narrow to one workspace + mode; default: every workspace. */
  readonly scope?: LedgerKeyScope;
  /** Resume after a previous pass's `cursor`; default: from the least recently updated rows. */
  readonly cursor?: ReconcileCursor;
}

async function reconcilePayment({ deps, payment }: { deps: OpsDeps; payment: PaymentRecord }): Promise<Verdict> {
  const snapshot = await retrieveSnapshot({ deps, payment });
  if (!snapshot.ok) return leave({ deps, payment, detail: `payment ${payment.id} is unknown: ${snapshot.why}` });
  if (await applySnapshot({ deps, payment, evidence: snapshot.evidence })) return "settled";
  return leave({ deps, payment, detail: `payment ${payment.id} is unknown: its snapshot was quarantined` });
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
  if (row.status !== "unknown") return leave({ deps, payment, detail: `${label}: the provider still reports it in progress` });
  if (snapshot.provider.capabilities.retrieve !== "payment+refunds") return leave({ deps, payment, detail: `${label}: the provider cannot list refunds` });
  if (snapshot.evidence.refunds.some((candidate) => couldBe({ candidate, row, refunds }))) {
    return leave({ deps, payment, detail: `${label}: the snapshot lists a refund that may be it` });
  }
  await deps.ledger.transaction((tx) => settleUnknownRefund({
    tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "retrieve", refundId: row.id, status: "failed",
  }));
  return "failed";
}

async function reconcileRefund({ deps, refund }: { deps: OpsDeps; refund: RefundRecord }): Promise<Verdict> {
  const target = { workspaceId: refund.workspaceId, mode: refund.mode, paymentId: refund.paymentId };
  // A refund's payment exists in its scope: the composite foreign key guarantees it.
  const payment = (await deps.ledger.transaction((tx) => tx.getPayment({ ...target, id: refund.paymentId }))) as PaymentRecord;
  if (refund.status === "reserved") {
    // Dispatched (Tx1 committed) but never settled: its outcome is unknown, never failed.
    await deps.ledger.transaction((tx) => recordRefundDispatchOutcome({ tx, deps: deps.writer, ...target, refundId: refund.id, outcome: "unknown" }));
  }
  const snapshot = await retrieveSnapshot({ deps, payment });
  if (!snapshot.ok) return leave({ deps, payment, detail: `refund ${refund.id} is unsettled: ${snapshot.why}` });
  // A snapshot the writer refused is not evidence of anything: its empty refund list must not fail ours.
  if (!(await applySnapshot({ deps, payment, evidence: snapshot.evidence }))) return leave({ deps, payment, detail: `refund ${refund.id} is unsettled: its snapshot was quarantined` });
  return judgeRefund({ deps, payment, refundId: refund.id, snapshot });
}

async function tally<R>({ rows, judge }: { rows: readonly R[]; judge: (row: R) => Promise<Verdict> }): Promise<ReconcileCounts> {
  const counts = { scanned: rows.length, settled: 0, failed: 0, left: 0, errors: 0 };
  for (const row of rows) {
    const verdict = await judge(row).catch((): Verdict => "errors");
    counts[verdict] += 1;
  }
  return counts;
}

/** Where a limited scan stopped: its last row when it filled the limit (there may be more), else null (start over). */
function nextCursor({ rows, limit }: { rows: readonly { id: string; updatedAt: number }[]; limit: number }): ScanCursor | null {
  const last = rows.at(-1);
  return rows.length < limit || last === undefined ? null : { updatedAt: last.updatedAt, id: last.id };
}

/** One scan's options: the pass's scope, and that scan's resume position when there is one. */
function scanOptions({ scope, after }: { scope: LedgerKeyScope | undefined; after: ScanCursor | null | undefined }): { scope?: LedgerKeyScope; after?: ScanCursor } {
  return { ...(scope === undefined ? {} : { scope }), ...(after ? { after } : {}) };
}

/**
 * One reconcile pass over rows last updated more than `olderThanMs` ago, at most `limit` payments,
 * `limit` refunds and `limit` capture/void attempts, least recently updated first after the cursor.
 * @param optional.scope - Narrow to one workspace + mode; default: every workspace.
 * @param optional.cursor - A previous pass's `cursor`; default: start from the oldest rows.
 */
export async function reconcileUnknown(
  { deps, olderThanMs, limit }: { deps: OpsDeps; olderThanMs: number; limit: number },
  optional: ReconcileOptions = {}
): Promise<ReconcileReport> {
  const updatedBefore = deps.now() - olderThanMs;
  const { scope, cursor } = optional;
  const { payments, refunds, attempts } = await deps.ledger.transaction(async (tx) => ({
    payments: await tx.listUnknownPayments({ updatedBefore, limit }, scanOptions({ scope, after: cursor?.payments })),
    refunds: await tx.listUnsettledRefunds({ updatedBefore, limit }, scanOptions({ scope, after: cursor?.refunds })),
    attempts: await tx.listOpenAttempts({ ops: RECONCILED_ATTEMPT_OPS, updatedBefore, limit }, scanOptions({ scope, after: cursor?.attempts })),
  }));
  return {
    payments: await tally({ rows: payments, judge: (payment) => reconcilePayment({ deps, payment }) }),
    refunds: await tally({ rows: refunds, judge: (refund) => reconcileRefund({ deps, refund }) }),
    attempts: await tally({ rows: attempts, judge: (attempt) => reconcileAttempt({ deps, attempt }) }),
    cursor: {
      payments: nextCursor({ rows: payments, limit }), refunds: nextCursor({ rows: refunds, limit }), attempts: nextCursor({ rows: attempts, limit }),
    },
  };
}

/**
 * `reconcileUnknown` that remembers each scope's cursor between calls (one per scope; the
 * unscoped pass has its own), so a host that just calls it on a timer makes progress. An explicit
 * `optional.cursor` overrides the remembered one. In-process only: a restart starts over, which
 * only costs one pass over the oldest rows.
 */
export function createCursorReconciler(
  { deps }: { deps: OpsDeps },
  _optional: Record<string, never> = {}
): (required: { olderThanMs: number; limit: number }, optional?: ReconcileOptions) => Promise<ReconcileReport> {
  const cursors = new Map<string, ReconcileCursor>();
  return async ({ olderThanMs, limit }, optional = {}) => {
    const key = optional.scope === undefined ? "*" : `${optional.scope.workspaceId}:${optional.scope.mode}`;
    const cursor = optional.cursor ?? cursors.get(key);
    const report = await reconcileUnknown({ deps, olderThanMs, limit }, { ...optional, ...(cursor ? { cursor } : {}) });
    cursors.set(key, report.cursor);
    return report;
  };
}
