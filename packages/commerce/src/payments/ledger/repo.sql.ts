import { type Kysely, type Selectable, sql } from "kysely";

import type { StorageKernel } from "@jini-ai/db/kernel";
import {
  ATTEMPT_PATCH_COLUMNS, DISPUTE_PATCH_COLUMNS, LEDGER_TABLES, PAYMENT_PATCH_COLUMNS, REFUND_PATCH_COLUMNS,
  attemptFromRow, disputeFromRow, evidenceFromRow, inboxFromRow, outboxFromRow, patchColumns, paymentFromRow,
  quarantineFromRow, refundFromRow,
  type AttemptPatch, type AttemptRecord, type DisputePatch, type DisputeRecord, type EvidenceRecord, type InboxRecord,
  type NewInbox, type NewOutbox, type NewPayment, type NewQuarantine, type OutboxRecord, type PaymentPatch,
  type PaymentRecord, type PaymentsLedgerDatabase, type QuarantineRecord, type RefundPatch, type RefundRecord, type RefundsTable,
} from "./rows.js";
import {
  LedgerConstraintError, type LedgerConstraintKind, type LedgerKeyScope, type LedgerTx, type PaymentsLedger, type ProviderRefScope,
} from "./repo.js";

/**
 * @file THE durable `PaymentsLedger`: one Kysely query body for every dialect the `@jini-ai/db`
 * storage kernel drives (SQLite via better-sqlite3, Postgres via node-pg or PGlite). It borrows the
 * host's kernel — no connection work, no `BEGIN`; transactions are the kernel's, and the payment
 * lock is `kernel.lockKey` (a Postgres advisory lock; SQLite's `BEGIN IMMEDIATE` already
 * serializes writers).
 *
 * Driver errors for broken constraints are translated to {@link LedgerConstraintError} so callers
 * see the same error from this adapter and from `repo.memory.ts`.
 */

type Db = Kysely<PaymentsLedgerDatabase>;
type TableName = keyof PaymentsLedgerDatabase;
/** The loose view used only by the shared update-by-id helper (its `set` is built from a patch map). */
type LooseDb = Kysely<Record<string, { id: string } & Record<string, unknown>>>;

// SQLite reports extended result codes on better-sqlite3 errors; Postgres (node-pg, PGlite) SQLSTATEs.
const CONSTRAINT_CODES: ReadonlyMap<string, LedgerConstraintKind> = new Map([
  ["SQLITE_CONSTRAINT_UNIQUE", "unique"],
  ["SQLITE_CONSTRAINT_PRIMARYKEY", "unique"],
  ["23505", "unique"],
  ["SQLITE_CONSTRAINT_FOREIGNKEY", "foreign-key"],
  ["23503", "foreign-key"],
]);

/** Which ledger constraint a driver error reports, or `null` when it is not one. */
export function constraintKindOf(error: unknown, _optional: Record<string, never> = {}): LedgerConstraintKind | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? (CONSTRAINT_CODES.get(code) ?? null) : null;
}

const DUE_STATES = ["received", "parked"] as const;

class SqlLedgerTx implements LedgerTx {
  constructor(private readonly kernel: StorageKernel<PaymentsLedgerDatabase>) {}

  private read<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.kernel.run(fn);
  }

  /** A write whose constraint failures surface as {@link LedgerConstraintError}. */
  private async write<T>(table: TableName, fn: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await this.kernel.run(fn);
    } catch (error) {
      const kind = constraintKindOf(error);
      throw kind === null ? error : new LedgerConstraintError({ kind, table }, { cause: error });
    }
  }

  private async updateById(table: TableName, id: string, set: Record<string, unknown>): Promise<boolean> {
    const result = await this.write(table, (db) =>
      (db as unknown as LooseDb).updateTable(table).set(set).where("id", "=", id).executeTakeFirst()
    );
    return result.numUpdatedRows > 0n;
  }

  // Payments ------------------------------------------------------------------------------------

  async insertPayment({ payment }: { payment: NewPayment }): Promise<PaymentRecord> {
    const record: PaymentRecord = { ...payment, version: 1 };
    await this.write(LEDGER_TABLES.payments, (db) =>
      db.insertInto("commerce_payments").values({
        id: record.id, workspace_id: record.workspaceId, site_id: record.siteId, provider_id: record.providerId,
        provider_account_id: record.providerAccountId, mode: record.mode, idempotency_key: record.idempotencyKey,
        reference: record.reference, party_id: record.partyId, currency: record.currency, amount_minor: record.amountMinor,
        captured_minor: record.capturedMinor, intent_status: record.intentStatus, refunded_minor: record.refundedMinor,
        refund_held_minor: record.refundHeldMinor, disputed_minor: record.disputedMinor, status: record.status,
        provider_ref: record.providerRef, next_action_json: record.nextActionJson, fee_currency: record.feeCurrency,
        fee_minor: record.feeMinor, net_currency: record.netCurrency, net_minor: record.netMinor,
        settlement_currency: record.settlementCurrency, settlement_minor: record.settlementMinor, version: record.version,
        created_at: record.createdAt, updated_at: record.updatedAt,
      }).execute()
    );
    return record;
  }

  async getPayment({ workspaceId, mode, id }: LedgerKeyScope & { id: string }): Promise<PaymentRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("id", "=", id).executeTakeFirst()
    );
    return row === undefined ? null : paymentFromRow(row);
  }

  async findPaymentByIdempotencyKey({ workspaceId, mode, key }: LedgerKeyScope & { key: string }): Promise<PaymentRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("idempotency_key", "=", key).executeTakeFirst()
    );
    return row === undefined ? null : paymentFromRow(row);
  }

  async findPaymentByProviderRef(required: ProviderRefScope & { providerRef: string }): Promise<PaymentRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", required.workspaceId)
        .where("mode", "=", required.mode).where("provider_id", "=", required.providerId)
        .where("provider_account_id", "=", required.providerAccountId).where("provider_ref", "=", required.providerRef)
        .executeTakeFirst()
    );
    return row === undefined ? null : paymentFromRow(row);
  }

  async lockPayment({ id }: { id: string }): Promise<PaymentRecord | null> {
    await this.kernel.lockKey(`commerce.payment:${id}`);
    const row = await this.read((db) => db.selectFrom("commerce_payments").selectAll().where("id", "=", id).executeTakeFirst());
    return row === undefined ? null : paymentFromRow(row);
  }

  async updatePayment({ id, expectedVersion, patch }: { id: string; expectedVersion: number; patch: PaymentPatch }): Promise<boolean> {
    const set = { ...patchColumns({ patch, columns: PAYMENT_PATCH_COLUMNS }), version: expectedVersion + 1 };
    const result = await this.write(LEDGER_TABLES.payments, (db) =>
      (db as unknown as LooseDb).updateTable(LEDGER_TABLES.payments).set(set).where("id", "=", id)
        .where("version", "=", expectedVersion).executeTakeFirst()
    );
    return result.numUpdatedRows > 0n;
  }

  // Attempts ------------------------------------------------------------------------------------

  async insertAttempt({ attempt: a }: { attempt: AttemptRecord }): Promise<void> {
    await this.write(LEDGER_TABLES.attempts, (db) =>
      db.insertInto("commerce_payment_attempts").values({
        id: a.id, payment_id: a.paymentId, workspace_id: a.workspaceId, mode: a.mode, op: a.op, operation_key: a.operationKey,
        refund_id: a.refundId, outcome: a.outcome, error_code: a.errorCode, error_message: a.errorMessage,
        created_at: a.createdAt, updated_at: a.updatedAt,
      }).execute()
    );
  }

  updateAttempt({ id, patch }: { id: string; patch: AttemptPatch }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.attempts, id, patchColumns({ patch, columns: ATTEMPT_PATCH_COLUMNS }));
  }

  async findAttemptByOperationKey({ workspaceId, mode, operationKey }: LedgerKeyScope & { operationKey: string }): Promise<AttemptRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_payment_attempts").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("operation_key", "=", operationKey).executeTakeFirst()
    );
    return row === undefined ? null : attemptFromRow(row);
  }

  async listAttempts({ paymentId }: { paymentId: string }): Promise<AttemptRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_payment_attempts").selectAll().where("payment_id", "=", paymentId).orderBy("created_at").orderBy("id").execute()
    );
    return rows.map((row) => attemptFromRow(row));
  }

  // Refunds -------------------------------------------------------------------------------------

  async insertRefund({ refund: r }: { refund: RefundRecord }): Promise<void> {
    await this.write(LEDGER_TABLES.refunds, (db) =>
      db.insertInto("commerce_refunds").values({
        id: r.id, payment_id: r.paymentId, workspace_id: r.workspaceId, site_id: r.siteId, provider_id: r.providerId,
        provider_account_id: r.providerAccountId, mode: r.mode, idempotency_key: r.idempotencyKey,
        provider_refund_ref: r.providerRefundRef, currency: r.currency, amount_minor: r.amountMinor, status: r.status,
        reason: r.reason, created_at: r.createdAt, updated_at: r.updatedAt,
      }).execute()
    );
  }

  updateRefund({ id, patch }: { id: string; patch: RefundPatch }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.refunds, id, patchColumns({ patch, columns: REFUND_PATCH_COLUMNS }));
  }

  private async refundWhere(paymentId: string, column: "id" | "provider_refund_ref", value: string): Promise<RefundRecord | null> {
    const row: Selectable<RefundsTable> | undefined = await this.read((db) =>
      db.selectFrom("commerce_refunds").selectAll().where("payment_id", "=", paymentId).where(column, "=", value).executeTakeFirst()
    );
    return row === undefined ? null : refundFromRow(row);
  }

  async findRefund(
    { paymentId }: { paymentId: string },
    optional: { correlationId?: string; providerRefundRef?: string } = {}
  ): Promise<RefundRecord | null> {
    const byCorrelation = optional.correlationId === undefined ? null : await this.refundWhere(paymentId, "id", optional.correlationId);
    if (byCorrelation !== null || optional.providerRefundRef === undefined) return byCorrelation;
    return this.refundWhere(paymentId, "provider_refund_ref", optional.providerRefundRef);
  }

  async findRefundByIdempotencyKey({ workspaceId, mode, key }: LedgerKeyScope & { key: string }): Promise<RefundRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_refunds").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("idempotency_key", "=", key).executeTakeFirst()
    );
    return row === undefined ? null : refundFromRow(row);
  }

  async listRefunds({ paymentId }: { paymentId: string }): Promise<RefundRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_refunds").selectAll().where("payment_id", "=", paymentId).orderBy("created_at").orderBy("id").execute()
    );
    return rows.map((row) => refundFromRow(row));
  }

  // Disputes ------------------------------------------------------------------------------------

  async insertDispute({ dispute: d }: { dispute: DisputeRecord }): Promise<void> {
    await this.write(LEDGER_TABLES.disputes, (db) =>
      db.insertInto("commerce_disputes").values({
        id: d.id, payment_id: d.paymentId, workspace_id: d.workspaceId, provider_id: d.providerId,
        provider_account_id: d.providerAccountId, mode: d.mode, provider_dispute_ref: d.providerDisputeRef, currency: d.currency,
        amount_minor: d.amountMinor, status: d.status, due_by: d.dueBy, created_at: d.createdAt, updated_at: d.updatedAt,
      }).execute()
    );
  }

  updateDispute({ id, patch }: { id: string; patch: DisputePatch }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.disputes, id, patchColumns({ patch, columns: DISPUTE_PATCH_COLUMNS }));
  }

  async findDispute({ paymentId, providerDisputeRef }: { paymentId: string; providerDisputeRef: string }): Promise<DisputeRecord | null> {
    const row = await this.read((db) =>
      db.selectFrom("commerce_disputes").selectAll().where("payment_id", "=", paymentId)
        .where("provider_dispute_ref", "=", providerDisputeRef).executeTakeFirst()
    );
    return row === undefined ? null : disputeFromRow(row);
  }

  async listDisputes({ paymentId }: { paymentId: string }): Promise<DisputeRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_disputes").selectAll().where("payment_id", "=", paymentId).orderBy("created_at").orderBy("id").execute()
    );
    return rows.map((row) => disputeFromRow(row));
  }

  // Evidence ------------------------------------------------------------------------------------

  async appendEvidence({ evidence: e }: { evidence: EvidenceRecord }): Promise<void> {
    await this.write(LEDGER_TABLES.evidence, (db) =>
      db.insertInto("commerce_payment_evidence").values({
        id: e.id, payment_id: e.paymentId, workspace_id: e.workspaceId, mode: e.mode, source: e.source, subject: e.subject,
        subject_ref: e.subjectRef, observed_status: e.observedStatus, currency: e.currency, amount_minor: e.amountMinor,
        inbox_id: e.inboxId, recorded_at: e.recordedAt,
      }).execute()
    );
  }

  async listEvidence({ paymentId }: { paymentId: string }): Promise<EvidenceRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_payment_evidence").selectAll().where("payment_id", "=", paymentId).orderBy("recorded_at").orderBy("id").execute()
    );
    return rows.map((row) => evidenceFromRow(row));
  }

  // Webhook inbox -------------------------------------------------------------------------------

  async insertInbox({ entry: e }: { entry: NewInbox }): Promise<{ inserted: boolean; id: string }> {
    const result = await this.write(LEDGER_TABLES.inbox, (db) =>
      db.insertInto("commerce_webhook_inbox").values({
        id: e.id, workspace_id: e.workspaceId, site_id: e.siteId, provider_id: e.providerId, provider_account_id: e.providerAccountId,
        mode: e.mode, provider_event_id: e.providerEventId, facts_json: e.factsJson, body_sha256: e.bodySha256, state: "received",
        attempts: 0, next_attempt_at: e.nextAttemptAt, last_error: null, received_at: e.receivedAt, applied_at: null, purged_at: null,
      }).onConflict((oc) => oc.columns(["workspace_id", "mode", "provider_id", "provider_account_id", "provider_event_id"]).doNothing())
        .executeTakeFirst()
    );
    // `numInsertedOrUpdatedRows` is 0 when ON CONFLICT DO NOTHING skipped the row (Number(undefined) is NaN: not inserted).
    if (Number(result.numInsertedOrUpdatedRows) > 0) return { inserted: true, id: e.id };
    // A redelivery: hand back the first delivery's id. The row exists — the conflict just proved it.
    const existing = await this.read((db) =>
      db.selectFrom("commerce_webhook_inbox").select("id").where("workspace_id", "=", e.workspaceId).where("mode", "=", e.mode)
        .where("provider_id", "=", e.providerId).where("provider_account_id", "=", e.providerAccountId)
        .where("provider_event_id", "=", e.providerEventId).executeTakeFirstOrThrow()
    );
    return { inserted: false, id: existing.id };
  }

  async getInbox({ id }: { id: string }): Promise<InboxRecord | null> {
    const row = await this.read((db) => db.selectFrom("commerce_webhook_inbox").selectAll().where("id", "=", id).executeTakeFirst());
    return row === undefined ? null : inboxFromRow(row);
  }

  markInboxApplied({ id, appliedAt }: { id: string; appliedAt: number }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.inbox, id, { state: "applied", facts_json: null, applied_at: appliedAt, purged_at: appliedAt });
  }

  async parkInbox({ id, error, nextAttemptAt }: { id: string; error: string; nextAttemptAt: number }): Promise<boolean> {
    const result = await this.write(LEDGER_TABLES.inbox, (db) =>
      db.updateTable("commerce_webhook_inbox")
        .set({ state: "parked", last_error: error, next_attempt_at: nextAttemptAt, attempts: sql<number>`attempts + 1` })
        .where("id", "=", id).executeTakeFirst()
    );
    return result.numUpdatedRows > 0n;
  }

  deadInbox({ id, error }: { id: string; error: string }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.inbox, id, { state: "dead", last_error: error });
  }

  async listDueInbox({ now, limit }: { now: number; limit: number }): Promise<InboxRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_webhook_inbox").selectAll().where("state", "in", DUE_STATES).where("next_attempt_at", "<=", now)
        .orderBy("next_attempt_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => inboxFromRow(row));
  }

  // Outbox --------------------------------------------------------------------------------------

  async enqueueOutbox({ message: m }: { message: NewOutbox }): Promise<void> {
    await this.write(LEDGER_TABLES.outbox, (db) =>
      db.insertInto("commerce_outbox").values({
        id: m.id, workspace_id: m.workspaceId, mode: m.mode, topic: m.topic, aggregate_id: m.aggregateId,
        payload_json: m.payloadJson, created_at: m.createdAt, published_at: null,
      }).execute()
    );
  }

  async listPendingOutbox({ limit }: { limit: number }): Promise<OutboxRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_outbox").selectAll().where("published_at", "is", null).orderBy("created_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => outboxFromRow(row));
  }

  markOutboxPublished({ id, publishedAt }: { id: string; publishedAt: number }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.outbox, id, { published_at: publishedAt });
  }

  // Quarantine ----------------------------------------------------------------------------------

  async insertQuarantine({ entry: q }: { entry: NewQuarantine }): Promise<void> {
    await this.write(LEDGER_TABLES.quarantine, (db) =>
      db.insertInto("commerce_quarantine").values({
        id: q.id, workspace_id: q.workspaceId, mode: q.mode, payment_id: q.paymentId, subject: q.subject, reason: q.reason,
        evidence_json: q.evidenceJson, created_at: q.createdAt, resolved_at: null,
      }).execute()
    );
  }

  async listQuarantine({ workspaceId, mode }: LedgerKeyScope, optional: { unresolvedOnly?: boolean } = {}): Promise<QuarantineRecord[]> {
    const rows = await this.read((db) => {
      let query = db.selectFrom("commerce_quarantine").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode);
      if (optional.unresolvedOnly === true) query = query.where("resolved_at", "is", null);
      return query.orderBy("created_at").orderBy("id").execute();
    });
    return rows.map((row) => quarantineFromRow(row));
  }

  resolveQuarantine({ id, resolvedAt }: { id: string; resolvedAt: number }): Promise<boolean> {
    return this.updateById(LEDGER_TABLES.quarantine, id, { resolved_at: resolvedAt });
  }
}

/**
 * The SQL ledger over the host's storage kernel. The tables must exist: run
 * `migrateCommercePayments({ kernel })` first. No connection work happens here.
 *
 * @example const ledger = sqlPaymentsLedger({ kernel }); await ledger.transaction(async (tx) => tx.lockPayment({ id }));
 */
export function sqlPaymentsLedger<DB>(required: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): PaymentsLedger {
  const kernel = required.kernel as unknown as StorageKernel<PaymentsLedgerDatabase>;
  const tx = new SqlLedgerTx(kernel);
  return { transaction: (fn) => kernel.transaction(() => fn(tx)) };
}
