import { vi } from 'vitest';
import { InMemoryFencedOutbox, type DispatchResult, type Empty, type FencedClaim, type Intent, type Scheduler } from '../index.js';
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

export function intent(options: Partial<Intent<TestEvent>> = {}): Intent<TestEvent> {
  return { event: row().event, scope: 'scope-a', idempotencyKey: 'request-1', ...options };
}

export async function fencedFixture() {
  const store = new InMemoryFencedOutbox<TestEvent>();
  await store.enqueueWithReceipt({ intent: { ...intent(), requestDigest: 'digest-1' } });
  const [id] = [...store.rows.keys()] as [string];
  let now = Date.parse(NOW);
  const manual = manualScheduler();
  const outbox = {
    recoverExpired: vi.fn(store.recoverExpired.bind(store)), claimReady: vi.fn(store.claimReady.bind(store)),
    beginDispatch: vi.fn(store.beginDispatch.bind(store)), complete: vi.fn(store.complete.bind(store)),
  };
  const args = { scope: 'scope-a', outbox, clock: { nowMs: () => now }, scheduler: manual.scheduler, random: vi.fn(() => 0),
    logger: { error: vi.fn() }, authorize: vi.fn(async (_input: { claim: FencedClaim<TestEvent> }, _options: Empty = {}) => true),
    dispatch: vi.fn(async (_input: { claim: FencedClaim<TestEvent> }, _options: Empty = {}): Promise<DispatchResult> => ({ kind: 'delivered' })) };
  return { store, args, outbox, manual, id, advance(ms: number) { now += ms; },
    stored() { return store.rows.get(id)!; } };
}
