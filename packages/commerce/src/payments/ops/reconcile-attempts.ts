/**
 * @file Reconciling a capture or void whose response was lost (lot L4 review, R2-F4). The provider
 * call timed out, threw, or the process died after Tx1: the payment is still authorized (or
 * pending) and only the attempt row (`dispatched`/`unknown`) shows a call went out. While it stays
 * open, `capture-void.ts` refuses a conflicting capture/void of the payment; this closes it.
 *
 * The payment's status decides, by the same rule the ops use (`CAPTURE_VOID_STATUSES`):
 * - at the op's result (`succeeded` for a capture, `canceled` for a void) → the attempt is `ok`;
 * - somewhere else the op cannot have led (e.g. a capture whose payment was canceled) → `rejected`;
 * - still where the op started → ask the provider: its snapshot goes through the single writer
 *   first, then the same rule; a payment the provider STILL reports as it was means the call never
 *   took effect → `rejected` (the caller may try again under a new key).
 * No snapshot, or a quarantined one: left open with an `unknown-aged` alert.
 *
 * `olderThanMs` must exceed the longest provider call (see `reconciler.ts`): a call still in
 * flight must not be judged from a snapshot taken before it lands.
 */
import type { IntentStatus } from "../state/status.js";
import { OPEN_ATTEMPT_OUTCOMES, type AttemptRecord, type PaymentRecord } from "../ledger/rows.js";
import { CAPTURE_VOID_STATUSES } from "./capture-void.js";
import type { OpsDeps } from "./deps.js";
import { applySnapshot, leave, retrieveSnapshot, type Verdict } from "./reconcile-snapshot.js";

/** The attempt ops this reconciles. */
export const RECONCILED_ATTEMPT_OPS = ["capture", "void"] as const;
type AttemptOpName = (typeof RECONCILED_ATTEMPT_OPS)[number];

/** `ok`/`rejected` when the payment's status settles the op; null when it is still where the op started. */
function judge({ op, status }: { op: AttemptOpName; status: IntentStatus }): "ok" | "rejected" | null {
  const rule = CAPTURE_VOID_STATUSES[op];
  if (status === rule.done) return "ok";
  return rule.from.has(status) ? null : "rejected";
}

function readPaymentOf({ deps, attempt }: { deps: OpsDeps; attempt: AttemptRecord }): Promise<PaymentRecord> {
  // An attempt's payment exists in its scope: the composite foreign key guarantees it.
  return deps.ledger.transaction((tx) => tx.getPayment({ workspaceId: attempt.workspaceId, mode: attempt.mode, id: attempt.paymentId })) as Promise<PaymentRecord>;
}

/**
 * Records the judgment on the attempt, under the payment lock (the same lock a conflicting
 * capture/void checks open attempts under). An attempt the late provider answer already closed is
 * left as that answer recorded it.
 */
async function close(
  { deps, attempt, outcome, status }: { deps: OpsDeps; attempt: AttemptRecord; outcome: "ok" | "rejected"; status: IntentStatus }
): Promise<Verdict> {
  const closed = await deps.ledger.transaction(async (tx) => {
    const scope = { workspaceId: attempt.workspaceId, mode: attempt.mode };
    await tx.lockPayment({ ...scope, id: attempt.paymentId });
    const current = await tx.findAttemptByOperationKey({ ...scope, operationKey: attempt.operationKey });
    if (!OPEN_ATTEMPT_OUTCOMES.includes((current as AttemptRecord).outcome)) return false;
    const error = outcome === "ok" ? {} : { errorCode: "RECONCILED", errorMessage: `reconciled: the provider reports the payment ${status}` };
    await tx.updateAttempt({ id: attempt.id, patch: { outcome, ...error, updatedAt: deps.now() } });
    return true;
  });
  return closed && outcome === "rejected" ? "failed" : "settled";
}

/** Settles one open capture/void attempt (see the file header). */
export async function reconcileAttempt({ deps, attempt }: { deps: OpsDeps; attempt: AttemptRecord }, _optional: Record<string, never> = {}): Promise<Verdict> {
  const op = attempt.op as AttemptOpName;
  const payment = await readPaymentOf({ deps, attempt });
  const known = judge({ op, status: payment.intentStatus });
  if (known !== null) return close({ deps, attempt, outcome: known, status: payment.intentStatus });
  const label = `${op} attempt ${attempt.id} of payment ${payment.id} is ${attempt.outcome}`;
  const snapshot = await retrieveSnapshot({ deps, payment });
  if (!snapshot.ok) return leave({ deps, payment, detail: `${label}: ${snapshot.why}` });
  if (!(await applySnapshot({ deps, payment, evidence: snapshot.evidence }))) return leave({ deps, payment, detail: `${label}: its snapshot was quarantined` });
  const after = await readPaymentOf({ deps, attempt });
  return close({ deps, attempt, outcome: judge({ op, status: after.intentStatus }) ?? "rejected", status: after.intentStatus });
}
