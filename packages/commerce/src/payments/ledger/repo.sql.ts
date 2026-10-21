import { type Kysely, type RawBuilder, type Selectable, sql } from "kysely";

import type { StorageKernel } from "@jini-ai/db/kernel";
import {
  ATTEMPT_PATCH_COLUMNS, DISPUTE_PATCH_COLUMNS, LEDGER_TABLES, OPEN_INBOX_STATES, PAYMENT_PATCH_COLUMNS, REFUND_PATCH_COLUMNS,
  attemptFromRow, attemptToRow, disputeFromRow, disputeToRow, encodeColumns, encodeMinor, evidenceFromRow, evidenceToRow,
  inboxFromRow, inboxToRow, outboxFromRow, outboxToRow, patchColumns, paymentFromRow, paymentToRow, quarantineFromRow,
  quarantineToRow, refundFromRow, refundToRow, operatorActionFromRow, operatorActionToRow, revivedPayload, UNSETTLED_REFUND_STATUSES,
  OPEN_ATTEMPT_OUTCOMES, type AttemptOp, type OperatorActionRecord, type AttemptPatch, type AttemptRecord, type DisputePatch, type DisputeRecord, type EvidenceRecord, type InboxRecord,
  type NewInbox, type NewOutbox, type NewPayment, type NewQuarantine, type OutboxRecord, type PaymentPatch,
  type PaymentRecord, type PaymentsLedgerDatabase, type PaymentsTable, type QuarantineRecord, type RefundPatch, type RefundRecord,
  type RefundsTable,
} from "./rows.js";
import {
  LedgerConstraintError, type LedgerConstraintKind, type LedgerKeyScope, type LedgerTx, type PaymentsLedger, type ProviderRefScope,
  type ScanCursor, type ScanOptions,
} from "./repo.js";

/**
 * @file THE durable `PaymentsLedger`: one Kysely query body for every dialect the `@jini-ai/db`
 * storage kernel drives (SQLite via better-sqlite3, Postgres via node-pg or PGlite). It borrows the
 * host's kernel — no connection work, no `BEGIN`; transactions are the kernel's, and the payment
 * lock is `kernel.lockKey` (a Postgres advisory lock; SQLite's `BEGIN IMMEDIATE` already
 * serializes writers).
 *
 * Driver errors for broken constraints are translated to {@link LedgerConstraintError} so callers
 * see the same error from this adapter and from `repo.memory.ts`. Every insert row and update `set`
 * is built through `rows.ts`'s encoders, so a bad integer throws before the driver sees it.
 *
 * Ordering: lists order by their time column, then `id`. The `id` tie-break is the database's
 * collation order (binary on SQLite; the database collation on Postgres), so callers must not rely
 * on how equal-time rows tie beyond it being stable.
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
  ["SQLITE_CONSTRAINT_CHECK", "check"],
  ["SQLITE_CONSTRAINT_NOTNULL", "check"],
  ["23514", "check"],
  ["23502", "check"],
]);

/** Which ledger constraint a driver error reports, or `null` when it is not one. */
export function constraintKindOf({ error }: { error: unknown }, _optional: Record<string, never> = {}): LedgerConstraintKind | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? (CONSTRAINT_CODES.get(code) ?? null) : null;
}

/** Rows ordered after `after` by (`updated_at`, `id`) — the scans' own order — or every row without a cursor. */
function afterCursor({ after }: { after?: ScanCursor }, _optional: Record<string, never> = {}): RawBuilder<boolean> {
  if (after === undefined) return sql<boolean>`1 = 1`;
  const at = encodeMinor({ value: after.updatedAt });
  return sql<boolean>`(updated_at > ${at} OR (updated_at = ${at} AND id > ${after.id}))`;
}

/** Workspace + mode of a scan's optional scope, or every row without one. */
function inScanScope({ scope }: { scope?: LedgerKeyScope }, _optional: Record<string, never> = {}): RawBuilder<boolean> {
  return scope === undefined ? sql<boolean>`1 = 1` : sql<boolean>`(workspace_id = ${scope.workspaceId} AND mode = ${scope.mode})`;
}

class SqlLedgerTx implements LedgerTx {
  constructor(private readonly kernel: StorageKernel<PaymentsLedgerDatabase>) {}

  private read<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.kernel.run(fn);
  }

  /** A write whose constraint failures surface as {@link LedgerConstraintError}. */
  private async write<T>({ table, fn }: { table: TableName; fn: (db: Db) => Promise<T> }): Promise<T> {
    try {
      return await this.kernel.run(fn);
    } catch (error) {
      const kind = constraintKindOf({ error });
      throw kind === null ? error : new LedgerConstraintError({ kind, table }, { cause: error });
    }
  }

  /**
   * `UPDATE table SET set WHERE id = ?`, optionally also fenced on the row's `version` or `state`.
   * `set` must already be encoded (patchColumns / encodeColumns).
   */
  private async updateById(
    { table, id, set }: { table: TableName; id: string; set: Record<string, unknown> },
    optional: { version?: number; states?: readonly string[] } = {}
  ): Promise<boolean> {
    const result = await this.write({
      table,
      fn: (db) => {
        let query = (db as unknown as LooseDb).updateTable(table).set(set).where("id", "=", id);
        if (optional.version !== undefined) query = query.where("version", "=", optional.version);
        if (optional.states !== undefined) query = query.where("state", "in", [...optional.states]);
        return query.executeTakeFirst();
      },
    });
    return result.numUpdatedRows > 0n;
  }

  private async onePayment(where: (db: Db) => Promise<Selectable<PaymentsTable> | undefined>): Promise<PaymentRecord | null> {
    const row = await this.read(where);
    return row === undefined ? null : paymentFromRow(row);
  }

  // Payments ------------------------------------------------------------------------------------

  async insertPayment({ payment }: { payment: NewPayment }): Promise<PaymentRecord> {
    const row = paymentToRow({ ...payment, version: 1 });
    await this.write({ table: LEDGER_TABLES.payments, fn: (db) => db.insertInto("commerce_payments").values(row).execute() });
    return paymentFromRow(row);
  }

  getPayment({ workspaceId, mode, id }: LedgerKeyScope & { id: string }): Promise<PaymentRecord | null> {
    return this.onePayment((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("id", "=", id).executeTakeFirst()
    );
  }

  findPaymentByIdempotencyKey({ workspaceId, mode, key }: LedgerKeyScope & { key: string }): Promise<PaymentRecord | null> {
    return this.onePayment((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", workspaceId).where("mode", "=", mode)
        .where("idempotency_key", "=", key).executeTakeFirst()
    );
  }

  findPaymentByProviderRef(required: ProviderRefScope & { providerRef: string }): Promise<PaymentRecord | null> {
    return this.onePayment((db) =>
      db.selectFrom("commerce_payments").selectAll().where("workspace_id", "=", required.workspaceId)
        .where("mode", "=", required.mode).where("provider_id", "=", required.providerId)
        .where("provider_account_id", "=", required.providerAccountId).where("provider_ref", "=", required.providerRef)
        .executeTakeFirst()
    );
  }

  /** The lock key is the payment id alone (ids are globally unique); the read is scope-fenced. */
  async lockPayment(required: LedgerKeyScope & { id: string }): Promise<PaymentRecord | null> {
    await this.kernel.lockKey(`commerce.payment:${required.id}`);
    return this.getPayment(required);
  }

  updatePayment({ id, expectedVersion, patch }: { id: string; expectedVersion: number; patch: PaymentPatch }): Promise<boolean> {
    const set = { ...patchColumns({ patch, columns: PAYMENT_PATCH_COLUMNS }), version: encodeMinor({ value: expectedVersion + 1 }) };
    return this.updateById({ table: LEDGER_TABLES.payments, id, set }, { version: expectedVersion });
  }

  // Attempts ------------------------------------------------------------------------------------

  async insertAttempt({ attempt }: { attempt: AttemptRecord }): Promise<void> {
    const row = attemptToRow(attempt);
    await this.write({ table: LEDGER_TABLES.attempts, fn: (db) => db.insertInto("commerce_payment_attempts").values(row).execute() });
  }

  updateAttempt({ id, patch }: { id: string; patch: AttemptPatch }): Promise<boolean> {
    return this.updateById({ table: LEDGER_TABLES.attempts, id, set: patchColumns({ patch, columns: ATTEMPT_PATCH_COLUMNS }) });
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

  async insertRefund({ refund }: { refund: RefundRecord }): Promise<void> {
    const row = refundToRow(refund);
    await this.write({ table: LEDGER_TABLES.refunds, fn: (db) => db.insertInto("commerce_refunds").values(row).execute() });
  }

  updateRefund({ id, patch }: { id: string; patch: RefundPatch }): Promise<boolean> {
    return this.updateById({ table: LEDGER_TABLES.refunds, id, set: patchColumns({ patch, columns: REFUND_PATCH_COLUMNS }) });
  }

  private async refundWhere(
    { paymentId, column, value }: { paymentId: string; column: "id" | "provider_refund_ref"; value: string }
  ): Promise<RefundRecord | null> {
    const row: Selectable<RefundsTable> | undefined = await this.read((db) =>
      db.selectFrom("commerce_refunds").selectAll().where("payment_id", "=", paymentId).where(column, "=", value).executeTakeFirst()
    );
    return row === undefined ? null : refundFromRow(row);
  }

  async findRefund(
    { paymentId }: { paymentId: string },
    optional: { correlationId?: string; providerRefundRef?: string } = {}
  ): Promise<RefundRecord | null> {
    const byCorrelation =
      optional.correlationId === undefined ? null : await this.refundWhere({ paymentId, column: "id", value: optional.correlationId });
    if (byCorrelation !== null || optional.providerRefundRef === undefined) return byCorrelation;
    return this.refundWhere({ paymentId, column: "provider_refund_ref", value: optional.providerRefundRef });
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

  async insertDispute({ dispute }: { dispute: DisputeRecord }): Promise<void> {
    const row = disputeToRow(dispute);
    await this.write({ table: LEDGER_TABLES.disputes, fn: (db) => db.insertInto("commerce_disputes").values(row).execute() });
  }

  updateDispute({ id, patch }: { id: string; patch: DisputePatch }): Promise<boolean> {
    return this.updateById({ table: LEDGER_TABLES.disputes, id, set: patchColumns({ patch, columns: DISPUTE_PATCH_COLUMNS }) });
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

  async appendEvidence({ evidence }: { evidence: EvidenceRecord }): Promise<void> {
    const row = evidenceToRow(evidence);
    await this.write({ table: LEDGER_TABLES.evidence, fn: (db) => db.insertInto("commerce_payment_evidence").values(row).execute() });
  }

  async listEvidence({ paymentId }: { paymentId: string }): Promise<EvidenceRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_payment_evidence").selectAll().where("payment_id", "=", paymentId).orderBy("recorded_at").orderBy("id").execute()
    );
    return rows.map((row) => evidenceFromRow(row));
  }

  // Webhook inbox -------------------------------------------------------------------------------

  async insertInbox({ entry: e }: { entry: NewInbox }): Promise<{ inserted: boolean; id: string }> {
    const row = inboxToRow({ ...e, state: "received", attempts: 0, lastError: null, appliedAt: null, purgedAt: null });
    const result = await this.write({
      table: LEDGER_TABLES.inbox,
      fn: (db) =>
        db.insertInto("commerce_webhook_inbox").values(row)
          .onConflict((oc) => oc.columns(["workspace_id", "mode", "provider_id", "provider_account_id", "provider_event_id"]).doNothing())
          .executeTakeFirst(),
    });
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
    const set = encodeColumns({ state: "applied", facts_json: null, applied_at: appliedAt, purged_at: appliedAt });
    return this.updateById({ table: LEDGER_TABLES.inbox, id, set }, { states: OPEN_INBOX_STATES });
  }

  parkInbox({ id, error, nextAttemptAt }: { id: string; error: string; nextAttemptAt: number }): Promise<boolean> {
    const set = { ...encodeColumns({ state: "parked", last_error: error, next_attempt_at: nextAttemptAt }), attempts: sql<number>`attempts + 1` };
    return this.updateById({ table: LEDGER_TABLES.inbox, id, set }, { states: OPEN_INBOX_STATES });
  }

  deadInbox({ id, error }: { id: string; error: string }): Promise<boolean> {
    const set = encodeColumns({ state: "dead", last_error: error });
    return this.updateById({ table: LEDGER_TABLES.inbox, id, set }, { states: OPEN_INBOX_STATES });
  }

  reviveInbox(
    { id, nextAttemptAt }: { id: string; nextAttemptAt: number },
    optional: { payload?: { factsJson: string; bodySha256: string } } = {}
  ): Promise<boolean> {
    const set = encodeColumns({ state: "received", attempts: 0, next_attempt_at: nextAttemptAt, ...revivedPayload(optional) });
    return this.updateById({ table: LEDGER_TABLES.inbox, id, set }, { states: ["dead"] });
  }

  async listDueInbox({ now, limit }: { now: number; limit: number }): Promise<InboxRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_webhook_inbox").selectAll().where("state", "in", [...OPEN_INBOX_STATES]).where("next_attempt_at", "<=", now)
        .orderBy("next_attempt_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => inboxFromRow(row));
  }

  // Outbox --------------------------------------------------------------------------------------

  async enqueueOutbox({ message }: { message: NewOutbox }): Promise<void> {
    const row = outboxToRow({ ...message, publishedAt: null });
    // `seq` (0002) is the enqueue order: messages of one apply share `created_at`. It is internal, not on the record.
    const seq = sql<number>`(SELECT COALESCE(MAX(seq), 0) + 1 FROM commerce_outbox)`;
    await this.write({ table: LEDGER_TABLES.outbox, fn: (db) => db.insertInto("commerce_outbox").values({ ...row, seq } as typeof row).execute() });
  }

  async listPendingOutbox({ limit }: { limit: number }): Promise<OutboxRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_outbox").selectAll().where("published_at", "is", null).orderBy("created_at").orderBy(sql`seq`).orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => outboxFromRow(row));
  }

  markOutboxPublished({ id, publishedAt }: { id: string; publishedAt: number }): Promise<boolean> {
    return this.updateById({ table: LEDGER_TABLES.outbox, id, set: encodeColumns({ published_at: publishedAt }) });
  }

  // Quarantine ----------------------------------------------------------------------------------

  async insertQuarantine({ entry }: { entry: NewQuarantine }): Promise<void> {
    const row = quarantineToRow({ ...entry, resolvedAt: null });
    await this.write({ table: LEDGER_TABLES.quarantine, fn: (db) => db.insertInto("commerce_quarantine").values(row).execute() });
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
    return this.updateById({ table: LEDGER_TABLES.quarantine, id, set: encodeColumns({ resolved_at: resolvedAt }) });
  }

  // Reconciliation scans ------------------------------------------------------------------------

  async listUnknownPayments({ updatedBefore, limit }: { updatedBefore: number; limit: number }, optional: ScanOptions = {}): Promise<PaymentRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_payments").selectAll().where("intent_status", "=", "unknown").where("updated_at", "<", updatedBefore)
        .where(inScanScope(optional)).where(afterCursor(optional)).orderBy("updated_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => paymentFromRow(row));
  }

  async listUnsettledRefunds({ updatedBefore, limit }: { updatedBefore: number; limit: number }, optional: ScanOptions = {}): Promise<RefundRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_refunds").selectAll().where("status", "in", [...UNSETTLED_REFUND_STATUSES]).where("updated_at", "<", updatedBefore)
        .where(inScanScope(optional)).where(afterCursor(optional)).orderBy("updated_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => refundFromRow(row));
  }

  async listOpenAttempts(
    { ops, updatedBefore, limit }: { ops: readonly AttemptOp[]; updatedBefore: number; limit: number },
    optional: ScanOptions = {}
  ): Promise<AttemptRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_payment_attempts").selectAll().where("op", "in", [...ops]).where("outcome", "in", [...OPEN_ATTEMPT_OUTCOMES])
        .where("updated_at", "<", updatedBefore).where(inScanScope(optional)).where(afterCursor(optional))
        .orderBy("updated_at").orderBy("id").limit(limit).execute()
    );
    return rows.map((row) => attemptFromRow(row));
  }

  // Operator actions ----------------------------------------------------------------------------

  async appendOperatorAction({ action }: { action: OperatorActionRecord }): Promise<void> {
    const row = operatorActionToRow(action);
    await this.write({ table: LEDGER_TABLES.operatorActions, fn: (db) => db.insertInto("commerce_operator_actions").values(row).execute() });
  }

  async listOperatorActions({ paymentId }: { paymentId: string }): Promise<OperatorActionRecord[]> {
    const rows = await this.read((db) =>
      db.selectFrom("commerce_operator_actions").selectAll().where("payment_id", "=", paymentId).orderBy("created_at").orderBy("id").execute()
    );
    return rows.map((row) => operatorActionFromRow(row));
  }
}

/**
 * The SQL ledger over the host's storage kernel. The tables must exist: run
 * `migrateCommercePayments({ kernel })` first. No connection work happens here.
 *
 * @example const ledger = sqlPaymentsLedger({ kernel }); await ledger.transaction(async (tx) => tx.lockPayment({ workspaceId, mode, id }));
 */
export function sqlPaymentsLedger<DB>(required: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): PaymentsLedger {
  const kernel = required.kernel as unknown as StorageKernel<PaymentsLedgerDatabase>;
  const tx = new SqlLedgerTx(kernel);
  return { transaction: (fn) => kernel.transaction(() => fn(tx)) };
}
