import type { Selectable } from "kysely";
import type { PaymentMode } from "../contract/scope.js";
import type { DerivedPaymentStatus, DisputeStatus, IntentStatus, RefundStatus } from "../state/status.js";
import { type PaymentsTable, type AttemptsTable, type RefundsTable, type DisputesTable, type EvidenceTable, type InboxTable, type OutboxTable, type QuarantineTable, type OperatorActionsTable } from './row-tables.js';
import { type PaymentRecord, type AttemptRecord, type AttemptOp, type AttemptOutcome, type RefundRecord, type DisputeRecord, type EvidenceRecord, type EvidenceSource, type EvidenceSubject, type InboxRecord, type InboxState, type OutboxRecord, type LedgerOutboxTopic, type QuarantineRecord, type OperatorActionRecord, type OperatorActionKind } from './row-records.js';
import { decodeMinor, decodeNullableMinor } from './rows.js';
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
    dispatchJson: row.dispatch_json,
    recoveryAttempts: decodeMinor({ value: row.recovery_attempts }),
    recoveryClaimUntil: decodeNullableMinor({ value: row.recovery_claim_until }),
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
