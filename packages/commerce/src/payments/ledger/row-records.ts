import type { PaymentMode } from "../contract/scope.js";
import type { DerivedPaymentStatus, DisputeStatus, IntentStatus, RefundStatus } from "../state/status.js";
// ---------------------------------------------------------------------------------------------
// Domain records.

export type AttemptOp = "intent" | "capture" | "void" | "refund";
/** `dispatched` = written BEFORE the provider call, so a crash mid-call leaves a row to reconcile. */
export type AttemptOutcome = "dispatched" | "ok" | "rejected" | "unknown";
/** Outcomes of a call that never reported back: the reconciler settles them, and they block a conflicting capture/void. */
export const OPEN_ATTEMPT_OUTCOMES: readonly AttemptOutcome[] = ["dispatched", "unknown"];
/** `operator` = a person resolved an `unknown` outcome (L4 `resolveUnknown`); its audit row is in the operator-actions table. */
export type EvidenceSource = "response" | "webhook" | "retrieve" | "operator";
export type EvidenceSubject = "payment" | "refund" | "dispute";
export type InboxState = "received" | "applied" | "parked" | "dead";
/** The states an inbox row is still open in: due for an apply attempt, and the only ones that may move on. */
export const OPEN_INBOX_STATES: readonly InboxState[] = ["received", "parked"];

/**
 * The inbox columns a revive replaces when it carries a fresh payload (a redelivery's verified copy;
 * none for an operator requeue, which replays the kept facts). Both adapters build the revive from it.
 */
export function revivedPayload(
  _required: Record<string, never> = {},
  { payload }: { payload?: { factsJson: string; bodySha256: string } } = {}
): { facts_json?: string; body_sha256?: string; purged_at?: null } {
  return payload === undefined ? {} : { facts_json: payload.factsJson, body_sha256: payload.bodySha256, purged_at: null };
}
export type LedgerOutboxTopic = "payment.succeeded" | "refund.succeeded" | "refund.failed" | "dispute.opened" | "dispute.closed";
/** Open-ended on purpose: L3/L4 add reasons without a migration (the column is free TEXT). */
export type LedgerQuarantineReason = "over-refund" | "bad-amount" | "currency-mismatch" | "unmatched" | (string & {});

export interface PaymentRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly idempotencyKey: string;
  readonly reference: string;
  /** Opaque party id; never a name, email or IP. */
  readonly partyId: string | null;
  readonly currency: string;
  readonly amountMinor: number;
  readonly capturedMinor: number;
  readonly intentStatus: IntentStatus;
  /** Derived caches, written only by the L3 single writer from the refund/dispute rows. */
  readonly refundedMinor: number;
  readonly refundHeldMinor: number;
  readonly disputedMinor: number;
  readonly status: DerivedPaymentStatus;
  readonly providerRef: string | null;
  /** The serialized `NextAction`; the writer owns (de)serialization so the ledger stays schema-free. */
  readonly nextActionJson: string | null;
  readonly feeCurrency: string | null;
  readonly feeMinor: number | null;
  readonly netCurrency: string | null;
  readonly netMinor: number | null;
  readonly settlementCurrency: string | null;
  readonly settlementMinor: number | null;
  /** Optimistic-concurrency version; starts at 1, bumped by every successful `updatePayment`. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** What `insertPayment` takes: the ledger assigns `version` (1). */
export type NewPayment = Omit<PaymentRecord, "version">;

export interface AttemptRecord {
  /** Credential-free original intent request; NULL on historical/ineligible attempts. */
  readonly dispatchJson: string | null;
  readonly recoveryAttempts: number;
  readonly recoveryClaimUntil: number | null;
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly op: AttemptOp;
  readonly operationKey: string;
  readonly refundId: string | null;
  readonly outcome: AttemptOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The amount a capture requested (compared on replay); null for other ops and for rows written before 0004. */
  readonly currency: string | null;
  readonly amountMinor: number | null;
}

export interface RefundRecord {
  /** OUR id, sent to the provider as the correlation id. */
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  /** NULL for a refund made at the provider (it arrived by webhook, no caller key). */
  readonly idempotencyKey: string | null;
  readonly providerRefundRef: string | null;
  readonly currency: string;
  readonly amountMinor: number;
  readonly status: RefundStatus;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DisputeRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly providerDisputeRef: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly status: DisputeStatus;
  readonly dueBy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly source: EvidenceSource;
  readonly subject: EvidenceSubject;
  /** The provider's id for the subject (payment, refund or dispute ref). */
  readonly subjectRef: string;
  readonly observedStatus: string;
  readonly currency: string | null;
  readonly amountMinor: number | null;
  readonly inboxId: string | null;
  readonly recordedAt: number;
}

export interface InboxRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly providerEventId: string;
  /** The verified facts; set to NULL once applied (no raw payload outlives its use). */
  readonly factsJson: string | null;
  /** sha256 hex of the raw body; kept after the purge so a replayed body can still be recognized. */
  readonly bodySha256: string;
  readonly state: InboxState;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError: string | null;
  readonly receivedAt: number;
  readonly appliedAt: number | null;
  readonly purgedAt: number | null;
}

/** What `insertInbox` takes: a fresh row is `received`, never attempted, never applied. */
export type NewInbox = Omit<InboxRecord, "state" | "attempts" | "lastError" | "appliedAt" | "purgedAt">;

export interface OutboxRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly topic: LedgerOutboxTopic;
  readonly aggregateId: string;
  readonly payloadJson: string;
  readonly createdAt: number;
  readonly publishedAt: number | null;
}

export type NewOutbox = Omit<OutboxRecord, "publishedAt">;

export interface QuarantineRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly paymentId: string | null;
  readonly subject: EvidenceSubject | (string & {});
  readonly reason: LedgerQuarantineReason;
  readonly evidenceJson: string;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

export type NewQuarantine = Omit<QuarantineRecord, "resolvedAt">;

/** The refund statuses that still hold money and await evidence: what the reconciler scans. */
export const UNSETTLED_REFUND_STATUSES: readonly RefundStatus[] = ["reserved", "unknown", "pending"];

/** What an operator did. One kind today; the column is free TEXT so more need no migration. */
export type OperatorActionKind = "resolve-unknown";

/**
 * One audited operator action (append-only: the port has no update or delete). `refundId` is set
 * when the action was about a refund of the payment; `actor` is an opaque operator id, never an email.
 */
export interface OperatorActionRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly providerId: string;
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
  readonly refundId: string | null;
  readonly action: OperatorActionKind;
  readonly outcome: string;
  readonly actor: string;
  readonly reason: string;
  readonly createdAt: number;
}
