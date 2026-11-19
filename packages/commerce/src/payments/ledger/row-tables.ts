import type { ColumnType } from "kysely";
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
  dispatch_json: string | null;
  recovery_attempts: Int;
  recovery_claim_until: NullableInt;
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
