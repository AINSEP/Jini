/**
 * @file The payments ledger port (lot L2): the ONE way the kernel's writers (L3 apply-evidence,
 * L4 ops and the webhook inbox worker) reach payment storage. Two adapters implement it with the
 * same semantics: `repo.sql.ts` (any `@jini-ai/db` storage kernel, SQLite or Postgres) and
 * `repo.memory.ts` (tests, fakes). One shared contract suite runs against both.
 *
 * Shape: `PaymentsLedger.transaction(fn)` hands `fn` a {@link LedgerTx}. Every read and write goes
 * through the tx so a writer composes "lock payment → read rows → decide → write rows + outbox" as
 * one atomic unit; a throw rolls all of it back.
 *
 * What the port does NOT do: decide anything. Status merging, totals and quarantine decisions are
 * L3's; this layer stores what it is told and enforces only the structural rules a database would
 * (unique keys, scoped payment references, NOT NULL / CHECK rules, optimistic versions, inbox
 * state transitions).
 *
 * Errors: a broken unique key, a reference to a missing (or differently scoped) payment, or a
 * broken NOT NULL / CHECK rule throws {@link LedgerConstraintError} from both adapters; a
 * non-safe-integer amount or time throws a `TypeError` before anything is written, and so does a
 * patch key outside the update's allow-list. On Postgres such an error poisons the
 * surrounding transaction, so callers treat it as fatal for the transaction (let it roll back)
 * and use the find-first / insert-or-ignore methods for races they expect.
 */
import type { PaymentMode } from "../contract/scope.js";
import type {
  AttemptPatch, AttemptRecord, DisputePatch, DisputeRecord, EvidenceRecord, InboxRecord, NewInbox, NewOutbox, NewPayment,
  NewQuarantine, OperatorActionRecord, OutboxRecord, PaymentPatch, PaymentRecord, QuarantineRecord, RefundPatch, RefundRecord,
} from "./rows.js";

export type LedgerConstraintKind = "unique" | "foreign-key" | "check";

/**
 * A write broke a unique key (`unique`), named a payment that does not exist in the row's workspace
 * + mode (`foreign-key`), or broke a NOT NULL / CHECK rule (`check`: unknown mode, negative amount,
 * NULL in a required column).
 */
export class LedgerConstraintError extends Error {
  readonly kind: LedgerConstraintKind;
  readonly table: string;
  constructor(required: { kind: LedgerConstraintKind; table: string }, optional: { cause?: unknown } = {}) {
    super(`ledger: ${required.kind} constraint violated on ${required.table}`, { cause: optional.cause });
    this.name = "LedgerConstraintError";
    this.kind = required.kind;
    this.table = required.table;
  }
}

/** Workspace + mode: the part of a scope every lookup by a caller-supplied key is fenced by. */
export interface LedgerKeyScope {
  readonly workspaceId: string;
  readonly mode: PaymentMode;
}

/** Workspace + mode + provider account: the fence for a provider-supplied ref. */
export interface ProviderRefScope extends LedgerKeyScope {
  readonly providerId: string;
  readonly providerAccountId: string;
}

export interface LedgerTx {
  // Payments ------------------------------------------------------------------------------------
  /** Inserts at `version` 1 and returns the stored record. */
  insertPayment(required: { payment: NewPayment }, optional?: Record<string, never>): Promise<PaymentRecord>;
  getPayment(required: LedgerKeyScope & { id: string }, optional?: Record<string, never>): Promise<PaymentRecord | null>;
  findPaymentByIdempotencyKey(required: LedgerKeyScope & { key: string }, optional?: Record<string, never>): Promise<PaymentRecord | null>;
  findPaymentByProviderRef(required: ProviderRefScope & { providerRef: string }, optional?: Record<string, never>): Promise<PaymentRecord | null>;
  /**
   * Takes the payment's lock for the rest of the transaction, then reads it — fenced by workspace +
   * mode like every caller-keyed lookup (null outside the scope). Every writer that
   * reads-then-writes a payment's refunds/disputes/caches goes through this first; it is what
   * keeps two concurrent applies from both reserving the last refundable cent. Throws when called
   * outside `transaction()` (a lock with no transaction to hold it would protect nothing).
   */
  lockPayment(required: LedgerKeyScope & { id: string }, optional?: Record<string, never>): Promise<PaymentRecord | null>;
  /** Applies `patch` only when the stored version is `expectedVersion`; bumps the version. False = lost the race. */
  updatePayment(required: { id: string; expectedVersion: number; patch: PaymentPatch }, optional?: Record<string, never>): Promise<boolean>;

  // Attempts ------------------------------------------------------------------------------------
  insertAttempt(required: { attempt: AttemptRecord }, optional?: Record<string, never>): Promise<void>;
  updateAttempt(required: { id: string; patch: AttemptPatch }, optional?: Record<string, never>): Promise<boolean>;
  findAttemptByOperationKey(required: LedgerKeyScope & { operationKey: string }, optional?: Record<string, never>): Promise<AttemptRecord | null>;
  /** Oldest first. */
  listAttempts(required: { paymentId: string }, optional?: Record<string, never>): Promise<AttemptRecord[]>;

  // Refunds -------------------------------------------------------------------------------------
  insertRefund(required: { refund: RefundRecord }, optional?: Record<string, never>): Promise<void>;
  updateRefund(required: { id: string; patch: RefundPatch }, optional?: Record<string, never>): Promise<boolean>;
  /**
   * The payment's refund matching OUR correlation id (= refund id) first, then the provider's
   * refund ref: a webhook that beats the synchronous response must land on the reserved row.
   */
  findRefund(
    required: { paymentId: string },
    optional?: { correlationId?: string; providerRefundRef?: string }
  ): Promise<RefundRecord | null>;
  findRefundByIdempotencyKey(required: LedgerKeyScope & { key: string }, optional?: Record<string, never>): Promise<RefundRecord | null>;
  /** Oldest first. */
  listRefunds(required: { paymentId: string }, optional?: Record<string, never>): Promise<RefundRecord[]>;

  // Disputes ------------------------------------------------------------------------------------
  insertDispute(required: { dispute: DisputeRecord }, optional?: Record<string, never>): Promise<void>;
  updateDispute(required: { id: string; patch: DisputePatch }, optional?: Record<string, never>): Promise<boolean>;
  findDispute(required: { paymentId: string; providerDisputeRef: string }, optional?: Record<string, never>): Promise<DisputeRecord | null>;
  /** Oldest first. */
  listDisputes(required: { paymentId: string }, optional?: Record<string, never>): Promise<DisputeRecord[]>;

  // Evidence (append-only: there is deliberately no update or delete) ----------------------------
  appendEvidence(required: { evidence: EvidenceRecord }, optional?: Record<string, never>): Promise<void>;
  /** Oldest first. */
  listEvidence(required: { paymentId: string }, optional?: Record<string, never>): Promise<EvidenceRecord[]>;

  // Webhook inbox -------------------------------------------------------------------------------
  /**
   * Insert-or-ignore on (workspace, mode, provider, account, provider event id): a redelivered
   * event returns `{ inserted: false, id: <the first delivery's id> }` instead of throwing, so the
   * ingest path can ack it without a second apply.
   */
  insertInbox(required: { entry: NewInbox }, optional?: Record<string, never>): Promise<{ inserted: boolean; id: string }>;
  getInbox(required: { id: string }, optional?: Record<string, never>): Promise<InboxRecord | null>;
  /**
   * `applied`, and the payload purged (`facts_json` NULL, `purged_at` set); `body_sha256` is kept.
   * Only from an open state (`received`/`parked`): false for a missing, applied or dead row.
   */
  markInboxApplied(required: { id: string; appliedAt: number }, optional?: Record<string, never>): Promise<boolean>;
  /**
   * `parked` for a retry at `nextAttemptAt`; counts the attempt and records why. Only from an open
   * state: false for a missing, applied or dead row (a finished row is never revived).
   */
  parkInbox(required: { id: string; error: string; nextAttemptAt: number }, optional?: Record<string, never>): Promise<boolean>;
  /**
   * `dead`: no more retries; left for an operator (stuck-money alert) with the error and body hash.
   * The payload is KEPT (`facts_json` untouched, `purged_at` stays NULL): a dead letter has not been
   * used, and {@link LedgerTx.reviveInbox} replays it once the cause is fixed. Only from an open
   * state: false for a missing, applied or dead row.
   */
  deadInbox(required: { id: string; error: string }, optional?: Record<string, never>): Promise<boolean>;
  /**
   * Reopens a `dead` row (an operator requeue, or a verified redelivery of its event): `received`,
   * `attempts` 0, due at `nextAttemptAt`; `last_error` is kept for the record. `payload` replaces
   * the facts and body hash (a redelivery's freshly verified copy) and clears `purged_at`. Only from
   * `dead`: false for a missing, open or applied row (an applied event is never re-applied).
   */
  reviveInbox(
    required: { id: string; nextAttemptAt: number },
    optional?: { payload?: { factsJson: string; bodySha256: string } }
  ): Promise<boolean>;
  /**
   * `received`/`parked` rows whose `next_attempt_at <= now`, soonest first (ties by id). A plain
   * read, NOT a claim: two concurrent workers would both get the same rows. v1 runs a single inbox
   * worker per database; a multi-worker host needs a claim (lease column / `SKIP LOCKED`) first.
   */
  listDueInbox(required: { now: number; limit: number }, optional?: Record<string, never>): Promise<InboxRecord[]>;

  // Outbox --------------------------------------------------------------------------------------
  enqueueOutbox(required: { message: NewOutbox }, optional?: Record<string, never>): Promise<void>;
  /** Unpublished messages, oldest first. */
  listPendingOutbox(required: { limit: number }, optional?: Record<string, never>): Promise<OutboxRecord[]>;
  markOutboxPublished(required: { id: string; publishedAt: number }, optional?: Record<string, never>): Promise<boolean>;

  // Quarantine ----------------------------------------------------------------------------------
  insertQuarantine(required: { entry: NewQuarantine }, optional?: Record<string, never>): Promise<void>;
  /** Oldest first; `unresolvedOnly` hides resolved entries. */
  listQuarantine(required: LedgerKeyScope, optional?: { unresolvedOnly?: boolean }): Promise<QuarantineRecord[]>;
  resolveQuarantine(required: { id: string; resolvedAt: number }, optional?: Record<string, never>): Promise<boolean>;

  // Reconciliation scans (L4) ---------------------------------------------------------------------
  /**
   * Payments whose intent is `unknown` and that were last updated before `updatedBefore`, least
   * recently updated first (ties by id), at most `limit`. `scope` narrows to one workspace + mode;
   * without it the scan spans every workspace (the reconciler is a host-level job) and each record
   * carries its own scope.
   */
  listUnknownPayments(required: { updatedBefore: number; limit: number }, optional?: { scope?: LedgerKeyScope }): Promise<PaymentRecord[]>;
  /** Refunds still holding money (`UNSETTLED_REFUND_STATUSES`), same cutoff, order, limit and scope rules. */
  listUnsettledRefunds(required: { updatedBefore: number; limit: number }, optional?: { scope?: LedgerKeyScope }): Promise<RefundRecord[]>;

  // Operator actions (append-only audit, L4) -------------------------------------------------------
  appendOperatorAction(required: { action: OperatorActionRecord }, optional?: Record<string, never>): Promise<void>;
  /** Oldest first. */
  listOperatorActions(required: { paymentId: string }, optional?: Record<string, never>): Promise<OperatorActionRecord[]>;
}

export interface PaymentsLedger {
  /**
   * Runs `fn` as one unit of work: everything it wrote commits together, or a throw rolls all of
   * it back and rethrows. Transactions are serialized per payment by `lockPayment`; a nested call
   * joins the outer transaction (no savepoint), as `@jini-ai/db`'s kernel does.
   */
  transaction<T>(fn: (tx: LedgerTx) => Promise<T>, optional?: Record<string, never>): Promise<T>;
}
