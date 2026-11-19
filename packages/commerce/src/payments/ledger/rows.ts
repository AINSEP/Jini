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
import type { ColumnType } from "kysely";
import type { PaymentMode } from "../contract/scope.js";
import { type PaymentRecord, type AttemptRecord, type RefundRecord, type DisputeRecord, type EvidenceRecord, type InboxRecord, type OutboxRecord, type QuarantineRecord, type OperatorActionRecord } from './row-records.js';
import { type PaymentsTable, type AttemptsTable, type RefundsTable, type DisputesTable, type EvidenceTable, type InboxTable, type OutboxTable, type QuarantineTable, type OperatorActionsTable } from './row-tables.js';
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
  "received_at", "applied_at", "purged_at", "published_at", "resolved_at", "seq", "recovery_attempts", "recovery_claim_until",
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
  commerce_payment_attempts: { nullable: ["refund_id", "error_code", "error_message", "currency", "amount_minor", "dispatch_json", "recovery_claim_until"], nonNegative: ["recovery_attempts"] },
  commerce_refunds: { nullable: ["idempotency_key", "provider_refund_ref", "reason"], nonNegative: ["amount_minor"] },
  commerce_disputes: { nullable: ["due_by"], nonNegative: ["amount_minor"] },
  commerce_payment_evidence: { nullable: ["currency", "amount_minor", "inbox_id"], nonNegative: [] },
  commerce_webhook_inbox: { nullable: ["facts_json", "last_error", "applied_at", "purged_at"], nonNegative: [] },
  commerce_outbox: { nullable: ["published_at"], nonNegative: [] },
  commerce_quarantine: { nullable: ["payment_id", "resolved_at"], nonNegative: [] },
  commerce_operator_actions: { nullable: ["refund_id"], nonNegative: [] },
};

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
    dispatch_json: r.dispatchJson, recovery_attempts: r.recoveryAttempts, recovery_claim_until: r.recoveryClaimUntil,
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

export function operatorActionToRow(r: OperatorActionRecord, _optional: Record<string, never> = {}): StoredRow<OperatorActionsTable> {
  return encodeColumns({
    id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
    provider_account_id: r.providerAccountId, mode: r.mode, refund_id: r.refundId, action: r.action, outcome: r.outcome,
    actor: r.actor, reason: r.reason, created_at: r.createdAt,
  });
}
