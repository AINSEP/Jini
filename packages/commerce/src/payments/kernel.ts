/**
 * @file `@jini-ai/commerce/payments/kernel`: the generic payments kernel (design 2026-10-21) —
 * Money, the provider contract, the consumer `PaymentsPort`, evidence, the risk gate, the derived
 * status model and DI tokens. A separate entry from `./payments` because the legacy lipay
 * contracts there (`ports.ts`, `state-machine.ts`) reuse names like `PaymentProvider`; the two
 * converge when `lipay-plugin.ts` is split (L4).
 */
export * from "../money/money.js";
export * from "./contract/scope.js";
export * from "./contract/evidence.js";
export * from "./contract/provider.js";
export * from "./contract/payments-port.js";
export * from "./contract/risk.js";
export * from "./contract/alerts.js";
export * from "./contract/tokens.js";
export * from "./state/status.js";
export * from "./provider-module-guard.js";
// A manifest grants no trust: the host owns activation, digest checks, import containment and
// revocation. Commerce validates the provider shape without depending on the plugin host.
export * from "./provider-contract.js";
export * from "./provider-registry.js";
export * from "./provider-contexts.js";
// The payments ledger (L2): storage records, the `PaymentsLedger` port and its in-memory adapter.
// The SQL adapter and the migrations are in `./ledger/sql.ts`, not here: they load `kysely` at
// runtime (an optional peer a provider plugin importing this entry lacks) and take the host's
// `@jini-ai/db` kernel and migration runner as injected values.
export { decodeMinor, decodeNullableMinor, encodeMinor, encodeNullableMinor, LEDGER_TABLES, type LedgerTableName, LEDGER_INTEGER_COLUMNS, encodeColumns, type LedgerTableRules, LEDGER_MODES, LEDGER_TABLE_RULES, type StoredRow, paymentToRow, attemptToRow, refundToRow, disputeToRow, evidenceToRow, inboxToRow, outboxToRow, quarantineToRow, operatorActionToRow } from "./ledger/rows.js";
export { type PaymentsTable, type AttemptsTable, type RefundsTable, type DisputesTable, type EvidenceTable, type InboxTable, type OutboxTable, type QuarantineTable, type OperatorActionsTable, type PaymentsLedgerDatabase } from "./ledger/row-tables.js";
export { type AttemptOp, type AttemptOutcome, OPEN_ATTEMPT_OUTCOMES, type EvidenceSource, type EvidenceSubject, type InboxState, OPEN_INBOX_STATES, revivedPayload, type LedgerOutboxTopic, type LedgerQuarantineReason, type PaymentRecord, type NewPayment, type AttemptRecord, type RefundRecord, type DisputeRecord, type EvidenceRecord, type InboxRecord, type NewInbox, type OutboxRecord, type NewOutbox, type QuarantineRecord, type NewQuarantine, UNSETTLED_REFUND_STATUSES, type OperatorActionKind, type OperatorActionRecord } from "./ledger/row-records.js";
export { type PaymentPatch, type AttemptPatch, type RefundPatch, type DisputePatch, PAYMENT_PATCH_COLUMNS, ATTEMPT_PATCH_COLUMNS, REFUND_PATCH_COLUMNS, DISPUTE_PATCH_COLUMNS, patchColumns } from "./ledger/row-patches.js";
export { paymentFromRow, attemptFromRow, refundFromRow, disputeFromRow, evidenceFromRow, inboxFromRow, outboxFromRow, quarantineFromRow, operatorActionFromRow } from "./ledger/row-decoders.js";
export * from "./ledger/repo.js";
export * from "./ledger/repo.memory.js";
export * from "./accounting/plan-evidence.js";
export * from "./accounting/apply-evidence.js";
// Webhook ingest (L5): receive (verify + record), the inbox worker (apply) and the outbox relay.
export * from "./ingest/receive.js";
export * from "./ingest/worker.js";
export * from "./ingest/outbox-relay.js";
// The payments operations (L4): the consumer `PaymentsPort` service, the back-office operator port, money grants.
export * from "./ops/grants.js";
export { createPaymentsService, createPaymentsOperator, type PaymentsOperatorPort } from "./ops/service.js";
export type { PaymentsServiceOptional, PaymentsServiceRequired } from "./ops/deps.js";
export type { ReconcileCounts, ReconcileReport } from "./ops/reconciler.js";
export type { ResolveUnknownRequired, ResolveUnknownResult } from "./ops/operator.js";

export * from "./ingest/settlement-worker.js";
