import { AsyncLocalStorage } from "node:async_hooks";

import {
  LEDGER_TABLES,
  type AttemptPatch, type AttemptRecord, type DisputePatch, type DisputeRecord, type EvidenceRecord, type InboxRecord,
  type NewInbox, type NewOutbox, type NewPayment, type NewQuarantine, type OutboxRecord, type PaymentPatch,
  type PaymentRecord, type QuarantineRecord, type RefundPatch, type RefundRecord,
} from "./rows.js";
import { LedgerConstraintError, type LedgerKeyScope, type LedgerTx, type PaymentsLedger, type ProviderRefScope } from "./repo.js";

/**
 * @file The in-memory `PaymentsLedger`: same semantics as `repo.sql.ts`, proven by the shared
 * contract suite — unique keys (a NULL part never conflicts, as in SQL), payment references,
 * optimistic versions, insert-or-ignore inbox, append-only evidence. For tests and fakes; one
 * process only.
 *
 * Transactions are serialized (one at a time, FIFO) and roll back on throw by restoring a snapshot
 * taken at the start. Snapshots are cheap shallow `Map` copies because a stored record is never
 * mutated — every write replaces the record object. A nested `transaction` joins the outer one,
 * matching the storage kernel (no savepoint).
 */

type Row = { readonly id: string };
/** One unique key over a row; `null` when any part is NULL (SQL: NULLs never collide). */
type UniqueKey<R> = (row: R) => string | null;

function key(...parts: readonly (string | null)[]): string | null {
  return parts.includes(null) ? null : JSON.stringify(parts);
}

/** A table: rows by id plus the unique keys and the payment reference the SQL schema enforces. */
class MemoryTable<R extends Row> {
  rows = new Map<string, R>();
  constructor(
    readonly name: string,
    private readonly uniques: readonly UniqueKey<R>[],
    private readonly parentOf: ((row: R) => string) | null = null
  ) {}

  private conflict(row: R): boolean {
    return this.uniques.some((unique) => {
      const value = unique(row);
      return value !== null && [...this.rows.values()].some((other) => other.id !== row.id && unique(other) === value);
    });
  }

  insert(row: R, payments: ReadonlyMap<string, unknown>): void {
    if (this.parentOf !== null && !payments.has(this.parentOf(row))) throw new LedgerConstraintError({ kind: "foreign-key", table: this.name });
    if (this.rows.has(row.id) || this.conflict(row)) throw new LedgerConstraintError({ kind: "unique", table: this.name });
    this.rows.set(row.id, row);
  }

  /** Replaces the row with `id` by `change(row)`; false when there is none. */
  update(id: string, change: (row: R) => R): boolean {
    const current = this.rows.get(id);
    if (current === undefined) return false;
    const next = change(current);
    if (this.conflict(next)) throw new LedgerConstraintError({ kind: "unique", table: this.name });
    this.rows.set(id, next);
    return true;
  }

  find(match: (row: R) => boolean): R | null {
    return [...this.rows.values()].find(match) ?? null;
  }

  list(match: (row: R) => boolean, order: (row: R) => number): R[] {
    // Ties break on id with a plain code-unit comparison, as SQL's binary `ORDER BY id` does.
    return [...this.rows.values()].filter(match).sort((a, b) => order(a) - order(b) || Number(a.id > b.id) - Number(a.id < b.id));
  }
}

/** Drops undefined fields so a patch never writes `undefined` over a stored value. */
function defined<P extends object>(patch: P): Partial<P> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<P>;
}

const inScope = (scope: LedgerKeyScope) => (row: { workspaceId: string; mode: string }) =>
  row.workspaceId === scope.workspaceId && row.mode === scope.mode;
const ofPayment = (paymentId: string) => (row: { paymentId: string | null }) => row.paymentId === paymentId;

class MemoryLedgerTables {
  readonly payments = new MemoryTable<PaymentRecord>(LEDGER_TABLES.payments, [
    (r) => key(r.workspaceId, r.mode, r.idempotencyKey),
    (r) => key(r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerRef),
  ]);
  readonly attempts = new MemoryTable<AttemptRecord>(LEDGER_TABLES.attempts, [(r) => key(r.workspaceId, r.mode, r.operationKey)], (r) => r.paymentId);
  readonly refunds = new MemoryTable<RefundRecord>(LEDGER_TABLES.refunds, [
    (r) => key(r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerRefundRef),
    (r) => key(r.workspaceId, r.mode, r.idempotencyKey),
  ], (r) => r.paymentId);
  readonly disputes = new MemoryTable<DisputeRecord>(LEDGER_TABLES.disputes, [
    (r) => key(r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerDisputeRef),
  ], (r) => r.paymentId);
  readonly evidence = new MemoryTable<EvidenceRecord>(LEDGER_TABLES.evidence, [], (r) => r.paymentId);
  readonly inbox = new MemoryTable<InboxRecord>(LEDGER_TABLES.inbox, [
    (r) => key(r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerEventId),
  ]);
  readonly outbox = new MemoryTable<OutboxRecord>(LEDGER_TABLES.outbox, []);
  readonly quarantine = new MemoryTable<QuarantineRecord>(LEDGER_TABLES.quarantine, []);

  private all(): MemoryTable<Row>[] {
    return [this.payments, this.attempts, this.refunds, this.disputes, this.evidence, this.inbox, this.outbox, this.quarantine] as unknown as MemoryTable<Row>[];
  }

  snapshot(): Map<string, Row>[] {
    return this.all().map((table) => new Map(table.rows));
  }

  restore(snapshot: readonly Map<string, Row>[]): void {
    this.all().forEach((table, index) => {
      table.rows = snapshot[index] as Map<string, Row>;
    });
  }
}

class MemoryLedgerTx implements LedgerTx {
  constructor(private readonly t: MemoryLedgerTables) {}

  // Payments ------------------------------------------------------------------------------------

  async insertPayment({ payment }: { payment: NewPayment }): Promise<PaymentRecord> {
    const record: PaymentRecord = { ...payment, version: 1 };
    this.t.payments.insert(record, this.t.payments.rows);
    return record;
  }

  async getPayment(required: LedgerKeyScope & { id: string }): Promise<PaymentRecord | null> {
    const scoped = inScope(required);
    return this.t.payments.find((r) => scoped(r) && r.id === required.id);
  }

  async findPaymentByIdempotencyKey(required: LedgerKeyScope & { key: string }): Promise<PaymentRecord | null> {
    const scoped = inScope(required);
    return this.t.payments.find((r) => scoped(r) && r.idempotencyKey === required.key);
  }

  async findPaymentByProviderRef(required: ProviderRefScope & { providerRef: string }): Promise<PaymentRecord | null> {
    const scoped = inScope(required);
    return this.t.payments.find(
      (r) => scoped(r) && r.providerId === required.providerId && r.providerAccountId === required.providerAccountId && r.providerRef === required.providerRef
    );
  }

  /** Transactions are already serialized here, so holding the payment's lock is implicit. */
  async lockPayment({ id }: { id: string }): Promise<PaymentRecord | null> {
    return this.t.payments.rows.get(id) ?? null;
  }

  async updatePayment({ id, expectedVersion, patch }: { id: string; expectedVersion: number; patch: PaymentPatch }): Promise<boolean> {
    if (this.t.payments.rows.get(id)?.version !== expectedVersion) return false;
    return this.t.payments.update(id, (r) => ({ ...r, ...defined(patch), version: expectedVersion + 1 }));
  }

  // Attempts ------------------------------------------------------------------------------------

  async insertAttempt({ attempt }: { attempt: AttemptRecord }): Promise<void> {
    this.t.attempts.insert(attempt, this.t.payments.rows);
  }

  async updateAttempt({ id, patch }: { id: string; patch: AttemptPatch }): Promise<boolean> {
    return this.t.attempts.update(id, (r) => ({ ...r, ...defined(patch) }));
  }

  async findAttemptByOperationKey(required: LedgerKeyScope & { operationKey: string }): Promise<AttemptRecord | null> {
    const scoped = inScope(required);
    return this.t.attempts.find((r) => scoped(r) && r.operationKey === required.operationKey);
  }

  async listAttempts({ paymentId }: { paymentId: string }): Promise<AttemptRecord[]> {
    return this.t.attempts.list(ofPayment(paymentId), (r) => r.createdAt);
  }

  // Refunds -------------------------------------------------------------------------------------

  async insertRefund({ refund }: { refund: RefundRecord }): Promise<void> {
    this.t.refunds.insert(refund, this.t.payments.rows);
  }

  async updateRefund({ id, patch }: { id: string; patch: RefundPatch }): Promise<boolean> {
    return this.t.refunds.update(id, (r) => ({ ...r, ...defined(patch) }));
  }

  async findRefund(
    { paymentId }: { paymentId: string },
    optional: { correlationId?: string; providerRefundRef?: string } = {}
  ): Promise<RefundRecord | null> {
    const own = ofPayment(paymentId);
    const byCorrelation = optional.correlationId === undefined ? null : this.t.refunds.find((r) => own(r) && r.id === optional.correlationId);
    if (byCorrelation !== null || optional.providerRefundRef === undefined) return byCorrelation;
    return this.t.refunds.find((r) => own(r) && r.providerRefundRef === optional.providerRefundRef);
  }

  async findRefundByIdempotencyKey(required: LedgerKeyScope & { key: string }): Promise<RefundRecord | null> {
    const scoped = inScope(required);
    return this.t.refunds.find((r) => scoped(r) && r.idempotencyKey === required.key);
  }

  async listRefunds({ paymentId }: { paymentId: string }): Promise<RefundRecord[]> {
    return this.t.refunds.list(ofPayment(paymentId), (r) => r.createdAt);
  }

  // Disputes ------------------------------------------------------------------------------------

  async insertDispute({ dispute }: { dispute: DisputeRecord }): Promise<void> {
    this.t.disputes.insert(dispute, this.t.payments.rows);
  }

  async updateDispute({ id, patch }: { id: string; patch: DisputePatch }): Promise<boolean> {
    return this.t.disputes.update(id, (r) => ({ ...r, ...defined(patch) }));
  }

  async findDispute({ paymentId, providerDisputeRef }: { paymentId: string; providerDisputeRef: string }): Promise<DisputeRecord | null> {
    return this.t.disputes.find((r) => r.paymentId === paymentId && r.providerDisputeRef === providerDisputeRef);
  }

  async listDisputes({ paymentId }: { paymentId: string }): Promise<DisputeRecord[]> {
    return this.t.disputes.list(ofPayment(paymentId), (r) => r.createdAt);
  }

  // Evidence ------------------------------------------------------------------------------------

  async appendEvidence({ evidence }: { evidence: EvidenceRecord }): Promise<void> {
    this.t.evidence.insert(evidence, this.t.payments.rows);
  }

  async listEvidence({ paymentId }: { paymentId: string }): Promise<EvidenceRecord[]> {
    return this.t.evidence.list(ofPayment(paymentId), (r) => r.recordedAt);
  }

  // Webhook inbox -------------------------------------------------------------------------------

  async insertInbox({ entry }: { entry: NewInbox }): Promise<{ inserted: boolean; id: string }> {
    const existing = this.t.inbox.find(
      (r) => r.workspaceId === entry.workspaceId && r.mode === entry.mode && r.providerId === entry.providerId &&
        r.providerAccountId === entry.providerAccountId && r.providerEventId === entry.providerEventId
    );
    if (existing !== null) return { inserted: false, id: existing.id };
    this.t.inbox.insert({ ...entry, state: "received", attempts: 0, lastError: null, appliedAt: null, purgedAt: null }, this.t.payments.rows);
    return { inserted: true, id: entry.id };
  }

  async getInbox({ id }: { id: string }): Promise<InboxRecord | null> {
    return this.t.inbox.rows.get(id) ?? null;
  }

  async markInboxApplied({ id, appliedAt }: { id: string; appliedAt: number }): Promise<boolean> {
    return this.t.inbox.update(id, (r) => ({ ...r, state: "applied", factsJson: null, appliedAt, purgedAt: appliedAt }));
  }

  async parkInbox({ id, error, nextAttemptAt }: { id: string; error: string; nextAttemptAt: number }): Promise<boolean> {
    return this.t.inbox.update(id, (r) => ({ ...r, state: "parked", lastError: error, nextAttemptAt, attempts: r.attempts + 1 }));
  }

  async deadInbox({ id, error }: { id: string; error: string }): Promise<boolean> {
    return this.t.inbox.update(id, (r) => ({ ...r, state: "dead", lastError: error }));
  }

  async listDueInbox({ now, limit }: { now: number; limit: number }): Promise<InboxRecord[]> {
    const due = (r: InboxRecord) => (r.state === "received" || r.state === "parked") && r.nextAttemptAt <= now;
    return this.t.inbox.list(due, (r) => r.nextAttemptAt).slice(0, limit);
  }

  // Outbox --------------------------------------------------------------------------------------

  async enqueueOutbox({ message }: { message: NewOutbox }): Promise<void> {
    this.t.outbox.insert({ ...message, publishedAt: null }, this.t.payments.rows);
  }

  async listPendingOutbox({ limit }: { limit: number }): Promise<OutboxRecord[]> {
    return this.t.outbox.list((r) => r.publishedAt === null, (r) => r.createdAt).slice(0, limit);
  }

  async markOutboxPublished({ id, publishedAt }: { id: string; publishedAt: number }): Promise<boolean> {
    return this.t.outbox.update(id, (r) => ({ ...r, publishedAt }));
  }

  // Quarantine ----------------------------------------------------------------------------------

  async insertQuarantine({ entry }: { entry: NewQuarantine }): Promise<void> {
    this.t.quarantine.insert({ ...entry, resolvedAt: null }, this.t.payments.rows);
  }

  async listQuarantine(required: LedgerKeyScope, optional: { unresolvedOnly?: boolean } = {}): Promise<QuarantineRecord[]> {
    const scoped = inScope(required);
    const visible = (r: QuarantineRecord) => scoped(r) && (optional.unresolvedOnly !== true || r.resolvedAt === null);
    return this.t.quarantine.list(visible, (r) => r.createdAt);
  }

  async resolveQuarantine({ id, resolvedAt }: { id: string; resolvedAt: number }): Promise<boolean> {
    return this.t.quarantine.update(id, (r) => ({ ...r, resolvedAt }));
  }
}

/**
 * A fresh, empty in-memory ledger.
 *
 * @example const ledger = memoryPaymentsLedger(); await ledger.transaction((tx) => tx.insertPayment({ payment }));
 */
export function memoryPaymentsLedger(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): PaymentsLedger {
  const tables = new MemoryLedgerTables();
  const tx = new MemoryLedgerTx(tables);
  const active = new AsyncLocalStorage<true>();
  let tail: Promise<unknown> = Promise.resolve();

  async function attempt<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    const snapshot = tables.snapshot();
    try {
      return await fn(tx);
    } catch (error) {
      tables.restore(snapshot);
      throw error;
    }
  }

  return {
    transaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
      if (active.getStore() === true) return fn(tx);
      const run = tail.then(() => active.run(true, () => attempt(fn)));
      // The queue must keep moving past a failed transaction; the caller still sees the failure via `run`.
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
