/**
 * @file The pure half of the SINGLE writer: given what the ledger holds for one payment and one
 * piece of evidence, decide what changes. No I/O — `apply-evidence.ts` reads the rows under the
 * payment lock, calls these, and writes the result. Keeping the decision pure is what lets the
 * race tests replay every delivery order cheaply.
 *
 * The rules, each traced to a bug in today's `lipay-plugin.ts`:
 *   - The refunded total is RE-DERIVED from refund rows on every apply, never incremented
 *     (B2: the direct refund and its webhook echo each added the amount).
 *   - A refund is matched by OUR correlation id first, then by the provider's refund id, so a
 *     webhook that beats the synchronous response lands on the reserved row instead of creating a
 *     second one.
 *   - Evidence whose amount disagrees with the row it matched, whose currency differs from the
 *     payment's, or that would refund more than was captured is QUARANTINED, never silently capped
 *     (B1: refund webhooks carried the charge's amount).
 *   - Record statuses merge along the L1 transition tables, so reordered or stale evidence cannot
 *     regress a row.
 */
import type { DisputeEvidence, PaymentEvidence, RefundEvidence } from "../contract/evidence.js";
import {
  derivePaymentStatus,
  disputedMinor,
  mergeDisputeStatus,
  mergeIntentStatus,
  mergeRefundStatus,
  refundTotals,
  type DerivedPaymentStatus,
  type DisputeStatus,
  type IntentStatus,
  type RefundStatus,
} from "../state/status.js";
import type { LedgerOutboxTopic } from "../ledger/rows.js";

/** The ledger's view of one payment, as the planner needs it. */
export interface PaymentState {
  readonly id: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly capturedMinor: number;
  readonly intentStatus: IntentStatus;
  readonly providerRef: string | null;
}

export interface RefundState {
  readonly id: string;
  readonly providerRefundRef: string | null;
  readonly amountMinor: number;
  readonly status: RefundStatus;
}

export interface DisputeState {
  readonly id: string;
  readonly providerDisputeRef: string;
  readonly amountMinor: number;
  readonly status: DisputeStatus;
}

export type EvidenceQuarantineReason =
  | "bad-amount"
  | "currency-mismatch"
  | "amount-mismatch"
  | "ref-conflict"
  | "over-refund"
  /** Evidence that money moved contradicts a terminal record (refund failed → succeeded, intent canceled → succeeded). */
  | "terminal-conflict"
  /**
   * A dispute CLOSED (won/lost) with an amount different from the one it opened with. Owner
   * 2026-10-21: the status is applied and the stored amount kept; only the difference is quarantined.
   */
  | "dispute-amount-changed";

type OutboxTopic = LedgerOutboxTopic;

/**
 * The evidence cannot be matched YET: it carries no correlation id, no row has its provider ref,
 * and one of our refunds is still in flight without a provider ref. Inserting it as a new
 * (unsolicited) row would count the same money twice once our response binds the ref, so the
 * caller parks it and retries after the attempt settles (Opus R3: providers that cannot echo).
 */
export interface Deferred {
  readonly kind: "deferred";
}

export interface Quarantined {
  readonly kind: "quarantined";
  readonly reason: EvidenceQuarantineReason;
}

/** The derived caches the writer stores on the payment row after every apply. */
export interface PaymentTotals {
  readonly refundedMinor: number;
  readonly refundHeldMinor: number;
  readonly disputedMinor: number;
  readonly status: DerivedPaymentStatus;
}

export interface RefundPlan {
  readonly kind: "refund";
  /** `insert` = no row matched (an unsolicited refund made at the provider). */
  readonly write: "insert" | "update" | "none";
  readonly row: RefundState;
  readonly refunds: readonly RefundState[];
  readonly outbox: readonly OutboxTopic[];
}

export interface DisputePlan {
  readonly kind: "dispute";
  readonly write: "insert" | "update" | "none";
  readonly row: DisputeState;
  readonly disputes: readonly DisputeState[];
  readonly outbox: readonly OutboxTopic[];
  /** Set when a closing observation carried a different amount: the writer quarantines the difference. */
  readonly amountChanged?: { readonly storedMinor: number; readonly observedMinor: number };
}

export interface IntentPlan {
  readonly kind: "intent";
  readonly changed: boolean;
  readonly payment: PaymentState;
  readonly outbox: readonly OutboxTopic[];
}

function amountProblem({ currency, amountMinor, minorUnits, evidenceCurrency }: {
  currency: string; amountMinor?: number; minorUnits: number; evidenceCurrency: string;
}): EvidenceQuarantineReason | null {
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) return "bad-amount";
  if (evidenceCurrency !== currency) return "currency-mismatch";
  if (amountMinor !== undefined && amountMinor !== minorUnits) return "amount-mismatch";
  return null;
}

/** Correlation id first (it is OUR id, so it cannot collide), then the provider's refund id. */
export function matchRefund(
  { refunds, evidence }: { refunds: readonly RefundState[]; evidence: RefundEvidence },
  _optional: Record<string, never> = {}
): RefundState | undefined {
  const byCorrelation = evidence.correlationId === undefined ? undefined : refunds.find((r) => r.id === evidence.correlationId);
  return byCorrelation ?? refunds.find((r) => r.providerRefundRef === evidence.providerRefundRef);
}

const isUnboundInFlight = (r: RefundState): boolean => r.providerRefundRef === null && r.status !== "failed" && r.status !== "succeeded";

function refundOutbox(previous: RefundStatus | undefined, next: RefundStatus): OutboxTopic[] {
  if (next === previous) return [];
  if (next === "succeeded") return ["refund.succeeded"];
  // Only a refund that had SUCCEEDED and then failed returns money the consumer already counted.
  return next === "failed" && previous === "succeeded" ? ["refund.failed"] : [];
}

function nextRefundRow({ existing, evidence, newId }: { existing: RefundState | undefined; evidence: RefundEvidence; newId: string }): RefundState {
  if (!existing) {
    return { id: newId, providerRefundRef: evidence.providerRefundRef, amountMinor: evidence.amount.minorUnits, status: evidence.status };
  }
  return {
    ...existing,
    providerRefundRef: evidence.providerRefundRef,
    status: mergeRefundStatus({ current: existing.status, incoming: evidence.status }),
  };
}

function writeKind<T>(existing: T | undefined, row: T): "insert" | "update" | "none" {
  if (!existing) return "insert";
  return JSON.stringify(existing) === JSON.stringify(row) ? "none" : "update";
}

/**
 * Which row this evidence is about. Correlation id or provider ref first. For a provider that
 * does not echo our id:
 *  - while any of our refunds still awaits its synchronous response (`reserved`/`pending`, no
 *    ref), DEFER: the response will bind the ref, then this evidence matches by ref or is a new
 *    refund. Guessing here could let a dashboard refund of the same amount take our row and cancel
 *    our hold (re-review blocker);
 *  - a refund whose outcome was lost (`unknown`, no ref) has no response coming, so a SUCCESS or
 *    PENDING of exactly that amount binds to it when it is the only such row — otherwise a timeout
 *    would wait forever. A failure never binds by amount (it would release our hold on a guess).
 *    If the guess picked a foreign refund, totals stay right: our own refund then arrives by ref
 *    as a new row; only the label on the unknown row is the other refund's.
 */
function resolveRefund({ refunds, evidence }: { refunds: readonly RefundState[]; evidence: RefundEvidence }): { existing: RefundState | undefined } | Deferred {
  const matched = matchRefund({ refunds, evidence });
  if (matched || evidence.correlationId !== undefined) return { existing: matched };
  const unbound = refunds.filter(isUnboundInFlight);
  if (unbound.some((r) => r.status !== "unknown")) return { kind: "deferred" };
  const candidates = unbound.filter((r) => r.amountMinor === evidence.amount.minorUnits);
  if (candidates.length === 0) return { existing: undefined };
  return candidates.length === 1 && evidence.status !== "failed" ? { existing: candidates[0] } : { kind: "deferred" };
}

function refundProblem({ payment, existing, evidence }: { payment: PaymentState; existing: RefundState | undefined; evidence: RefundEvidence }): EvidenceQuarantineReason | null {
  const bad = amountProblem({
    currency: payment.currency, minorUnits: evidence.amount.minorUnits, evidenceCurrency: evidence.amount.currency,
    ...(existing ? { amountMinor: existing.amountMinor } : {}),
  });
  if (bad) return bad;
  if (!existing) return null;
  if (existing.providerRefundRef !== null && existing.providerRefundRef !== evidence.providerRefundRef) return "ref-conflict";
  // Nothing leaves `failed`, but a success after it means money left after all: surface it, never drop it.
  return existing.status === "failed" && evidence.status === "succeeded" ? "terminal-conflict" : null;
}

/**
 * Plan one refund observation. `newId` names the row only when nothing matches (an unsolicited
 * refund issued at the provider's dashboard is still money that left).
 */
export function planRefundEvidence(
  { payment, refunds, evidence, newId }: {
    payment: PaymentState; refunds: readonly RefundState[]; evidence: RefundEvidence; newId: string;
  },
  _optional: Record<string, never> = {}
): RefundPlan | Quarantined | Deferred {
  const resolved = resolveRefund({ refunds, evidence });
  if ("kind" in resolved) return resolved;
  const { existing } = resolved;
  const problem = refundProblem({ payment, existing, evidence });
  if (problem) return { kind: "quarantined", reason: problem };
  const row = nextRefundRow({ existing, evidence, newId });
  const next = existing ? refunds.map((r) => (r.id === row.id ? row : r)) : [...refunds, row];
  if (refundTotals({ refunds: next }).succeeded > payment.capturedMinor) return { kind: "quarantined", reason: "over-refund" };
  return { kind: "refund", write: writeKind(existing, row), row, refunds: next, outbox: refundOutbox(existing?.status, row.status) };
}

function disputeOutbox(previous: DisputeStatus | undefined, next: DisputeStatus): OutboxTopic[] {
  if (previous === undefined) return next === "open" ? ["dispute.opened"] : ["dispute.opened", "dispute.closed"];
  return previous !== next ? ["dispute.closed"] : [];
}

/** Plan one dispute observation. Disputes are a separate dimension: they never change the intent status. */
export function planDisputeEvidence(
  { payment, disputes, evidence, newId }: {
    payment: PaymentState; disputes: readonly DisputeState[]; evidence: DisputeEvidence; newId: string;
  },
  _optional: Record<string, never> = {}
): DisputePlan | Quarantined {
  const existing = disputes.find((d) => d.providerDisputeRef === evidence.providerDisputeRef);
  const bad = amountProblem({
    currency: payment.currency, minorUnits: evidence.amount.minorUnits, evidenceCurrency: evidence.amount.currency,
    ...(existing ? { amountMinor: existing.amountMinor } : {}),
  });
  const row: DisputeState = existing
    ? { ...existing, status: mergeDisputeStatus({ current: existing.status, incoming: evidence.status }) }
    : { id: newId, providerDisputeRef: evidence.providerDisputeRef, amountMinor: evidence.amount.minorUnits, status: evidence.status };
  const amountChanged = closingAmountChange({ bad, existing, row, evidence });
  if (bad && !amountChanged) return { kind: "quarantined", reason: bad };
  const next = existing ? disputes.map((d) => (d.id === row.id ? row : d)) : [...disputes, row];
  return {
    kind: "dispute", write: writeKind(existing, row), row, disputes: next, outbox: disputeOutbox(existing?.status, row.status),
    ...(amountChanged ? { amountChanged } : {}),
  };
}

/**
 * Only `amount-mismatch` comes with an `existing` row. A CLOSING observation with a new amount is
 * applied (owner 2026-10-21) and only the difference is flagged; an open or stale one is not.
 */
function closingAmountChange(
  { bad, existing, row, evidence }: { bad: EvidenceQuarantineReason | null; existing: DisputeState | undefined; row: DisputeState; evidence: DisputeEvidence }
): DisputePlan["amountChanged"] {
  if (bad !== "amount-mismatch" || row.status === existing?.status) return undefined;
  return { storedMinor: row.amountMinor, observedMinor: evidence.amount.minorUnits };
}

/**
 * Captured never decreases. Evidence without `captured` leaves it UNCHANGED — except the first
 * move to `succeeded` with nothing captured yet, which means the full amount (auto capture).
 * Defaulting to the full amount on every success would let a later snapshot widen a partial
 * capture and open refund room that was never captured (L3 review).
 */
function nextCaptured({ payment, evidence, intent }: { payment: PaymentState; evidence: PaymentEvidence; intent: IntentStatus }): number {
  if (evidence.captured) return Math.max(payment.capturedMinor, evidence.captured.minorUnits);
  return intent === "succeeded" && payment.capturedMinor === 0 ? payment.amountMinor : payment.capturedMinor;
}

const MONEY_MOVED: ReadonlySet<string> = new Set(["authorized", "succeeded"]);

function intentAmountProblem({ payment, evidence }: { payment: PaymentState; evidence: PaymentEvidence }): EvidenceQuarantineReason | null {
  const checks = [evidence.amount, evidence.captured].filter((m) => m !== undefined);
  for (const reported of checks) {
    const bad = amountProblem({ currency: payment.currency, minorUnits: reported.minorUnits, evidenceCurrency: reported.currency });
    if (bad) return bad;
  }
  if (evidence.amount !== undefined && evidence.amount.minorUnits !== payment.amountMinor) return "amount-mismatch";
  if (evidence.captured !== undefined && evidence.captured.minorUnits > payment.amountMinor) return "amount-mismatch";
  return null;
}

function intentProblem({ payment, evidence }: { payment: PaymentState; evidence: PaymentEvidence }): EvidenceQuarantineReason | null {
  if (payment.providerRef !== null && payment.providerRef !== evidence.providerRef) return "ref-conflict";
  if (evidence.correlationId !== undefined && evidence.correlationId !== payment.id) return "ref-conflict";
  if (payment.intentStatus === "canceled" && MONEY_MOVED.has(evidence.status)) return "terminal-conflict";
  return intentAmountProblem({ payment, evidence });
}

/** Plan the intent half of a payment observation (status, provider ref, captured amount). */
export function planIntentEvidence(
  { payment, evidence }: { payment: PaymentState; evidence: PaymentEvidence },
  _optional: Record<string, never> = {}
): IntentPlan | Quarantined {
  const problem = intentProblem({ payment, evidence });
  if (problem) return { kind: "quarantined", reason: problem };
  const intentStatus = mergeIntentStatus({ current: payment.intentStatus, incoming: evidence.status });
  const next: PaymentState = {
    ...payment,
    intentStatus,
    providerRef: evidence.providerRef,
    capturedMinor: nextCaptured({ payment, evidence, intent: intentStatus }),
  };
  const changed = JSON.stringify(next) !== JSON.stringify(payment);
  const becameSucceeded = intentStatus === "succeeded" && payment.intentStatus !== "succeeded";
  return { kind: "intent", changed, payment: next, outbox: becameSucceeded ? ["payment.succeeded"] : [] };
}

/** The derived caches for the payment row, from its current rows. */
export function computeTotals(
  { payment, refunds, disputes }: { payment: PaymentState; refunds: readonly RefundState[]; disputes: readonly DisputeState[] },
  _optional: Record<string, never> = {}
): PaymentTotals {
  const totals = refundTotals({ refunds });
  return {
    refundedMinor: totals.succeeded,
    refundHeldMinor: totals.held,
    disputedMinor: disputedMinor({ disputes }),
    status: derivePaymentStatus({ intent: payment.intentStatus, capturedMinor: payment.capturedMinor, refundedMinor: totals.succeeded }),
  };
}
