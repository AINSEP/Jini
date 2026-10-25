import type {
  Completion, Empty, EnqueueIntent, EnqueueReceipt, Fence, FencedClaim, FencedEnqueuePort, FencedOutboxPort,
} from './ports.js';

const EPOCH = new Date(0).toISOString();

/** A stored fenced row; the original request digest stays with it for replay comparison. */
export type InMemoryFencedRow<E> = FencedClaim<E> & {
  requestDigest: string; nextAttemptAt: string;
  status: 'pending' | 'leased' | 'dispatching' | 'delivered' | 'denied' | 'failed' | 'uncertain';
};

/**
 * Caller-owned in-memory unit of work. Writers join it with a commit and a rollback action; it
 * settles exactly once, and joining or settling a settled transaction throws. If any joined commit
 * throws, every joined rollback runs (including for writes whose commit already ran), the
 * transaction settles rolled-back, and the error propagates.
 */
export class InMemoryTransaction {
  #status: 'open' | 'committed' | 'rolled-back' = 'open';
  readonly #joined: { commit: () => void; rollback: () => void }[] = [];

  get status(): 'open' | 'committed' | 'rolled-back' { return this.#status; }
  /** Register a write that lands on commit and is undone on rollback, even after its commit ran. */
  join(required: { commit: () => void; rollback: () => void }, _optional: Empty = {}): void {
    this.#assertOpen();
    this.#joined.push(required);
  }
  commit(): void {
    this.#assertOpen();
    try {
      for (const write of this.#joined) write.commit();
    } catch (error) {
      this.rollback();
      throw error;
    }
    this.#status = 'committed';
  }
  rollback(): void {
    this.#assertOpen();
    this.#status = 'rolled-back';
    for (const write of this.#joined) write.rollback();
  }
  #assertOpen(): void {
    if (this.#status !== 'open') throw new TypeError(`transaction already ${this.#status}`);
  }
}

/**
 * Reference fenced adapter for tests and hosts. Each async method mutates synchronously before
 * returning its promise, so competing claims cannot interleave inside a transition. It opens no real
 * DB: a row enqueued in a transaction is claimable only once it commits, and its key stays reserved
 * meanwhile: any other writer enqueueing that key is rejected (a real DB would block it instead).
 */
export class InMemoryFencedOutbox<E> implements FencedOutboxPort<E>, FencedEnqueuePort<E, InMemoryTransaction> {
  readonly rows = new Map<string, InMemoryFencedRow<E>>();
  /** Rows still owned by an open transaction; commit releases them, rollback deletes them. */
  readonly #uncommitted = new Map<string, InMemoryTransaction>();
  #sequence = 0;

  async enqueueWithReceipt(required: { intent: EnqueueIntent<E> }, optional: { transaction?: InMemoryTransaction } = {}): Promise<EnqueueReceipt> {
    const { intent } = required;
    const { transaction } = optional;
    if (transaction && transaction.status !== 'open') throw new TypeError('enqueue requires an open transaction');
    const original = [...this.rows.values()].find(candidate => candidate.scope === intent.scope
      && candidate.idempotencyKey === intent.idempotencyKey);
    if (original && !this.#visible({ id: original.id, transaction })) throw new Error('idempotency key is reserved by another open transaction');
    if (original) {
      return original.requestDigest === intent.requestDigest ? { status: 'existing' }
        : { status: 'conflict', reason: 'request-digest-mismatch' };
    }
    const id = `row-${++this.#sequence}`;
    this.rows.set(id, { ...structuredClone(intent), id, claimToken: '', leaseExpiresAt: EPOCH,
      attempts: 0, status: 'pending', nextAttemptAt: EPOCH });
    if (transaction) this.#joinInsert({ id, transaction });
    return { status: 'inserted' };
  }
  async recoverExpired(input: { scope: string; nowIso: string; limit: number }, _options: Empty = {}): Promise<number> {
    const expired = [...this.rows.values()].filter(candidate => candidate.scope === input.scope
      && ['leased', 'dispatching'].includes(candidate.status) && candidate.leaseExpiresAt <= input.nowIso).slice(0, input.limit);
    for (const candidate of expired) candidate.status = candidate.status === 'leased' ? 'pending' : 'uncertain';
    return expired.length;
  }
  async claimReady(input: { scope: string; batchSize: number; nowIso: string; claimLeaseMs: number }, _options: Empty = {}): Promise<readonly FencedClaim<E>[]> {
    const ready = [...this.rows.values()].filter(candidate => candidate.scope === input.scope
      && candidate.status === 'pending' && candidate.nextAttemptAt <= input.nowIso
      && !this.#uncommitted.has(candidate.id)).slice(0, input.batchSize);
    for (const candidate of ready) {
      candidate.status = 'leased';
      candidate.claimToken = `token-${++this.#sequence}`;
      candidate.leaseExpiresAt = new Date(Date.parse(input.nowIso) + input.claimLeaseMs).toISOString();
      ++candidate.attempts;
    }
    return structuredClone(ready);
  }
  async beginDispatch(input: Fence, _options: Empty = {}): Promise<boolean> {
    const candidate = this.#fenced(input);
    if (candidate?.status !== 'leased') return false;
    candidate.status = 'dispatching';
    return true;
  }
  async complete(input: Fence & { completion: Completion }, _options: Empty = {}): Promise<boolean> {
    const candidate = this.#fenced(input);
    if (!candidate) return false;
    const allowed = candidate.status === 'leased' ? ['denied', 'failed', 'uncertain'] : ['delivered', 'failed', 'uncertain', 'pending'];
    if (!['leased', 'dispatching'].includes(candidate.status) || !allowed.includes(input.completion.status)) return false;
    candidate.status = input.completion.status;
    if (input.completion.status === 'pending') candidate.nextAttemptAt = input.completion.nextAttemptAt;
    return true;
  }
  #fenced(input: Fence): InMemoryFencedRow<E> | undefined {
    const candidate = this.rows.get(input.id);
    if (!candidate || candidate.scope !== input.scope || candidate.claimToken !== input.claimToken) return;
    if (candidate.leaseExpiresAt <= input.nowIso) return;
    return candidate;
  }
  #visible(input: { id: string; transaction: InMemoryTransaction | undefined }): boolean {
    const owner = this.#uncommitted.get(input.id);
    return owner === undefined || owner === input.transaction;
  }
  /** The insert joins the caller's transaction instead of committing on its own. */
  #joinInsert(input: { id: string; transaction: InMemoryTransaction }): void {
    this.#uncommitted.set(input.id, input.transaction);
    input.transaction.join({
      commit: () => { this.#uncommitted.delete(input.id); },
      rollback: () => { this.#uncommitted.delete(input.id); this.rows.delete(input.id); },
    });
  }
}
