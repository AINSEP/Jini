import { AsyncLocalStorage } from "node:async_hooks";

import {
  ATTEMPT_PATCH_COLUMNS, DISPUTE_PATCH_COLUMNS, LEDGER_MODES, LEDGER_TABLE_RULES, LEDGER_TABLES, OPEN_INBOX_STATES,
  PAYMENT_PATCH_COLUMNS, REFUND_PATCH_COLUMNS,
  attemptFromRow, attemptToRow, disputeFromRow, disputeToRow, encodeColumns, encodeMinor, evidenceFromRow, evidenceToRow,
  inboxFromRow, inboxToRow, outboxFromRow, outboxToRow, patchColumns, paymentFromRow, paymentToRow, quarantineFromRow,
  quarantineToRow, refundFromRow, refundToRow,
  type AttemptPatch, type AttemptRecord, type DisputePatch, type DisputeRecord, type EvidenceRecord, type InboxRecord,
  type LedgerTableName, type LedgerTableRules, type NewInbox, type NewOutbox, type NewPayment, type NewQuarantine,
  type OutboxRecord, type PaymentPatch, type PaymentRecord, type QuarantineRecord, type RefundPatch, type RefundRecord,
} from "./rows.js";
import { LedgerConstraintError, type LedgerKeyScope, type LedgerTx, type PaymentsLedger, type ProviderRefScope } from "./repo.js";

/**
 * @file The in-memory `PaymentsLedger`: same semantics as `repo.sql.ts`, proven by the shared
 * contract suite — NOT NULL / CHECK rules, unique keys (a NULL part never conflicts, as in SQL),
 * scoped payment references, optimistic versions, insert-or-ignore inbox with guarded state
 * transitions, append-only evidence. For tests and fakes; one process only.
 *
 * Every write goes through the same `rows.ts` codecs as the SQL adapter: a record is encoded to its
 * row (integers through `encodeMinor`), checked against `LEDGER_TABLE_RULES`, and decoded back, and
 * a patch is applied to the row through the same `*_PATCH_COLUMNS` allow-list. So a value the
 * database would refuse or store differently is refused or normalized here too.
 *
 * Transactions are serialized (one at a time, FIFO) and roll back on throw by restoring a snapshot
 * taken at the start. Snapshots are cheap shallow `Map` copies because a stored record is never
 * mutated — every write replaces the record object. A nested `transaction` joins the outer one,
 * matching the storage kernel (no savepoint).
 */

type Row = { readonly id: string };
type Columns = Record<string, unknown>;
/** One unique key over a row; `null` when any part is NULL (SQL: NULLs never collide). */
type UniqueKey<R> = (row: R) => string | null;
/** The record ↔ row codec of one table (the `rows.ts` mappers). */
interface Codec<R> {
  readonly toRow: (record: R) => Columns;
  readonly fromRow: (row: Columns) => R;
}
/** What a child row names: its payment, in its own workspace + mode (the composite foreign key). */
type ParentRef = { readonly paymentId: string; readonly workspaceId: string; readonly mode: string };

function key(parts: readonly (string | null)[]): string | null {
  return parts.includes(null) ? null : JSON.stringify(parts);
}

function codec<R>(toRow: (record: R) => object, fromRow: (row: never) => R): Codec<R> {
  return { toRow: toRow as (record: R) => Columns, fromRow: fromRow as (row: Columns) => R };
}

/** True when `row` breaks the table's NOT NULL or CHECK rules, exactly as the migration declares them. */
function breaksCheck({ rules, row }: { rules: LedgerTableRules; row: Columns }): boolean {
  if (!(LEDGER_MODES as readonly unknown[]).includes(row.mode)) return true;
  const missing = Object.entries(row).some(([column, value]) => (value === null || value === undefined) && !rules.nullable.includes(column));
  return missing || rules.nonNegative.some((column) => (row[column] as number) < 0);
}

/** A table: rows by id plus the rules, unique keys and payment reference the SQL schema enforces. */
class MemoryTable<R extends Row> {
  rows = new Map<string, R>();
  private readonly rules: LedgerTableRules;

  constructor(
    readonly required: { name: LedgerTableName; codec: Codec<R> },
    private readonly optional: { uniques?: readonly UniqueKey<R>[]; parentOf?: (row: R) => ParentRef } = {}
  ) {
    this.rules = LEDGER_TABLE_RULES[required.name];
  }

  private fail(kind: LedgerConstraintError["kind"]): never {
    throw new LedgerConstraintError({ kind, table: this.required.name });
  }

  /** The record a row decodes to, after the NOT NULL / CHECK rules (checked first, as SQL does). */
  private checked(row: Columns): R {
    if (breaksCheck({ rules: this.rules, row })) this.fail("check");
    return this.required.codec.fromRow(row);
  }

  private conflict(row: R): boolean {
    return (this.optional.uniques ?? []).some((unique) => {
      const value = unique(row);
      return value !== null && [...this.rows.values()].some((other) => other.id !== row.id && unique(other) === value);
    });
  }

  /** The child's payment must exist in the child's own workspace + mode. */
  private orphan(row: R, payments: ReadonlyMap<string, PaymentRecord>): boolean {
    if (this.optional.parentOf === undefined) return false;
    const ref = this.optional.parentOf(row);
    const parent = payments.get(ref.paymentId);
    return parent === undefined || parent.workspaceId !== ref.workspaceId || parent.mode !== ref.mode;
  }

  /** `record` as it would be stored (encoded, rule-checked, decoded); throws what an insert would. */
  validate(record: R): R {
    return this.checked(this.required.codec.toRow(record));
  }

  /** Stores `record` (round-tripped through its row) and returns what was stored. */
  insert(required: { record: R; payments: ReadonlyMap<string, PaymentRecord> }): R {
    const stored = this.validate(required.record);
    if (this.rows.has(stored.id) || this.conflict(stored)) this.fail("unique");
    if (this.orphan(stored, required.payments)) this.fail("foreign-key");
    this.rows.set(stored.id, stored);
    return stored;
  }

  /**
   * Applies the column `set` (already encoded) to the row with `id`; false when there is none, or
   * when `when` refuses the current row (the SQL `WHERE version = ?` / `state IN (...)` fence).
   */
  update(required: { id: string; set: (current: R) => Columns }, optional: { when?: (current: R) => boolean } = {}): boolean {
    const current = this.rows.get(required.id);
    if (current === undefined || optional.when?.(current) === false) return false;
    const next = this.checked({ ...this.required.codec.toRow(current), ...required.set(current) });
    if (this.conflict(next)) this.fail("unique");
    this.rows.set(required.id, next);
    return true;
  }

  find(match: (row: R) => boolean): R | null {
    return [...this.rows.values()].find(match) ?? null;
  }

  /** Ordered by `order`, ties by id in code-unit order (deterministic; see the SQL adapter on collation). */
  list(match: (row: R) => boolean, order: (row: R) => number): R[] {
    return [...this.rows.values()].filter(match).sort((a, b) => order(a) - order(b) || Number(a.id > b.id) - Number(a.id < b.id));
  }
}

/** The inbox's dedupe key: one provider event per workspace + mode + provider account. */
const inboxEventKey = (r: Pick<InboxRecord, "workspaceId" | "mode" | "providerId" | "providerAccountId" | "providerEventId">) =>
  key([r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerEventId]);

const inScope = (scope: LedgerKeyScope) => (row: { workspaceId: string; mode: string }) =>
  row.workspaceId === scope.workspaceId && row.mode === scope.mode;
const ofPayment = (paymentId: string) => (row: { paymentId: string | null }) => row.paymentId === paymentId;
const isOpen = (row: InboxRecord) => OPEN_INBOX_STATES.includes(row.state);
const parentRef = (row: ParentRef): ParentRef => row;

class MemoryLedgerTables {
  readonly payments = new MemoryTable<PaymentRecord>({ name: LEDGER_TABLES.payments, codec: codec(paymentToRow, paymentFromRow) }, {
    uniques: [
      (r) => key([r.workspaceId, r.mode, r.idempotencyKey]),
      (r) => key([r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerRef]),
    ],
  });
  readonly attempts = new MemoryTable<AttemptRecord>({ name: LEDGER_TABLES.attempts, codec: codec(attemptToRow, attemptFromRow) }, {
    uniques: [(r) => key([r.workspaceId, r.mode, r.operationKey])],
    parentOf: parentRef,
  });
  readonly refunds = new MemoryTable<RefundRecord>({ name: LEDGER_TABLES.refunds, codec: codec(refundToRow, refundFromRow) }, {
    uniques: [
      (r) => key([r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerRefundRef]),
      (r) => key([r.workspaceId, r.mode, r.idempotencyKey]),
    ],
    parentOf: parentRef,
  });
  readonly disputes = new MemoryTable<DisputeRecord>({ name: LEDGER_TABLES.disputes, codec: codec(disputeToRow, disputeFromRow) }, {
    uniques: [(r) => key([r.workspaceId, r.mode, r.providerId, r.providerAccountId, r.providerDisputeRef])],
    parentOf: parentRef,
  });
  readonly evidence = new MemoryTable<EvidenceRecord>({ name: LEDGER_TABLES.evidence, codec: codec(evidenceToRow, evidenceFromRow) }, {
    parentOf: parentRef,
  });
  readonly inbox = new MemoryTable<InboxRecord>({ name: LEDGER_TABLES.inbox, codec: codec(inboxToRow, inboxFromRow) }, { uniques: [inboxEventKey] });
  readonly outbox = new MemoryTable<OutboxRecord>({ name: LEDGER_TABLES.outbox, codec: codec(outboxToRow, outboxFromRow) });
  readonly quarantine = new MemoryTable<QuarantineRecord>({ name: LEDGER_TABLES.quarantine, codec: codec(quarantineToRow, quarantineFromRow) });

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
  constructor(
    private readonly t: MemoryLedgerTables,
    private readonly inTransaction: () => boolean
  ) {}

  private insert<R extends Row>({ table, record }: { table: MemoryTable<R>; record: R }): R {
    return table.insert({ record, payments: this.t.payments.rows });
  }

  // Payments ------------------------------------------------------------------------------------

  async insertPayment({ payment }: { payment: NewPayment }): Promise<PaymentRecord> {
    return this.insert({ table: this.t.payments, record: { ...payment, version: 1 } });
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

  /**
   * Transactions are already serialized here, so holding the payment's lock is implicit — but only
   * inside one, so outside a transaction this throws exactly where the SQL kernel's `lockKey` does.
   */
  async lockPayment(required: LedgerKeyScope & { id: string }): Promise<PaymentRecord | null> {
    if (!this.inTransaction()) throw new Error("ledger: lockPayment() must be called inside transaction()");
    return this.getPayment(required);
  }

  async updatePayment({ id, expectedVersion, patch }: { id: string; expectedVersion: number; patch: PaymentPatch }): Promise<boolean> {
    const set = { ...patchColumns({ patch, columns: PAYMENT_PATCH_COLUMNS }), version: encodeMinor(expectedVersion + 1) };
    return this.t.payments.update({ id, set: () => set }, { when: (r) => r.version === expectedVersion });
  }

  // Attempts ------------------------------------------------------------------------------------

  async insertAttempt({ attempt }: { attempt: AttemptRecord }): Promise<void> {
    this.insert({ table: this.t.attempts, record: attempt });
  }

  async updateAttempt({ id, patch }: { id: string; patch: AttemptPatch }): Promise<boolean> {
    const set = patchColumns({ patch, columns: ATTEMPT_PATCH_COLUMNS });
    return this.t.attempts.update({ id, set: () => set });
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
    this.insert({ table: this.t.refunds, record: refund });
  }

  async updateRefund({ id, patch }: { id: string; patch: RefundPatch }): Promise<boolean> {
    const set = patchColumns({ patch, columns: REFUND_PATCH_COLUMNS });
    return this.t.refunds.update({ id, set: () => set });
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
    this.insert({ table: this.t.disputes, record: dispute });
  }

  async updateDispute({ id, patch }: { id: string; patch: DisputePatch }): Promise<boolean> {
    const set = patchColumns({ patch, columns: DISPUTE_PATCH_COLUMNS });
    return this.t.disputes.update({ id, set: () => set });
  }

  async findDispute({ paymentId, providerDisputeRef }: { paymentId: string; providerDisputeRef: string }): Promise<DisputeRecord | null> {
    return this.t.disputes.find((r) => r.paymentId === paymentId && r.providerDisputeRef === providerDisputeRef);
  }

  async listDisputes({ paymentId }: { paymentId: string }): Promise<DisputeRecord[]> {
    return this.t.disputes.list(ofPayment(paymentId), (r) => r.createdAt);
  }

  // Evidence ------------------------------------------------------------------------------------

  async appendEvidence({ evidence }: { evidence: EvidenceRecord }): Promise<void> {
    this.insert({ table: this.t.evidence, record: evidence });
  }

  async listEvidence({ paymentId }: { paymentId: string }): Promise<EvidenceRecord[]> {
    return this.t.evidence.list(ofPayment(paymentId), (r) => r.recordedAt);
  }

  // Webhook inbox -------------------------------------------------------------------------------

  async insertInbox({ entry }: { entry: NewInbox }): Promise<{ inserted: boolean; id: string }> {
    // SQL checks the row (integers, NOT NULL, CHECK) before ON CONFLICT can skip it, so a bad redelivery still throws.
    const record = this.t.inbox.validate({ ...entry, state: "received", attempts: 0, lastError: null, appliedAt: null, purgedAt: null });
    const eventKey = inboxEventKey(record);
    const existing = this.t.inbox.find((r) => inboxEventKey(r) === eventKey);
    if (existing !== null) return { inserted: false, id: existing.id };
    return { inserted: true, id: this.insert({ table: this.t.inbox, record }).id };
  }

  async getInbox({ id }: { id: string }): Promise<InboxRecord | null> {
    return this.t.inbox.rows.get(id) ?? null;
  }

  async markInboxApplied({ id, appliedAt }: { id: string; appliedAt: number }): Promise<boolean> {
    const set = encodeColumns({ state: "applied", facts_json: null, applied_at: appliedAt, purged_at: appliedAt });
    return this.t.inbox.update({ id, set: () => set }, { when: isOpen });
  }

  async parkInbox({ id, error, nextAttemptAt }: { id: string; error: string; nextAttemptAt: number }): Promise<boolean> {
    const set = encodeColumns({ state: "parked", last_error: error, next_attempt_at: nextAttemptAt });
    return this.t.inbox.update({ id, set: (r) => ({ ...set, attempts: r.attempts + 1 }) }, { when: isOpen });
  }

  async deadInbox({ id, error, purgedAt }: { id: string; error: string; purgedAt: number }): Promise<boolean> {
    const set = encodeColumns({ state: "dead", last_error: error, facts_json: null, purged_at: purgedAt });
    return this.t.inbox.update({ id, set: () => set }, { when: isOpen });
  }

  async listDueInbox({ now, limit }: { now: number; limit: number }): Promise<InboxRecord[]> {
    const due = (r: InboxRecord) => isOpen(r) && r.nextAttemptAt <= now;
    return this.t.inbox.list(due, (r) => r.nextAttemptAt).slice(0, limit);
  }

  // Outbox --------------------------------------------------------------------------------------

  async enqueueOutbox({ message }: { message: NewOutbox }): Promise<void> {
    this.insert({ table: this.t.outbox, record: { ...message, publishedAt: null } });
  }

  async listPendingOutbox({ limit }: { limit: number }): Promise<OutboxRecord[]> {
    return this.t.outbox.list((r) => r.publishedAt === null, (r) => r.createdAt).slice(0, limit);
  }

  async markOutboxPublished({ id, publishedAt }: { id: string; publishedAt: number }): Promise<boolean> {
    const set = encodeColumns({ published_at: publishedAt });
    return this.t.outbox.update({ id, set: () => set });
  }

  // Quarantine ----------------------------------------------------------------------------------

  async insertQuarantine({ entry }: { entry: NewQuarantine }): Promise<void> {
    this.insert({ table: this.t.quarantine, record: { ...entry, resolvedAt: null } });
  }

  async listQuarantine(required: LedgerKeyScope, optional: { unresolvedOnly?: boolean } = {}): Promise<QuarantineRecord[]> {
    const scoped = inScope(required);
    const visible = (r: QuarantineRecord) => scoped(r) && (optional.unresolvedOnly !== true || r.resolvedAt === null);
    return this.t.quarantine.list(visible, (r) => r.createdAt);
  }

  async resolveQuarantine({ id, resolvedAt }: { id: string; resolvedAt: number }): Promise<boolean> {
    const set = encodeColumns({ resolved_at: resolvedAt });
    return this.t.quarantine.update({ id, set: () => set });
  }
}

/**
 * A fresh, empty in-memory ledger.
 *
 * @example const ledger = memoryPaymentsLedger(); await ledger.transaction((tx) => tx.insertPayment({ payment }));
 */
export function memoryPaymentsLedger(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): PaymentsLedger {
  const tables = new MemoryLedgerTables();
  const active = new AsyncLocalStorage<true>();
  const tx = new MemoryLedgerTx(tables, () => active.getStore() === true);
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
