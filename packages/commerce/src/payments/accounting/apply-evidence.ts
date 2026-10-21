/**
 * @file THE single writer of payment intent state, refunds, disputes and the payment's derived
 * caches (commerce design item 2). Synchronous provider responses, webhooks and `retrieve`
 * snapshots all arrive here as evidence; nothing else in the kernel writes those columns. Today's
 * `lipay-plugin.ts` had two writers of the refunded total (`:825` and `:456-459`) — bug B2.
 *
 * Every function runs INSIDE the caller's ledger transaction and starts with `lockPayment`, so two
 * concurrent applies (a webhook racing the synchronous response, two refunds at once) serialize
 * on the payment. Each apply appends the observation to the evidence log (append-only), merges it
 * through the pure planner (`plan-evidence.ts`), writes what changed, re-derives the caches from
 * the rows and enqueues outbox events. Evidence the planner refuses is quarantined with the
 * observation kept, never dropped and never capped.
 *
 * Known limit (L3 review, left to L5): refs are checked within ONE payment. A provider ref already
 * held by another payment makes the insert throw `LedgerConstraintError`, rolling back the whole
 * apply. On Postgres the transaction is poisoned, so the quarantine cannot be written inside it:
 * the inbox worker must catch the error, roll back, and dead-letter/quarantine in a new transaction.
 */
import type { PaymentsAlertPort } from "../contract/alerts.js";
import type { DisputeEvidence, PaymentEvidence, RefundEvidence } from "../contract/evidence.js";
import type { PaymentMode } from "../contract/scope.js";
import type { LedgerTx } from "../ledger/repo.js";
import type { EvidenceSource, EvidenceSubject, LedgerOutboxTopic, PaymentRecord, RefundRecord } from "../ledger/rows.js";
import { disputedMinor, refundTotals, refundableMinor } from "../state/status.js";
import {
  computeTotals, planDisputeEvidence, planIntentEvidence, planRefundEvidence,
  type EvidenceQuarantineReason, type PaymentState, type Quarantined,
} from "./plan-evidence.js";

export interface WriterDeps {
  readonly now: () => number;
  readonly newId: () => string;
  /** Raised (never capping anything) when withdrawn money exceeds captured. Absent = no alerts. */
  readonly alerts?: PaymentsAlertPort;
}

export interface WriterInput {
  readonly tx: LedgerTx;
  readonly deps: WriterDeps;
  /** The payment's workspace + mode: `lockPayment` is fenced by them, so a foreign-scope id reads as missing. */
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly paymentId: string;
  readonly source: EvidenceSource;
}

export type ApplyResult =
  | {
      readonly kind: "applied"; readonly quarantined: readonly EvidenceQuarantineReason[]; readonly outbox: readonly LedgerOutboxTopic[];
      /** Refund observations that could not be matched yet; the caller parks and retries the whole observation. */
      readonly deferred: number;
    }
  | { readonly kind: "deferred" }
  | { readonly kind: "quarantined"; readonly reason: EvidenceQuarantineReason }
  | { readonly kind: "missing" };

interface Ctx extends WriterInput {
  /** Reassigned once the intent patch is known, so refunds are checked against the new captured amount. */
  payment: PaymentRecord;
  readonly inboxId: string | null;
  readonly outbox: LedgerOutboxTopic[];
  readonly quarantined: EvidenceQuarantineReason[];
  deferred: number;
}

/**
 * The evidence amount column takes only a safe integer. A malformed amount (fractional, unsafe) is
 * validated out BEFORE the insert: written as-is it would throw in the integer encoder and roll back
 * the whole apply, losing the observation the planner then quarantines as `bad-amount` (R1-F3). The
 * observation, malformed amount included, is kept whole in the quarantine row's JSON.
 */
function storableMinor({ amount }: { amount: { minorUnits: number } | undefined }): number | null {
  return amount !== undefined && Number.isSafeInteger(amount.minorUnits) ? amount.minorUnits : null;
}

async function appendEvidence(ctx: Ctx, entry: { subject: EvidenceSubject; subjectRef: string; status: string; amount?: { minorUnits: number; currency: string } }): Promise<void> {
  await ctx.tx.appendEvidence({
    evidence: {
      id: ctx.deps.newId(), paymentId: ctx.payment.id, workspaceId: ctx.payment.workspaceId, siteId: ctx.payment.siteId,
      providerId: ctx.payment.providerId, providerAccountId: ctx.payment.providerAccountId, mode: ctx.payment.mode, source: ctx.source, subject: entry.subject, subjectRef: entry.subjectRef, observedStatus: entry.status,
      currency: entry.amount?.currency ?? null, amountMinor: storableMinor({ amount: entry.amount }), inboxId: ctx.inboxId, recordedAt: ctx.deps.now(),
    },
  });
}

async function quarantine(ctx: Ctx, subject: EvidenceSubject, plan: Quarantined, evidence: unknown): Promise<void> {
  ctx.quarantined.push(plan.reason);
  await ctx.tx.insertQuarantine({
    entry: {
      id: ctx.deps.newId(), workspaceId: ctx.payment.workspaceId, mode: ctx.payment.mode, paymentId: ctx.payment.id,
      subject, reason: plan.reason, evidenceJson: JSON.stringify(evidence), createdAt: ctx.deps.now(),
    },
  });
}

async function enqueue(ctx: Ctx, topics: readonly LedgerOutboxTopic[], payload: Record<string, unknown>): Promise<void> {
  for (const topic of topics) {
    ctx.outbox.push(topic);
    // Ids and amounts only: no personal data leaves through the outbox (gap check item 4).
    await ctx.tx.enqueueOutbox({
      message: {
        id: ctx.deps.newId(), workspaceId: ctx.payment.workspaceId, mode: ctx.payment.mode, topic, aggregateId: ctx.payment.id,
        payloadJson: JSON.stringify({ paymentId: ctx.payment.id, ...payload }), createdAt: ctx.deps.now(),
      },
    });
  }
}

function stateOf(payment: PaymentRecord): PaymentState {
  return {
    id: payment.id, currency: payment.currency, amountMinor: payment.amountMinor, capturedMinor: payment.capturedMinor,
    intentStatus: payment.intentStatus, providerRef: payment.providerRef,
  };
}

function newRefundRecord(ctx: Ctx, row: { id: string; providerRefundRef: string | null; amountMinor: number; status: RefundRecord["status"] }): RefundRecord {
  const p = ctx.payment;
  return {
    ...row, paymentId: p.id, workspaceId: p.workspaceId, siteId: p.siteId, providerId: p.providerId, providerAccountId: p.providerAccountId,
    mode: p.mode, idempotencyKey: null, currency: p.currency, reason: null, createdAt: ctx.deps.now(), updatedAt: ctx.deps.now(),
  };
}

async function applyOneRefund(ctx: Ctx, evidence: RefundEvidence): Promise<void> {
  await appendEvidence(ctx, { subject: "refund", subjectRef: evidence.providerRefundRef, status: evidence.status, amount: evidence.amount });
  const refunds = await ctx.tx.listRefunds({ paymentId: ctx.payment.id });
  const plan = planRefundEvidence({ payment: stateOf(ctx.payment), refunds, evidence, newId: ctx.deps.newId() });
  if (plan.kind === "quarantined") return quarantine(ctx, "refund", plan, evidence);
  if (plan.kind === "deferred") {
    ctx.deferred += 1;
    return;
  }
  if (plan.write === "insert") await ctx.tx.insertRefund({ refund: newRefundRecord(ctx, plan.row) });
  if (plan.write === "update") {
    await ctx.tx.updateRefund({ id: plan.row.id, patch: { status: plan.row.status, providerRefundRef: plan.row.providerRefundRef, updatedAt: ctx.deps.now() } });
  }
  await enqueue(ctx, plan.outbox, { refundId: plan.row.id, amountMinor: plan.row.amountMinor, currency: ctx.payment.currency });
}

async function applyOneDispute(ctx: Ctx, evidence: DisputeEvidence): Promise<void> {
  await appendEvidence(ctx, { subject: "dispute", subjectRef: evidence.providerDisputeRef, status: evidence.status, amount: evidence.amount });
  const disputes = await ctx.tx.listDisputes({ paymentId: ctx.payment.id });
  const plan = planDisputeEvidence({ payment: stateOf(ctx.payment), disputes, evidence, newId: ctx.deps.newId() });
  if (plan.kind === "quarantined") return quarantine(ctx, "dispute", plan, evidence);
  if (plan.amountChanged) {
    // Owner 2026-10-21: the close is applied with the stored amount; only the difference waits for a person.
    const { storedMinor, observedMinor } = plan.amountChanged;
    await quarantine(ctx, "dispute", { kind: "quarantined", reason: "dispute-amount-changed" }, {
      evidence, storedMinor, observedMinor, differenceMinor: observedMinor - storedMinor,
    });
  }
  const p = ctx.payment;
  if (plan.write === "insert") {
    await ctx.tx.insertDispute({
      dispute: {
        ...plan.row, paymentId: p.id, workspaceId: p.workspaceId, siteId: p.siteId, providerId: p.providerId, providerAccountId: p.providerAccountId, mode: p.mode,
        currency: p.currency, dueBy: evidence.dueBy ?? null, createdAt: ctx.deps.now(), updatedAt: ctx.deps.now(),
      },
    });
  }
  if (plan.write === "update") await ctx.tx.updateDispute({ id: plan.row.id, patch: { status: plan.row.status, updatedAt: ctx.deps.now() } });
  await enqueue(ctx, plan.outbox, { disputeId: plan.row.id, status: plan.row.status });
}

/** Re-derives the caches from the rows and writes them with whatever intent patch applies. */
async function writeCaches(ctx: Ctx, intent: Partial<PaymentRecord>): Promise<void> {
  const base = { ...stateOf(ctx.payment), ...intent } as PaymentState;
  const refunds = await ctx.tx.listRefunds({ paymentId: ctx.payment.id });
  const disputes = await ctx.tx.listDisputes({ paymentId: ctx.payment.id });
  const totals = computeTotals({ payment: base, refunds, disputes });
  const written = await ctx.tx.updatePayment({
    id: ctx.payment.id, expectedVersion: ctx.payment.version,
    patch: { ...intent, ...totals, updatedAt: ctx.deps.now() },
  });
  // The payment lock is held, so a lost version race means a writer bypassed this module.
  if (!written) throw new Error(`payments ledger: payment ${ctx.payment.id} changed under its lock`);
  await alertOverWithdrawn(ctx, { capturedMinor: base.capturedMinor, withdrawnMinor: totals.refundedMinor + totals.disputedMinor });
}

/**
 * Owner 2026-10-21: succeeded refunds + disputed money above captured is ALERTED, never capped or
 * refused (it is real money that left). Raised once, when an apply first crosses the line, so
 * webhook redeliveries do not repeat it. A failing alert port never rolls back the money facts.
 */
async function alertOverWithdrawn(ctx: Ctx, now: { capturedMinor: number; withdrawnMinor: number }): Promise<void> {
  const before = ctx.payment.refundedMinor + ctx.payment.disputedMinor > ctx.payment.capturedMinor;
  if (before || now.withdrawnMinor <= now.capturedMinor || !ctx.deps.alerts) return;
  const detail = `withdrawn ${now.withdrawnMinor} > captured ${now.capturedMinor} ${ctx.payment.currency} (minor units)`;
  await ctx.deps.alerts
    .raise({ alert: { kind: "over-withdrawn", workspaceId: ctx.payment.workspaceId, mode: ctx.payment.mode, paymentId: ctx.payment.id, detail } })
    .catch(() => undefined);
}

async function open(input: WriterInput, inboxId: string | null): Promise<Ctx | null> {
  const payment = await input.tx.lockPayment({ workspaceId: input.workspaceId, mode: input.mode, id: input.paymentId });
  return payment ? { ...input, payment, inboxId, outbox: [], quarantined: [], deferred: 0 } : null;
}

function settlementPatch(evidence: PaymentEvidence): Partial<PaymentRecord> {
  const s = evidence.settlement;
  return {
    ...(s?.fee ? { feeCurrency: s.fee.currency, feeMinor: s.fee.minorUnits } : {}),
    ...(s?.net ? { netCurrency: s.net.currency, netMinor: s.net.minorUnits } : {}),
    ...(s?.settlement ? { settlementCurrency: s.settlement.currency, settlementMinor: s.settlement.minorUnits } : {}),
  };
}

/** Intent statuses where the shopper has nothing left to do: any stored action is over. */
const ACTION_OVER: ReadonlySet<string> = new Set(["authorized", "succeeded", "failed", "canceled"]);
const NO_ACTION = JSON.stringify({ kind: "none" });

/**
 * The next-action column follows the MERGED intent status, not the observation (R1-F5): once the
 * intent is past the shopper's step it is cleared, even when the success evidence omits `next`; and
 * an observation whose status lost the merge (stale) cannot restore or replace the action.
 */
function nextActionPatch({ evidence, intentStatus }: { evidence: PaymentEvidence; intentStatus: string }): Partial<PaymentRecord> {
  if (ACTION_OVER.has(intentStatus)) return { nextActionJson: NO_ACTION };
  return evidence.next && evidence.status === intentStatus ? { nextActionJson: JSON.stringify(evidence.next) } : {};
}

function failuresFirst(refunds: readonly RefundEvidence[]): RefundEvidence[] {
  return [...refunds.filter((r) => r.status === "failed"), ...refunds.filter((r) => r.status !== "failed")];
}

/**
 * Apply a full payment observation: the intent first (a quarantined intent stops the whole
 * observation — its refunds cannot be trusted to belong to this payment), then each refund and
 * dispute, then the derived caches.
 */
export async function applyPaymentEvidence(
  required: WriterInput & { evidence: PaymentEvidence },
  optional: { inboxId?: string } = {}
): Promise<ApplyResult> {
  const ctx = await open(required, optional.inboxId ?? null);
  if (!ctx) return { kind: "missing" };
  const { evidence } = required;
  await appendEvidence(ctx, { subject: "payment", subjectRef: evidence.providerRef, status: evidence.status, ...(evidence.amount ? { amount: evidence.amount } : {}) });
  const plan = planIntentEvidence({ payment: stateOf(ctx.payment), evidence });
  if (plan.kind === "quarantined") {
    await quarantine(ctx, "payment", plan, evidence);
    return { kind: "quarantined", reason: plan.reason };
  }
  const intent: Partial<PaymentRecord> = {
    intentStatus: plan.payment.intentStatus, providerRef: plan.payment.providerRef, capturedMinor: plan.payment.capturedMinor,
    ...nextActionPatch({ evidence, intentStatus: plan.payment.intentStatus }),
    ...settlementPatch(evidence),
  };
  ctx.payment = { ...ctx.payment, ...intent } as PaymentRecord;
  // The intent's topics first: consumers must see payment.succeeded before any refund of it.
  await enqueue(ctx, plan.outbox, { amountMinor: ctx.payment.capturedMinor, currency: ctx.payment.currency });
  // Failures first: a snapshot listing a later refund before an earlier one's failure must not
  // trip the over-refund cap on money the failure already returned (L3 review).
  for (const refund of failuresFirst(evidence.refunds)) await applyOneRefund(ctx, refund);
  for (const dispute of evidence.disputes) await applyOneDispute(ctx, dispute);
  await writeCaches(ctx, intent);
  return { kind: "applied", quarantined: ctx.quarantined, outbox: ctx.outbox, deferred: ctx.deferred };
}

/**
 * Apply one refund observation (a synchronous refund response, or a refund-only webhook).
 * `refundId` = the reservation this response answers: a synchronous response belongs to the row
 * that was dispatched even when the provider does not echo our correlation id.
 */
export async function applyRefundEvidence(
  required: WriterInput & { evidence: RefundEvidence },
  optional: { inboxId?: string; refundId?: string } = {}
): Promise<ApplyResult> {
  const ctx = await open(required, optional.inboxId ?? null);
  if (!ctx) return { kind: "missing" };
  const correlationId = required.evidence.correlationId ?? optional.refundId;
  await applyOneRefund(ctx, { ...required.evidence, ...(correlationId === undefined ? {} : { correlationId }) });
  await writeCaches(ctx, {});
  const [reason] = ctx.quarantined;
  if (reason) return { kind: "quarantined", reason };
  return ctx.deferred > 0 ? { kind: "deferred" } : { kind: "applied", quarantined: [], outbox: ctx.outbox, deferred: 0 };
}

export type ReserveResult =
  | { readonly kind: "reserved"; readonly refund: RefundRecord }
  | { readonly kind: "insufficient"; readonly refundableMinor: number }
  | { readonly kind: "invalid-amount" }
  | { readonly kind: "not-refundable"; readonly status: PaymentRecord["status"] }
  | { readonly kind: "missing" };

/**
 * Reserve money for a refund BEFORE dispatching it: under the payment lock, check
 * `captured − succeeded − held` and insert a `reserved` row. The row id is the correlation id
 * sent to the provider. A reserved/unknown/pending refund keeps holding money until evidence
 * settles it, so two concurrent refunds can never both take the last refundable cent.
 */
export async function reserveRefund(
  required: Omit<WriterInput, "source"> & { refundId: string; amountMinor: number; idempotencyKey: string },
  optional: { reason?: string } = {}
): Promise<ReserveResult> {
  const ctx = await open({ ...required, source: "response" }, null);
  if (!ctx) return { kind: "missing" };
  if (ctx.payment.intentStatus !== "succeeded") return { kind: "not-refundable", status: ctx.payment.status };
  const refunds = await ctx.tx.listRefunds({ paymentId: ctx.payment.id });
  // Money withdrawn by an open or lost dispute is not refundable too: refund + chargeback would pay twice.
  const disputes = await ctx.tx.listDisputes({ paymentId: ctx.payment.id });
  const base = ctx.payment.capturedMinor - disputedMinor({ disputes });
  const available = refundableMinor({ capturedMinor: base, totals: refundTotals({ refunds }) });
  if (!Number.isSafeInteger(required.amountMinor) || required.amountMinor <= 0) return { kind: "invalid-amount" };
  if (required.amountMinor > available) return { kind: "insufficient", refundableMinor: available };
  const refund: RefundRecord = {
    ...newRefundRecord(ctx, { id: required.refundId, providerRefundRef: null, amountMinor: required.amountMinor, status: "reserved" }),
    idempotencyKey: required.idempotencyKey, reason: optional.reason ?? null,
  };
  await ctx.tx.insertRefund({ refund });
  await writeCaches(ctx, {});
  return { kind: "reserved", refund };
}

/**
 * Record what a dispatched refund call answered when it carried no evidence: `rejected` (provably
 * no money moved) → `failed`, releasing the hold; `unknown` (timeout, 5xx) → `unknown`, keeping
 * the hold until a webhook or `retrieve` settles it — never `failed` (bug B4).
 *
 * Only a `reserved` row moves: once a row is `unknown`, `pending` or settled, the provider may
 * already have moved the money, and a later retry being rejected ("already refunded") proves
 * nothing — flipping it to `failed` would release the hold and allow a double refund (L3 review
 * blocker). Those rows settle only through evidence.
 */
export async function recordRefundDispatchOutcome(
  required: Omit<WriterInput, "source"> & { refundId: string; outcome: "rejected" | "unknown" },
  _optional: Record<string, never> = {}
): Promise<ApplyResult> {
  const ctx = await open({ ...required, source: "response" }, null);
  if (!ctx) return { kind: "missing" };
  const refunds = await ctx.tx.listRefunds({ paymentId: ctx.payment.id });
  const row = refunds.find((r) => r.id === required.refundId);
  if (!row) return { kind: "missing" };
  if (row.status === "reserved") {
    const status = required.outcome === "rejected" ? "failed" : "unknown";
    await ctx.tx.updateRefund({ id: row.id, patch: { status, updatedAt: ctx.deps.now() } });
    await writeCaches(ctx, {});
  }
  return { kind: "applied", quarantined: [], outbox: [], deferred: 0 };
}

/**
 * Record what a dispatched `createIntent` answered when it carried no evidence. `rejected`
 * (provably no money moved) → `failed`; `unknown` (timeout, 5xx) leaves the intent `unknown` until
 * a webhook, the reconciler's `retrieve` or an operator settles it — never `failed` (bug B4).
 *
 * Only an `unknown` payment with NO provider ref moves: once any evidence bound a ref or a status
 * (a webhook that beat the response), the provider has spoken and only evidence may change it.
 */
export async function recordIntentDispatchOutcome(
  required: Omit<WriterInput, "source"> & { outcome: "rejected" | "unknown" },
  _optional: Record<string, never> = {}
): Promise<ApplyResult> {
  const ctx = await open({ ...required, source: "response" }, null);
  if (!ctx) return { kind: "missing" };
  const untouched = ctx.payment.intentStatus === "unknown" && ctx.payment.providerRef === null;
  if (required.outcome === "rejected" && untouched) await writeCaches(ctx, { intentStatus: "failed" });
  return { kind: "applied", quarantined: [], outbox: [], deferred: 0 };
}

/** What settling an `unknown` record did. `not-unknown` = it had already moved; nothing was written. */
export type SettleResult =
  | { readonly kind: "settled"; readonly outbox: readonly LedgerOutboxTopic[] }
  | { readonly kind: "not-unknown"; readonly status: string }
  | { readonly kind: "missing" };

/**
 * Settle an `unknown` refund WITHOUT provider evidence of the refund itself: the reconciler's
 * owner rule (the provider's full snapshot lists no such refund → `failed`, source `retrieve`) and
 * an operator's audited resolution (source `operator`). Only from `unknown`: a reserved row has not
 * been dispatched, and a pending/settled one has provider evidence that outranks this. Appends the
 * observation, emits `refund.succeeded` / `refund.failed` (payload `previousStatus: "unknown"`, so a
 * consumer can tell it never counted the money) and re-derives the hold.
 */
export async function settleUnknownRefund(
  required: WriterInput & { refundId: string; status: "succeeded" | "failed" },
  _optional: Record<string, never> = {}
): Promise<SettleResult> {
  const ctx = await open(required, null);
  if (!ctx) return { kind: "missing" };
  const row = (await ctx.tx.listRefunds({ paymentId: ctx.payment.id })).find((r) => r.id === required.refundId);
  if (!row) return { kind: "missing" };
  if (row.status !== "unknown") return { kind: "not-unknown", status: row.status };
  const amount = { minorUnits: row.amountMinor, currency: row.currency };
  await appendEvidence(ctx, { subject: "refund", subjectRef: row.providerRefundRef ?? row.id, status: required.status, amount });
  await ctx.tx.updateRefund({ id: row.id, patch: { status: required.status, updatedAt: ctx.deps.now() } });
  const topic: LedgerOutboxTopic = required.status === "succeeded" ? "refund.succeeded" : "refund.failed";
  await enqueue(ctx, [topic], { refundId: row.id, amountMinor: row.amountMinor, currency: row.currency, previousStatus: "unknown" });
  await writeCaches(ctx, {});
  return { kind: "settled", outbox: ctx.outbox };
}

/**
 * Settle an `unknown` payment intent from an operator's audited resolution (source `operator`):
 * `succeeded` captures the full amount and emits `payment.succeeded`; `failed` moves no money. Only
 * from `unknown`; anything else already has provider evidence.
 */
export async function settleUnknownIntent(
  required: WriterInput & { status: "succeeded" | "failed" },
  _optional: Record<string, never> = {}
): Promise<SettleResult> {
  const ctx = await open(required, null);
  if (!ctx) return { kind: "missing" };
  const p = ctx.payment;
  if (p.intentStatus !== "unknown") return { kind: "not-unknown", status: p.intentStatus };
  const amount = { minorUnits: p.amountMinor, currency: p.currency };
  await appendEvidence(ctx, { subject: "payment", subjectRef: p.providerRef ?? p.id, status: required.status, amount });
  const succeeded = required.status === "succeeded";
  const intent: Partial<PaymentRecord> = succeeded ? { intentStatus: "succeeded", capturedMinor: p.amountMinor } : { intentStatus: "failed" };
  ctx.payment = { ...p, ...intent } as PaymentRecord;
  await enqueue(ctx, succeeded ? ["payment.succeeded"] : [], { amountMinor: p.amountMinor, currency: p.currency });
  await writeCaches(ctx, intent);
  return { kind: "settled", outbox: ctx.outbox };
}
