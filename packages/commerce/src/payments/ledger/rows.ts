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
 * - Every integer WRITE goes through ONE encoder, {@link encodeMinor} (via {@link encodeColumns}),
 *   in both adapters, so a fraction or an unsafe number is refused before it reaches storage.
 */
import type { ColumnType, Selectable } from "kysely";

import type { PaymentMode } from "../contract/scope.js";
import type { DerivedPaymentStatus, DisputeStatus, IntentStatus, RefundStatus } from "../state/status.js";

// ---------------------------------------------------------------------------------------------
// The one integer decoder.

// Unlike `$`, this end assertion cannot match before a trailing line terminator.
const DECIMAL_INTEGER = /^-?\d+(?![\s\S])/;

function fail(value: unknown): never {
  throw new TypeError(`ledger: expected a safe integer from the database, got ${typeof value} ${String(value)}`);
}

/**
 * The safe integer a BIGINT/INTEGER column holds. Accepts a number, a decimal string (node-pg's
 * BIGINT) or a bigint (better-sqlite3 `safeIntegers`, PGlite); throws a `TypeError` on anything
 * else, on a fraction and on a value beyond `Number.MAX_SAFE_INTEGER` — never rounds.
 *
 * @example decodeMinor({ value: "1999" }) === 1999
 */
export function decodeMinor({ value }: { value: unknown }, _optional: Record<string, never> = {}): number {
  if (typeof value === "string") return DECIMAL_INTEGER.test(value) ? checkedSafe(Number(value), value) : fail(value);
  if (typeof value === "bigint") return checkedSafe(Number(value), value);
  return typeof value === "number" ? checkedSafe(value, value) : fail(value);
}

/** `-0` is normalized to `0` on both read and write, so it never reaches a comparison or a JSON payload. */
function checkedSafe(decoded: number, original: unknown): number {
  if (!Number.isSafeInteger(decoded)) fail(original);
  return decoded === 0 ? 0 : decoded;
}

/** {@link decodeMinor} for a NULLable column: SQL NULL stays `null`. */
export function decodeNullableMinor({ value }: { value: unknown }, _optional: Record<string, never> = {}): number | null {
  return value === null ? null : decodeMinor({ value });
}

/**
 * The guard on write: the safe integer to store for an integer column. Throws a `TypeError` on a
 * non-number, a fraction, NaN/Infinity and anything beyond `Number.MAX_SAFE_INTEGER` (the driver
 * would otherwise round, truncate or store REAL); normalizes `-0` to `0`.
 *
 * @example encodeMinor({ value: 1999 }) === 1999
 */
export function encodeMinor({ value }: { value: number }, _optional: Record<string, never> = {}): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`ledger: expected a safe integer to write, got ${typeof value} ${String(value)}`);
  }
  return value === 0 ? 0 : value;
}

/** {@link encodeMinor} for a NULLable column: `null` stays `null` (a NOT NULL column then refuses it). */
export function encodeNullableMinor({ value }: { value: number | null }, _optional: Record<string, never> = {}): number | null {
  return value === null ? null : encodeMinor({ value });
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
  /** Added by `0002_payments_operator_actions` (L4): the append-only audit of operator resolutions. */
  operatorActions: "commerce_operator_actions",
} as const;

export type LedgerTableName = (typeof LEDGER_TABLES)[keyof typeof LEDGER_TABLES];

/**
 * Every BIGINT/INTEGER column name across the ledger tables. A column name means the same thing in
 * every table, so one set drives {@link encodeColumns}; `migrations.vitest.test.ts` holds it equal
 * to the integer columns the migration actually creates.
 */
export const LEDGER_INTEGER_COLUMNS: ReadonlySet<string> = new Set([
  "amount_minor", "captured_minor", "refunded_minor", "refund_held_minor", "disputed_minor", "fee_minor", "net_minor",
  "settlement_minor", "version", "created_at", "updated_at", "due_by", "recorded_at", "attempts", "next_attempt_at",
  "received_at", "applied_at", "purged_at", "published_at", "resolved_at", "seq",
]);

/**
 * `set` with every integer column passed through {@link encodeNullableMinor}; other columns as given.
 * Both adapters build every insert row and every update `set` through this.
 */
export function encodeColumns<S extends object>(set: S, _optional: Record<string, never> = {}): S {
  const out: Record<string, unknown> = { ...(set as Record<string, unknown>) };
  for (const [column, value] of Object.entries(set)) {
    if (LEDGER_INTEGER_COLUMNS.has(column)) out[column] = encodeNullableMinor({ value: value as number | null });
  }
  return out as S;
}

/**
 * The structural rules the migration's NOT NULL and CHECK constraints enforce, per table, for the
 * in-memory adapter to enforce identically. Every table also CHECKs `mode IN ('test', 'live')`
 * ({@link LEDGER_MODES}). `migrations.vitest.test.ts` holds this equal to the created schema.
 */
export interface LedgerTableRules {
  /** The only columns that may hold NULL; every other column (the primary key included) is NOT NULL. */
  readonly nullable: readonly string[];
  /** Columns CHECKed `>= 0`. */
  readonly nonNegative: readonly string[];
}

export const LEDGER_MODES: readonly PaymentMode[] = ["test", "live"];

export const LEDGER_TABLE_RULES: Readonly<Record<LedgerTableName, LedgerTableRules>> = {
  commerce_payments: {
    nullable: [
      "party_id", "provider_ref", "next_action_json", "fee_currency", "fee_minor", "net_currency", "net_minor",
      "settlement_currency", "settlement_minor",
    ],
    nonNegative: ["amount_minor", "captured_minor", "refunded_minor", "refund_held_minor", "disputed_minor"],
  },
  // `currency` / `amount_minor` added by 0004 (a capture's requested amount).
  commerce_payment_attempts: { nullable: ["refund_id", "error_code", "error_message", "currency", "amount_minor"], nonNegative: [] },
  commerce_refunds: { nullable: ["idempotency_key", "provider_refund_ref", "reason"], nonNegative: ["amount_minor"] },
  commerce_disputes: { nullable: ["due_by"], nonNegative: ["amount_minor"] },
  commerce_payment_evidence: { nullable: ["currency", "amount_minor", "inbox_id"], nonNegative: [] },
  commerce_webhook_inbox: { nullable: ["facts_json", "last_error", "applied_at", "purged_at"], nonNegative: [] },
  commerce_outbox: { nullable: ["published_at"], nonNegative: [] },
  commerce_quarantine: { nullable: ["payment_id", "resolved_at"], nonNegative: [] },
  commerce_operator_actions: { nullable: ["refund_id"], nonNegative: [] },
};

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
  site_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  op: string;
  operation_key: string;
  refund_id: string | null;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Int;
  updated_at: Int;
  /** 0004: the amount a capture requested; NULL for other ops and older rows. */
  currency: string | null;
  amount_minor: NullableInt;
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
  site_id: string;
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
  site_id: string;
  provider_id: string;
  provider_account_id: string;
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

export interface OperatorActionsTable {
  id: string;
  payment_id: string;
  workspace_id: string;
  site_id: string;
  provider_id: string;
  provider_account_id: string;
  mode: string;
  refund_id: string | null;
  action: string;
  outcome: string;
  actor: string;
  reason: string;
  created_at: Int;
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
  commerce_operator_actions: OperatorActionsTable;
}

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
  { payload }: { payload?: { factsJson: string; bodySha256: string } },
  _optional: Record<string, never> = {}
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
 * The column→value `set` for a patch, integers encoded: only the keys the patch actually carries,
 * so an omitted (or `undefined`) field is left alone rather than written as NULL. `columns` is the
 * allow-list: a key it does not name (a scope column, the version, a typo smuggled past the type)
 * throws a `TypeError` instead of being written. Both adapters build every patch through this.
 */
export function patchColumns<P extends object>(
  { patch, columns }: { patch: P; columns: Readonly<Record<keyof P, string>> },
  _optional: Record<string, never> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(columns, key)) throw new TypeError(`ledger: ${key} is not a patchable field`);
    if (value !== undefined) out[columns[key as keyof P]] = value;
  }
  return encodeColumns(out);
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
    amountMinor: decodeMinor({ value: row.amount_minor }),
    capturedMinor: decodeMinor({ value: row.captured_minor }),
    intentStatus: row.intent_status as IntentStatus,
    refundedMinor: decodeMinor({ value: row.refunded_minor }),
    refundHeldMinor: decodeMinor({ value: row.refund_held_minor }),
    disputedMinor: decodeMinor({ value: row.disputed_minor }),
    status: row.status as DerivedPaymentStatus,
    providerRef: row.provider_ref,
    nextActionJson: row.next_action_json,
    feeCurrency: row.fee_currency,
    feeMinor: decodeNullableMinor({ value: row.fee_minor }),
    netCurrency: row.net_currency,
    netMinor: decodeNullableMinor({ value: row.net_minor }),
    settlementCurrency: row.settlement_currency,
    settlementMinor: decodeNullableMinor({ value: row.settlement_minor }),
    version: decodeMinor({ value: row.version }),
    createdAt: decodeMinor({ value: row.created_at }),
    updatedAt: decodeMinor({ value: row.updated_at }),
  };
}

export function attemptFromRow(row: Selectable<AttemptsTable>, _optional: Record<string, never> = {}): AttemptRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    op: row.op as AttemptOp,
    operationKey: row.operation_key,
    refundId: row.refund_id,
    outcome: row.outcome as AttemptOutcome,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: decodeMinor({ value: row.created_at }),
    updatedAt: decodeMinor({ value: row.updated_at }),
    currency: row.currency,
    amountMinor: decodeNullableMinor({ value: row.amount_minor }),
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
    amountMinor: decodeMinor({ value: row.amount_minor }),
    status: row.status as RefundStatus,
    reason: row.reason,
    createdAt: decodeMinor({ value: row.created_at }),
    updatedAt: decodeMinor({ value: row.updated_at }),
  };
}

export function disputeFromRow(row: Selectable<DisputesTable>, _optional: Record<string, never> = {}): DisputeRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    providerDisputeRef: row.provider_dispute_ref,
    currency: row.currency,
    amountMinor: decodeMinor({ value: row.amount_minor }),
    status: row.status as DisputeStatus,
    dueBy: decodeNullableMinor({ value: row.due_by }),
    createdAt: decodeMinor({ value: row.created_at }),
    updatedAt: decodeMinor({ value: row.updated_at }),
  };
}

export function evidenceFromRow(row: Selectable<EvidenceTable>, _optional: Record<string, never> = {}): EvidenceRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    source: row.source as EvidenceSource,
    subject: row.subject as EvidenceSubject,
    subjectRef: row.subject_ref,
    observedStatus: row.observed_status,
    currency: row.currency,
    amountMinor: decodeNullableMinor({ value: row.amount_minor }),
    inboxId: row.inbox_id,
    recordedAt: decodeMinor({ value: row.recorded_at }),
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
    attempts: decodeMinor({ value: row.attempts }),
    nextAttemptAt: decodeMinor({ value: row.next_attempt_at }),
    lastError: row.last_error,
    receivedAt: decodeMinor({ value: row.received_at }),
    appliedAt: decodeNullableMinor({ value: row.applied_at }),
    purgedAt: decodeNullableMinor({ value: row.purged_at }),
  };
}

export function outboxFromRow(row: Selectable<OutboxTable>, _optional: Record<string, never> = {}): OutboxRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: row.mode as PaymentMode,
    topic: row.topic as LedgerOutboxTopic,
    aggregateId: row.aggregate_id,
    payloadJson: row.payload_json,
    createdAt: decodeMinor({ value: row.created_at }),
    publishedAt: decodeNullableMinor({ value: row.published_at }),
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
    createdAt: decodeMinor({ value: row.created_at }),
    resolvedAt: decodeNullableMinor({ value: row.resolved_at }),
  };
}

// ---------------------------------------------------------------------------------------------
// Record → row mappers (writes). Every integer goes through encodeColumns, so a bad number throws
// a `TypeError` before any storage is touched.

/** A complete row as written: every integer column a plain safe number. */
export type StoredRow<T> = { [K in keyof T]: T[K] extends ColumnType<unknown, infer I, unknown> ? I : T[K] };

export function paymentToRow(r: PaymentRecord, _optional: Record<string, never> = {}): StoredRow<PaymentsTable> {
  return encodeColumns({
    id: r.id, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId, provider_account_id: r.providerAccountId,
    mode: r.mode, idempotency_key: r.idempotencyKey, reference: r.reference, party_id: r.partyId, currency: r.currency,
    amount_minor: r.amountMinor, captured_minor: r.capturedMinor, intent_status: r.intentStatus, refunded_minor: r.refundedMinor,
    refund_held_minor: r.refundHeldMinor, disputed_minor: r.disputedMinor, status: r.status, provider_ref: r.providerRef,
    next_action_json: r.nextActionJson, fee_currency: r.feeCurrency, fee_minor: r.feeMinor, net_currency: r.netCurrency,
    net_minor: r.netMinor, settlement_currency: r.settlementCurrency, settlement_minor: r.settlementMinor, version: r.version,
    created_at: r.createdAt, updated_at: r.updatedAt,
  });
}

export function attemptToRow(r: AttemptRecord, _optional: Record<string, never> = {}): StoredRow<AttemptsTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, op: r.op, operation_key: r.operationKey, refund_id: r.refundId,
    outcome: r.outcome, error_code: r.errorCode, error_message: r.errorMessage, created_at: r.createdAt, updated_at: r.updatedAt,
    currency: r.currency, amount_minor: r.amountMinor,
  });
}

export function refundToRow(r: RefundRecord, _optional: Record<string, never> = {}): StoredRow<RefundsTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, idempotency_key: r.idempotencyKey,
    provider_refund_ref: r.providerRefundRef, currency: r.currency, amount_minor: r.amountMinor, status: r.status,
    reason: r.reason, created_at: r.createdAt, updated_at: r.updatedAt,
  });
}

export function disputeToRow(r: DisputeRecord, _optional: Record<string, never> = {}): StoredRow<DisputesTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, provider_dispute_ref: r.providerDisputeRef, currency: r.currency,
    amount_minor: r.amountMinor, status: r.status, due_by: r.dueBy, created_at: r.createdAt, updated_at: r.updatedAt,
  });
}

export function evidenceToRow(r: EvidenceRecord, _optional: Record<string, never> = {}): StoredRow<EvidenceTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, source: r.source, subject: r.subject, subject_ref: r.subjectRef,
    observed_status: r.observedStatus, currency: r.currency, amount_minor: r.amountMinor, inbox_id: r.inboxId,
    recorded_at: r.recordedAt,
  });
}

export function inboxToRow(r: InboxRecord, _optional: Record<string, never> = {}): StoredRow<InboxTable> {
  return encodeColumns({
    id: r.id, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId, provider_account_id: r.providerAccountId,
    mode: r.mode, provider_event_id: r.providerEventId, facts_json: r.factsJson, body_sha256: r.bodySha256, state: r.state,
    attempts: r.attempts, next_attempt_at: r.nextAttemptAt, last_error: r.lastError, received_at: r.receivedAt,
    applied_at: r.appliedAt, purged_at: r.purgedAt,
  });
}

export function outboxToRow(r: OutboxRecord, _optional: Record<string, never> = {}): StoredRow<OutboxTable> {
  return encodeColumns({
    id: r.id, workspace_id: r.workspaceId, mode: r.mode, topic: r.topic, aggregate_id: r.aggregateId,
    payload_json: r.payloadJson, created_at: r.createdAt, published_at: r.publishedAt,
  });
}

export function quarantineToRow(r: QuarantineRecord, _optional: Record<string, never> = {}): StoredRow<QuarantineTable> {
  return encodeColumns({
    id: r.id, workspace_id: r.workspaceId, mode: r.mode, payment_id: r.paymentId, subject: r.subject, reason: r.reason,
    evidence_json: r.evidenceJson, created_at: r.createdAt, resolved_at: r.resolvedAt,
  });
}

export function operatorActionFromRow(row: Selectable<OperatorActionsTable>, _optional: Record<string, never> = {}): OperatorActionRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    providerId: row.provider_id,
    providerAccountId: row.provider_account_id,
    mode: row.mode as PaymentMode,
    refundId: row.refund_id,
    action: row.action as OperatorActionKind,
    outcome: row.outcome,
    actor: row.actor,
    reason: row.reason,
    createdAt: decodeMinor({ value: row.created_at }),
  };
}

export function operatorActionToRow(r: OperatorActionRecord, _optional: Record<string, never> = {}): StoredRow<OperatorActionsTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, refund_id: r.refundId, action: r.action, outcome: r.outcome,
    actor: r.actor, reason: r.reason, created_at: r.createdAt,
  });
}
