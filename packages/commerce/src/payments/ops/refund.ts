/**
 * @file `PaymentsPort.refund` (lot L4), in the owner-mandated order:
 *
 *   Tx1: idempotency lookup (same key + same payment/amount = replay, else conflict) →
 *        `grants.redeem` → `reserveRefund` (refund id = the correlation id) → attempt `dispatched`;
 *   provider call OUTSIDE any transaction;
 *   Tx2: ok → `applyRefundEvidence(…, { refundId })`; rejected/unknown → `recordRefundDispatchOutcome`.
 *
 * Cheap request checks (payment exists in this scope, currency, the provider's `full`-only rule)
 * run before the grant is redeemed, so an obviously invalid request never burns a person's
 * approval. A grant redeemed in a transaction that then refuses (insufficient money) stays used:
 * grants are single-use by design, and the person approves again.
 */
import type { Money } from "../../money/money.js";
import type { RefundEvidence } from "../contract/evidence.js";
import type { RefundResult } from "../contract/payments-port.js";
import type { Outcome, PaymentProvider } from "../contract/provider.js";
import { sameScope, type PaymentScope } from "../contract/scope.js";
import { applyRefundEvidence, recordRefundDispatchOutcome, reserveRefund, type ReserveResult } from "../accounting/apply-evidence.js";
import type { LedgerTx } from "../ledger/repo.js";
import type { AttemptRecord, PaymentRecord, RefundRecord } from "../ledger/rows.js";
import {
  checkAmount, checkProvider, checkText, dispatch, fail, markAttempt, newAttempt, noteApplied, onUniqueRace, readPayment,
  resolveContext, type Failure,
} from "./common.js";
import type { OpsDeps } from "./deps.js";
import { paymentView, refundView, scopeOf } from "./view.js";

export interface RefundRequired {
  readonly scope: PaymentScope;
  readonly paymentId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly grant: string;
}

type RefundCall = NonNullable<PaymentProvider["refund"]>;

function checkRefund(
  { deps, required }: { deps: OpsDeps; required: RefundRequired }
): { readonly ok: true; readonly provider: PaymentProvider; readonly call: RefundCall } | Failure {
  const checked = checkProvider({ deps, scope: required.scope });
  if (!checked.ok) return checked;
  const { provider } = checked;
  const problem = checkAmount({ amount: required.amount, provider })
    ?? checkText({ fields: { paymentId: required.paymentId, idempotencyKey: required.idempotencyKey } });
  if (problem) return problem;
  if (provider.capabilities.refunds === "none" || typeof provider.refund !== "function") {
    return fail({ code: "CAPABILITY_UNSUPPORTED", message: `provider '${provider.id}' does not support refunds` });
  }
  return { ok: true, provider, call: provider.refund.bind(provider) };
}

type Done = { readonly kind: "done"; readonly result: RefundResult };
type Opened = { readonly kind: "opened"; readonly payment: PaymentRecord; readonly refund: RefundRecord; readonly attempt: AttemptRecord };

/** A prior refund under this key: the same request is replayed from the ledger, anything else conflicts. */
async function replayOrConflict({ tx, required, prior }: { tx: LedgerTx; required: RefundRequired; prior: RefundRecord }): Promise<Done> {
  const same = sameScope({ a: scopeOf(prior), b: required.scope }) && prior.paymentId === required.paymentId
    && prior.amountMinor === required.amount.minorUnits && prior.currency === required.amount.currency;
  if (!same) return { kind: "done", result: fail({ code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different refund request" }) };
  // A refund row's payment exists in the same scope: the composite foreign key guarantees it.
  const payment = (await readPayment({ tx, scope: required.scope, paymentId: prior.paymentId })) as PaymentRecord;
  return { kind: "done", result: { ok: true, refund: refundView(prior), payment: paymentView(payment), replayed: true } };
}

async function lookupRefund({ tx, required }: { tx: LedgerTx; required: RefundRequired }): Promise<Done | null> {
  const { scope } = required;
  const prior = await tx.findRefundByIdempotencyKey({ workspaceId: scope.workspaceId, mode: scope.mode, key: required.idempotencyKey });
  return prior ? replayOrConflict({ tx, required, prior }) : null;
}

/** Why this payment cannot take this refund, judged before the grant is spent; the reservation re-checks under the lock. */
function paymentProblem({ payment, required, provider }: { payment: PaymentRecord | null; required: RefundRequired; provider: PaymentProvider }): Failure | null {
  if (!payment) return fail({ code: "INVALID_REQUEST", message: `payment '${required.paymentId}' not found in this scope` });
  if (payment.currency !== required.amount.currency) return fail({ code: "INVALID_REQUEST", message: `refund currency ${required.amount.currency} differs from the payment's ${payment.currency}` });
  if (payment.providerRef === null) return fail({ code: "INVALID_REQUEST", message: "the payment has no provider reference to refund against" });
  const refundable = Math.max(0, payment.capturedMinor - payment.refundedMinor - payment.refundHeldMinor - payment.disputedMinor);
  if (provider.capabilities.refunds === "full" && required.amount.minorUnits !== refundable) {
    return fail({ code: "INVALID_REQUEST", message: `provider '${provider.id}' refunds only the whole refundable amount (${refundable} minor units)` });
  }
  return null;
}

const RESERVE_REFUSED: Readonly<Record<Exclude<ReserveResult["kind"], "reserved">, string>> = {
  insufficient: "the refund exceeds the refundable amount",
  "invalid-amount": "the refund amount must be a positive whole number of minor units",
  "not-refundable": "the payment has not succeeded, so it cannot be refunded",
  missing: "the payment disappeared",
};

function reserveFailure(reserved: Exclude<ReserveResult, { kind: "reserved" }>): Done {
  const left = "refundableMinor" in reserved ? ` (${reserved.refundableMinor} minor units left)` : "";
  return { kind: "done", result: fail({ code: "INVALID_REQUEST", message: `${RESERVE_REFUSED[reserved.kind]}${left}` }) };
}

/** Tx1, in the owner's order. */
async function openRefund(
  { deps, required, provider, reason }: { deps: OpsDeps; required: RefundRequired; provider: PaymentProvider; reason: string | undefined }
): Promise<Done | Opened> {
  const { scope, amount, idempotencyKey } = required;
  const open = () => deps.ledger.transaction(async (tx): Promise<Done | Opened> => {
    const prior = await lookupRefund({ tx, required });
    if (prior) return prior;
    const payment = await readPayment({ tx, scope, paymentId: required.paymentId });
    const problem = paymentProblem({ payment, required, provider });
    if (problem) return { kind: "done", result: problem };
    const binding = { op: "refund" as const, workspaceId: scope.workspaceId, mode: scope.mode, paymentId: required.paymentId, amount, idempotencyKey };
    if (!(await deps.grants.redeem({ grant: required.grant, binding }))) {
      return { kind: "done", result: fail({ code: "GRANT_INVALID", message: "the refund grant is missing, expired, used or bound to another request" }) };
    }
    const reserved = await reserveRefund(
      { tx, deps: deps.writer, workspaceId: scope.workspaceId, mode: scope.mode, paymentId: required.paymentId, refundId: deps.newId(), amountMinor: amount.minorUnits, idempotencyKey },
      reason === undefined ? {} : { reason }
    );
    if (reserved.kind !== "reserved") return reserveFailure(reserved);
    const attempt = newAttempt({ deps, payment: payment as PaymentRecord, op: "refund", operationKey: `refund:${idempotencyKey}` }, { refundId: reserved.refund.id });
    await tx.insertAttempt({ attempt });
    return { kind: "opened", payment: payment as PaymentRecord, refund: reserved.refund, attempt };
  });
  return onUniqueRace({ open, lookup: () => deps.ledger.transaction((tx) => lookupRefund({ tx, required })) });
}

/** Tx2 and the caller's view. */
async function settleRefund({ deps, opened, outcome }: { deps: OpsDeps; opened: Opened; outcome: Outcome<RefundEvidence> }): Promise<RefundResult> {
  const { payment, refund, attempt } = opened;
  const target = { deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id };
  const result = await deps.ledger.transaction(async (tx) => {
    await markAttempt({ tx, deps, attemptId: attempt.id, outcome });
    if (outcome.kind === "ok") return applyRefundEvidence({ ...target, tx, source: "response", evidence: outcome.value }, { refundId: refund.id });
    return recordRefundDispatchOutcome({ ...target, tx, refundId: refund.id, outcome: outcome.kind });
  });
  if (outcome.kind !== "ok") return { ok: false, error: outcome.error };
  if (!(await noteApplied({ deps, payment, result }))) {
    return fail({ code: "PROVIDER_ERROR", message: "the provider's refund response could not be applied and was quarantined for review" });
  }
  const scope = scopeOf(payment);
  // Both rows exist (Tx1 wrote them; nothing deletes payments or refunds).
  const read = await deps.ledger.transaction(async (tx) => ({
    payment: (await readPayment({ tx, scope, paymentId: payment.id })) as PaymentRecord,
    refund: (await tx.findRefund({ paymentId: payment.id }, { correlationId: refund.id })) as RefundRecord,
  }));
  return { ok: true, refund: refundView(read.refund), payment: paymentView(read.payment), replayed: false };
}

export async function refund(
  { deps, required }: { deps: OpsDeps; required: RefundRequired },
  optional: { reason?: string } = {}
): Promise<RefundResult> {
  const checked = checkRefund({ deps, required });
  if (!checked.ok) return checked;
  const resolved = await resolveContext({ deps, scope: required.scope, provider: checked.provider });
  if (!resolved.ok) return resolved;
  const opened = await openRefund({ deps, required, provider: checked.provider, reason: optional.reason });
  if (opened.kind === "done") return opened.result;
  const req = { providerRef: opened.payment.providerRef as string, amount: required.amount, idempotencyKey: opened.refund.id, correlationId: opened.refund.id };
  const outcome = await dispatch({ call: () => checked.call({ req, ctx: resolved.ctx }, optional.reason === undefined ? {} : { reason: optional.reason }) });
  return settleRefund({ deps, opened, outcome });
}
