/**
 * @file The payments ledger's storage shapes (design 2026-10-21, lot L2): the Kysely table types
 * the SQL adapter queries, the camelCase domain records every caller sees, and the row↔record
 * mappers between them.
 *
 * Conventions every table follows:
 * - Money is BIGINT minor units; times are BIGINT epoch ms. No floats, no booleans.
 * - Every money row carries its scope (workspace + provider account + live/test mode, gap check
 *   item 1), so a test-mode or foreign-account event can never address a live payment.
 * - No personal data (gap check item 4): `party_id` is an opaque id; names, emails and IPs live in
 *   an erasable table owned elsewhere. Raw webhook bodies are purged after apply (hash kept).
 * - Every integer read goes through ONE decoder, {@link decodeMinor}: node-postgres returns BIGINT
 *   as a decimal string, better-sqlite3 in `safeIntegers` mode as a `bigint`, and a silently
 *   rounded amount is a money bug, so anything that is not a safe integer throws.
 */
import type { ColumnType, Selectable } from "kysely";

import type { PaymentMode } from "../contract/scope.js";
import type { DerivedPaymentStatus, DisputeStatus, IntentStatus, RefundStatus } from "../state/status.js";

// ---------------------------------------------------------------------------------------------
// The one integer decoder.

const DECIMAL_INTEGER = /^-?\d+$/;

function fail(value: unknown): never {
  throw new TypeError(`ledger: expected a safe integer from the database, got ${typeof value} ${String(value)}`);
}

/**
 * The safe integer a BIGINT/INTEGER column holds. Accepts a number, a decimal string (node-pg's
 * BIGINT) or a bigint (better-sqlite3 `safeIntegers`, PGlite); throws a `TypeError` on anything
 * else, on a fraction and on a value beyond `Number.MAX_SAFE_INTEGER` — never rounds.
 *
 * @example decodeMinor("1999") === 1999
 */
export function decodeMinor(value: unknown, _optional: Record<string, never> = {}): number {
  if (typeof value === "string") return DECIMAL_INTEGER.test(value) ? checkedSafe(Number(value), value) : fail(value);
  if (typeof value === "bigint") return checkedSafe(Number(value), value);
  return typeof value === "number" ? checkedSafe(value, value) : fail(value);
}

function checkedSafe(decoded: number, original: unknown): number {
  return Number.isSafeInteger(decoded) ? decoded : fail(original);
}

/** {@link decodeMinor} for a NULLable column: SQL NULL stays `null`. */
export function decodeNullableMinor(value: unknown, _optional: Record<string, never> = {}): number | null {
  return value === null ? null : decodeMinor(value);
}

// ---------------------------------------------------------------------------------------------
// Table names and Kysely table types (snake_case, exactly as `migrations/0001_payments_ledger.ts`
// creates them).

export const LEDGER_TABLES = {
  payments: "commerce_payments",
  attempts: "commerce_payment_attempts",
  refunds: "commerce_refunds",
  disputes: "commerce_disputes",
  evidence: "commerce_payment_evidence",
  inbox: "commerce_webhook_inbox",
  outbox: "commerce_outbox",
  quarantine: "commerce_quarantine",
} as const;

/** What an integer column reads as on any driver (see {@link decodeMinor}); written as a number. */
type Int = ColumnType<number | string | bigint, number, number>;
type NullableInt = ColumnType<number | string | bigint | null, number | null, number | null>;

export interface PaymentsTable {
  id: string;
  workspace_id: string;
  site_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  idempotency_key: string;
  reference: string;
  party_id: string | null;
  currency: string;
  amount_minor: Int;
  captured_minor: Int;
  intent_status: string;
  refunded_minor: Int;
  refund_held_minor: Int;
  disputed_minor: Int;
  status: string;
  provider_ref: string | null;
  next_action_json: string | null;
  fee_currency: string | null;
  fee_minor: NullableInt;
  net_currency: string | null;
  net_minor: NullableInt;
  settlement_currency: string | null;
  settlement_minor: NullableInt;
  version: Int;
  created_at: Int;
  updated_at: Int;
}

export interface AttemptsTable {
  id: string;
  payment_id: string;
  workspace_id: string;
  mode: string;
  op: string;
  operation_key: string;
  refund_id: string | null;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Int;
  updated_at: Int;
}

export interface RefundsTable {
  id: string;
  payment_id: string;
  workspace_id: string;
  site_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  idempotency_key: string | null;
  provider_refund_ref: string | null;
  currency: string;
  amount_minor: Int;
  status: string;
  reason: string | null;
  created_at: Int;
  updated_at: Int;
}

export interface DisputesTable {
  id: string;
  payment_id: string;
  workspace_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  provider_dispute_ref: string;
  currency: string;
  amount_minor: Int;
  status: string;
  due_by: NullableInt;
  created_at: Int;
  updated_at: Int;
}

export interface EvidenceTable {
  id: string;
  payment_id: string;
  workspace_id: string;
  mode: string;
  source: string;
  subject: string;
  subject_ref: string;
  observed_status: string;
  currency: string | null;
  amount_minor: NullableInt;
  inbox_id: string | null;
  recorded_at: Int;
}

export interface InboxTable {
  id: string;
  workspace_id: string;
  site_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  provider_event_id: string;
  facts_json: string | null;
  body_sha256: string;
  state: string;
  attempts: Int;
  next_attempt_at: Int;
  last_error: string | null;
  received_at: Int;
  applied_at: NullableInt;
  purged_at: NullableInt;
}

export interface OutboxTable {
  id: string;
  workspace_id: string;
  mode: string;
  topic: string;
  aggregate_id: string;
  payload_json: string;
  created_at: Int;
  published_at: NullableInt;
}

export interface QuarantineTable {
  id: string;
  workspace_id: string;
  mode: string;
  payment_id: string | null;
  subject: string;
  reason: string;
  evidence_json: string;
  created_at: Int;
  resolved_at: NullableInt;
}

/** The Kysely database view of the ledger tables (nothing else). */
export interface PaymentsLedgerDatabase {
  commerce_payments: PaymentsTable;
  commerce_payment_attempts: AttemptsTable;
  commerce_refunds: RefundsTable;
  commerce_disputes: DisputesTable;
  commerce_payment_evidence: EvidenceTable;
  commerce_webhook_inbox: InboxTable;
  commerce_outbox: OutboxTable;
  commerce_quarantine: QuarantineTable;
}

// ---------------------------------------------------------------------------------------------
// Domain records.

export type AttemptOp = "intent" | "capture" | "void" | "refund";
/** `dispatched` = written BEFORE the provider call, so a crash mid-call leaves a row to reconcile. */
export type AttemptOutcome = "dispatched" | "ok" | "rejected" | "unknown";
export type EvidenceSource = "response" | "webhook" | "retrieve";
export type EvidenceSubject = "payment" | "refund" | "dispute";
export type InboxState = "received" | "applied" | "parked" | "dead";
export type OutboxTopic = "payment.succeeded" | "refund.succeeded" | "refund.failed" | "dispute.opened" | "dispute.closed";
/** Open-ended on purpose: L3/L4 add reasons without a migration (the column is free TEXT). */
export type QuarantineReason = "over-refund" | "bad-amount" | "currency-mismatch" | "unmatched" | (string & {});

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
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly op: AttemptOp;
  readonly operationKey: string;
  readonly refundId: string | null;
  readonly outcome: AttemptOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
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
  readonly topic: OutboxTopic;
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
  readonly reason: QuarantineReason;
  readonly evidenceJson: string;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

export type NewQuarantine = Omit<QuarantineRecord, "resolvedAt">;

// ---------------------------------------------------------------------------------------------
// Patches: the fields an update may change, mapped to their columns.

export type PaymentPatch = Partial<
  Pick<
    PaymentRecord,
    | "partyId" | "capturedMinor" | "intentStatus" | "refundedMinor" | "refundHeldMinor" | "disputedMinor" | "status"
    | "providerRef" | "nextActionJson" | "feeCurrency" | "feeMinor" | "netCurrency" | "netMinor"
    | "settlementCurrency" | "settlementMinor"
  >
> & { readonly updatedAt: number };

export type AttemptPatch = Partial<Pick<AttemptRecord, "outcome" | "errorCode" | "errorMessage">> & { readonly updatedAt: number };
export type RefundPatch = Partial<Pick<RefundRecord, "status" | "providerRefundRef" | "reason">> & { readonly updatedAt: number };
export type DisputePatch = Partial<Pick<DisputeRecord, "status" | "amountMinor" | "dueBy">> & { readonly updatedAt: number };

export const PAYMENT_PATCH_COLUMNS: Readonly<Record<keyof PaymentPatch, keyof PaymentsTable>> = {
  partyId: "party_id",
  capturedMinor: "captured_minor",
  intentStatus: "intent_status",
  refundedMinor: "refunded_minor",
  refundHeldMinor: "refund_held_minor",
  disputedMinor: "disputed_minor",
  status: "status",
  providerRef: "provider_ref",
  nextActionJson: "next_action_json",
  feeCurrency: "fee_currency",
  feeMinor: "fee_minor",
  netCurrency: "net_currency",
  netMinor: "net_minor",
  settlementCurrency: "settlement_currency",
  settlementMinor: "settlement_minor",
  updatedAt: "updated_at",
};

export const ATTEMPT_PATCH_COLUMNS: Readonly<Record<keyof AttemptPatch, keyof AttemptsTable>> = {
  outcome: "outcome",
  errorCode: "error_code",
  errorMessage: "error_message",
  updatedAt: "updated_at",
};

export const REFUND_PATCH_COLUMNS: Readonly<Record<keyof RefundPatch, keyof RefundsTable>> = {
  status: "status",
  providerRefundRef: "provider_refund_ref",
  reason: "reason",
  updatedAt: "updated_at",
};

export const DISPUTE_PATCH_COLUMNS: Readonly<Record<keyof DisputePatch, keyof DisputesTable>> = {
  status: "status",
  amountMinor: "amount_minor",
  dueBy: "due_by",
  updatedAt: "updated_at",
};

/**
 * The column→value object for a patch: only the keys the patch actually carries, so an omitted
 * field is left alone rather than written as NULL.
 */
export function patchColumns<P extends object>(
  { patch, columns }: { patch: P; columns: Readonly<Record<keyof P, string>> },
  _optional: Record<string, never> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[columns[key as keyof P]] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Row → record mappers (reads). Every integer goes through decodeMinor.

export function paymentFromRow(row: Selectable<PaymentsTable>, _optional: Record<string, never> = {}): PaymentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    idempotencyKey: row.idempotency_key,
    reference: row.reference,
    partyId: row.party_id,
    currency: row.currency,
    amountMinor: decodeMinor(row.amount_minor),
    capturedMinor: decodeMinor(row.captured_minor),
    intentStatus: row.intent_status as IntentStatus,
    refundedMinor: decodeMinor(row.refunded_minor),
    refundHeldMinor: decodeMinor(row.refund_held_minor),
    disputedMinor: decodeMinor(row.disputed_minor),
    status: row.status as DerivedPaymentStatus,
    providerRef: row.provider_ref,
    nextActionJson: row.next_action_json,
    feeCurrency: row.fee_currency,
    feeMinor: decodeNullableMinor(row.fee_minor),
    netCurrency: row.net_currency,
    netMinor: decodeNullableMinor(row.net_minor),
    settlementCurrency: row.settlement_currency,
    settlementMinor: decodeNullableMinor(row.settlement_minor),
    version: decodeMinor(row.version),
    createdAt: decodeMinor(row.created_at),
    updatedAt: decodeMinor(row.updated_at),
  };
}

export function attemptFromRow(row: Selectable<AttemptsTable>, _optional: Record<string, never> = {}): AttemptRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    mode: row.mode as PaymentMode,
    op: row.op as AttemptOp,
    operationKey: row.operation_key,
    refundId: row.refund_id,
    outcome: row.outcome as AttemptOutcome,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: decodeMinor(row.created_at),
    updatedAt: decodeMinor(row.updated_at),
  };
}

export function refundFromRow(row: Selectable<RefundsTable>, _optional: Record<string, never> = {}): RefundRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    idempotencyKey: row.idempotency_key,
    providerRefundRef: row.provider_refund_ref,
    currency: row.currency,
    amountMinor: decodeMinor(row.amount_minor),
    status: row.status as RefundStatus,
    reason: row.reason,
    createdAt: decodeMinor(row.created_at),
    updatedAt: decodeMinor(row.updated_at),
  };
}

export function disputeFromRow(row: Selectable<DisputesTable>, _optional: Record<string, never> = {}): DisputeRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    providerDisputeRef: row.provider_dispute_ref,
    currency: row.currency,
    amountMinor: decodeMinor(row.amount_minor),
    status: row.status as DisputeStatus,
    dueBy: decodeNullableMinor(row.due_by),
    createdAt: decodeMinor(row.created_at),
    updatedAt: decodeMinor(row.updated_at),
  };
}

export function evidenceFromRow(row: Selectable<EvidenceTable>, _optional: Record<string, never> = {}): EvidenceRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    mode: row.mode as PaymentMode,
    source: row.source as EvidenceSource,
    subject: row.subject as EvidenceSubject,
    subjectRef: row.subject_ref,
    observedStatus: row.observed_status,
    currency: row.currency,
    amountMinor: decodeNullableMinor(row.amount_minor),
    inboxId: row.inbox_id,
    recordedAt: decodeMinor(row.recorded_at),
  };
}

export function inboxFromRow(row: Selectable<InboxTable>, _optional: Record<string, never> = {}): InboxRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    providerEventId: row.provider_event_id,
    factsJson: row.facts_json,
    bodySha256: row.body_sha256,
    state: row.state as InboxState,
    attempts: decodeMinor(row.attempts),
    nextAttemptAt: decodeMinor(row.next_attempt_at),
    lastError: row.last_error,
    receivedAt: decodeMinor(row.received_at),
    appliedAt: decodeNullableMinor(row.applied_at),
    purgedAt: decodeNullableMinor(row.purged_at),
  };
}

export function outboxFromRow(row: Selectable<OutboxTable>, _optional: Record<string, never> = {}): OutboxRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: row.mode as PaymentMode,
    topic: row.topic as OutboxTopic,
    aggregateId: row.aggregate_id,
    payloadJson: row.payload_json,
    createdAt: decodeMinor(row.created_at),
    publishedAt: decodeNullableMinor(row.published_at),
  };
}

export function quarantineFromRow(row: Selectable<QuarantineTable>, _optional: Record<string, never> = {}): QuarantineRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: row.mode as PaymentMode,
    paymentId: row.payment_id,
    subject: row.subject,
    reason: row.reason,
    evidenceJson: row.evidence_json,
    createdAt: decodeMinor(row.created_at),
    resolvedAt: decodeNullableMinor(row.resolved_at),
  };
}
