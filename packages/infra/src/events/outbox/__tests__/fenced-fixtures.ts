import { vi } from 'vitest';
import type { Completion, DispatchResult, Empty, EnqueueReceipt, Fence, FencedClaim, FencedOutboxPort, Intent, Scheduler } from '../index.js';
import { NOW, row, type TestEvent } from './fixtures.js';

export function deferredValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Manual deferred scheduler can deliberately deliver cancelled/stale callbacks to model races. */
export function manualScheduler() {
  const tasks: { delayMs: number; callback: () => void; cancelled: boolean }[] = [];
  const scheduler: Scheduler = { schedule(input) {
    const task = { ...input, cancelled: false };
    tasks.push(task);
    return { cancel() { task.cancelled = true; } };
  } };
  return { scheduler, tasks };
}

type StoredRow = FencedClaim<TestEvent> & { status: 'pending' | 'leased' | 'dispatching' | 'delivered' | 'denied' | 'failed' | 'uncertain'; nextAttemptAt: string };

/**
 * Contract fake: each async method mutates synchronously before returning its promise, so competing
 * claims cannot interleave inside a transition. It deliberately opens no real DB and tests no
 * transactions; host-adapter atomicity and enqueue/session semantics need a separate conformance run.
 */
export class AtomicFencedStore implements FencedOutboxPort<TestEvent, never> {
  state = { rows: new Map<string, StoredRow>() };
  private sequence = 0;

  async enqueueWithReceipt(input: Intent<TestEvent>): Promise<EnqueueReceipt> {
    const id = `row-${++this.sequence}`;
    this.state.rows.set(id, { ...structuredClone(input), id, claimToken: '', leaseExpiresAt: NOW,
      attempts: 0, status: 'pending', nextAttemptAt: NOW });
    return { kind: 'inserted', id };
  }
  async recoverExpired(input: { scope: string; nowIso: string; limit: number }, _options: Empty = {}): Promise<number> {
    const expired = [...this.state.rows.values()].filter(candidate => candidate.scope === input.scope
      && ['leased', 'dispatching'].includes(candidate.status) && candidate.leaseExpiresAt <= input.nowIso).slice(0, input.limit);
    for (const candidate of expired) candidate.status = candidate.status === 'leased' ? 'pending' : 'uncertain';
    return expired.length;
  }
  async claimReady(input: { scope: string; batchSize: number; nowIso: string; claimLeaseMs: number }, _options: Empty = {}): Promise<readonly FencedClaim<TestEvent>[]> {
    const ready = [...this.state.rows.values()].filter(candidate => candidate.scope === input.scope
      && candidate.status === 'pending' && candidate.nextAttemptAt <= input.nowIso).slice(0, input.batchSize);
    for (const candidate of ready) {
      candidate.status = 'leased';
      candidate.claimToken = `token-${++this.sequence}`;
      candidate.leaseExpiresAt = new Date(Date.parse(input.nowIso) + input.claimLeaseMs).toISOString();
      ++candidate.attempts;
    }
    return structuredClone(ready);
  }
  private fenced(input: Fence): StoredRow | undefined {
    const candidate = this.state.rows.get(input.id);
    if (!candidate || candidate.scope !== input.scope || candidate.claimToken !== input.claimToken) return;
    if (candidate.leaseExpiresAt <= input.nowIso) return;
    return candidate;
  }
  async beginDispatch(input: Fence, _options: Empty = {}): Promise<boolean> {
    const candidate = this.fenced(input);
    if (candidate?.status !== 'leased') return false;
    candidate.status = 'dispatching';
    return true;
  }
  async complete(input: Fence & { completion: Completion }, _options: Empty = {}): Promise<boolean> {
    const candidate = this.fenced(input);
    if (!candidate) return false;
    const allowed = candidate.status === 'leased' ? ['denied', 'failed', 'uncertain'] : ['delivered', 'failed', 'uncertain', 'pending'];
    if (!['leased', 'dispatching'].includes(candidate.status) || !allowed.includes(input.completion.status)) return false;
    candidate.status = input.completion.status;
    if (input.completion.status === 'pending') candidate.nextAttemptAt = input.completion.nextAttemptAt;
    return true;
  }
}

export function intent(options: Partial<Intent<TestEvent>> = {}): Intent<TestEvent> {
  return { event: row().event, scope: 'scope-a', idempotencyKey: 'request-1', requestDigest: 'digest-1', canonicalRequest: '{"value":1}', ...options };
}

export async function fencedFixture() {
  const store = new AtomicFencedStore();
  const receipt = await store.enqueueWithReceipt(intent());
  if (receipt.kind !== 'inserted') throw new TypeError('fixture must insert');
  let now = Date.parse(NOW);
  const manual = manualScheduler();
  const outbox = {
    enqueueWithReceipt: vi.fn(store.enqueueWithReceipt.bind(store)),
    recoverExpired: vi.fn(store.recoverExpired.bind(store)), claimReady: vi.fn(store.claimReady.bind(store)),
    beginDispatch: vi.fn(store.beginDispatch.bind(store)), complete: vi.fn(store.complete.bind(store)),
  };
  const args = { scope: 'scope-a', outbox, clock: { nowMs: () => now }, scheduler: manual.scheduler, random: vi.fn(() => 0),
    logger: { error: vi.fn() }, authorize: vi.fn(async (_input: { claim: FencedClaim<TestEvent> }, _options: Empty = {}) => true),
    dispatch: vi.fn(async (_input: { claim: FencedClaim<TestEvent> }, _options: Empty = {}): Promise<DispatchResult> => ({ kind: 'delivered' })) };
  return { store, args, outbox, manual, id: receipt.id, advance(ms: number) { now += ms; },
    stored() { return store.state.rows.get(receipt.id)!; } };
}
