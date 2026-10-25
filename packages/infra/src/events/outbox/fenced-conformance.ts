import assert from 'node:assert/strict';
import type { Empty, EnqueueIntent, EnqueueReceipt, Fence, FencedClaim, FencedEnqueuePort, FencedOutboxPort } from './ports.js';

/** One open host transaction the suite enqueues into, next to a host intent write. */
export interface FencedConformanceTransaction<Tx> {
  transaction: Tx;
  /** Write the host's own intent record inside this transaction; a failed commit must undo it. */
  recordIntent(required: { key: string }): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
/** A fresh, empty adapter plus the host transaction controls it joins. */
export interface FencedConformanceSubject<E, Tx> {
  outbox: FencedOutboxPort<E> & FencedEnqueuePort<E, Tx>;
  event: E;
  /** A second event, deep-unequal to `event`, that a conflicting enqueue carries. */
  conflictingEvent: E;
  begin(): Promise<FencedConformanceTransaction<Tx>>;
  /** Whether a committed host intent record exists. */
  hasIntent(required: { key: string }): Promise<boolean>;
}
/** Framework-neutral case: register with your runner, e.g. `it(name, run)`; failures throw. */
export interface FencedConformanceCase { name: string; run(): Promise<void> }

const SCOPE = 'conformance';
const LEASE_MS = 1_000;
const at = (ms: number) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + ms).toISOString();
const fence = (claim: FencedClaim<unknown>, ms: number): Fence => ({ id: claim.id, scope: SCOPE, claimToken: claim.claimToken, nowIso: at(ms) });

type Subject = FencedConformanceSubject<unknown, unknown>;
const intent = (subject: Subject, overrides: Partial<EnqueueIntent<unknown>> = {}): EnqueueIntent<unknown> =>
  ({ event: subject.event, scope: SCOPE, idempotencyKey: 'key-1', requestDigest: 'digest-1', ...overrides });
const CONFLICT = { status: 'conflict', reason: 'request-digest-mismatch' } as const;
const conflicting = (subject: Subject) => intent(subject, { event: subject.conflictingEvent, requestDigest: 'digest-2' });
const claim = (subject: Subject, ms = 0) => subject.outbox.claimReady({ scope: SCOPE, batchSize: 10, nowIso: at(ms), claimLeaseMs: LEASE_MS });

/** A second writer enqueues the conflicting intent in its own transaction and always settles it. */
async function contend(subject: Subject): Promise<EnqueueReceipt | 'rejected'> {
  const second = await subject.begin();
  const receipt = await subject.outbox.enqueueWithReceipt({ intent: conflicting(subject) }, { transaction: second.transaction })
    .catch(() => undefined);
  if (receipt?.status === 'conflict') await second.commit();
  else await second.rollback();
  return receipt ?? 'rejected';
}
/** One macrotask, so a host that does not serialize transactions starts the contender while the first is open. */
const nextTurn = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

/** Enqueue, claim and pass the dispatch fence: the row is now `dispatching` with a lease ending at LEASE_MS. */
async function dispatching(subject: Subject): Promise<FencedClaim<unknown>> {
  await subject.outbox.enqueueWithReceipt({ intent: intent(subject) });
  const [row] = await claim(subject);
  assert.equal(await subject.outbox.beginDispatch(fence(row!, 0)), true);
  return row!;
}

const CASES: Record<string, (subject: Subject) => Promise<void>> = {
  'enqueue inserts once per (scope, idempotencyKey)': async (subject) => {
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }), { status: 'inserted' });
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject, { scope: 'other' }) }), { status: 'inserted' });
    const rows = await claim(subject);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.event, subject.event);
  },
  'a replay with the same digest is existing, not a second row': async (subject) => {
    await subject.outbox.enqueueWithReceipt({ intent: intent(subject) });
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }), { status: 'existing' });
    assert.equal((await claim(subject)).length, 1);
  },
  'a different digest conflicts and preserves the original row': async (subject) => {
    assert.notDeepEqual(subject.conflictingEvent, subject.event, 'conflictingEvent must differ from event');
    await subject.outbox.enqueueWithReceipt({ intent: intent(subject) });
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: conflicting(subject) }), CONFLICT);
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }), { status: 'existing' });
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: conflicting(subject) }), CONFLICT);
    const rows = await claim(subject);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.event, subject.event);
  },
  'overlapping transactions never both insert one key': async (subject) => {
    const first = await subject.begin();
    // A serialized host queues the second begin, and a real database may block its insert, until
    // `first` settles, so the contender is awaited only after that commit.
    let contender: Promise<EnqueueReceipt | 'rejected'> | undefined;
    try {
      assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }, { transaction: first.transaction }), { status: 'inserted' });
      contender = contend(subject);
      await nextTurn();
      await first.commit();
    } catch (error) {
      await first.rollback().catch(() => undefined);
      await contender?.catch(() => undefined);
      throw error;
    }
    const outcome = await contender;
    if (outcome !== 'rejected') assert.deepEqual(outcome, CONFLICT);
    const rows = await claim(subject);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.event, subject.event);
  },
  'enqueue joins the caller transaction and commits only with it': async (subject) => {
    const host = await subject.begin();
    await host.recordIntent({ key: 'key-1' });
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }, { transaction: host.transaction }), { status: 'inserted' });
    assert.equal((await claim(subject)).length, 0, 'enqueue must not commit the caller transaction');
    await host.commit();
    assert.equal(await subject.hasIntent({ key: 'key-1' }), true);
    assert.equal((await claim(subject)).length, 1);
  },
  'rollback discards the host intent and the enqueue together': async (subject) => {
    const host = await subject.begin();
    await host.recordIntent({ key: 'key-1' });
    await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }, { transaction: host.transaction });
    await host.rollback();
    assert.equal(await subject.hasIntent({ key: 'key-1' }), false);
    assert.equal((await claim(subject)).length, 0);
    assert.deepEqual(await subject.outbox.enqueueWithReceipt({ intent: intent(subject) }), { status: 'inserted' });
  },
  'fencing: claim, beginDispatch, complete; stale tokens, other scopes, expired leases and repeats are refused': async (subject) => {
    await subject.outbox.enqueueWithReceipt({ intent: intent(subject) });
    const [row] = await claim(subject);
    assert.equal(row!.attempts, 1);
    const delivered = { status: 'delivered' } as const;
    assert.equal(await subject.outbox.beginDispatch({ ...fence(row!, 0), claimToken: 'stale' }), false);
    assert.equal(await subject.outbox.beginDispatch({ ...fence(row!, 0), scope: 'other' }), false);
    assert.equal(await subject.outbox.beginDispatch(fence(row!, LEASE_MS)), false, 'a lease ending now is expired');
    assert.equal(await subject.outbox.beginDispatch(fence(row!, LEASE_MS - 1)), true);
    assert.equal(await subject.outbox.beginDispatch(fence(row!, 0)), false);
    assert.equal(await subject.outbox.complete({ ...fence(row!, 0), claimToken: 'stale', completion: delivered }), false);
    assert.equal(await subject.outbox.complete({ ...fence(row!, 0), scope: 'other', completion: delivered }), false);
    assert.equal(await subject.outbox.complete({ ...fence(row!, LEASE_MS), completion: delivered }), false);
    assert.equal(await subject.outbox.complete({ ...fence(row!, LEASE_MS - 1), completion: delivered }), true);
    assert.equal(await subject.outbox.complete({ ...fence(row!, 0), completion: { status: 'delivered' } }), false);
    assert.equal((await claim(subject, LEASE_MS * 2)).length, 0);
  },
  'an expired leased row returns to pending': async (subject) => {
    await subject.outbox.enqueueWithReceipt({ intent: intent(subject) });
    const [row] = await claim(subject);
    assert.equal(await subject.outbox.recoverExpired({ scope: SCOPE, nowIso: at(LEASE_MS), limit: 10 }), 1);
    assert.equal(await subject.outbox.beginDispatch(fence(row!, LEASE_MS)), false);
    const [again] = await claim(subject, LEASE_MS);
    assert.equal(again!.attempts, 2);
  },
  'an expired dispatching row becomes uncertain, never claimable': async (subject) => {
    const row = await dispatching(subject);
    assert.equal(await subject.outbox.recoverExpired({ scope: SCOPE, nowIso: at(LEASE_MS), limit: 10 }), 1);
    assert.equal((await claim(subject, LEASE_MS)).length, 0);
    assert.equal(await subject.outbox.complete({ ...fence(row, 0), completion: { status: 'pending', nextAttemptAt: at(0) } }), false);
  },
  'a lost acknowledgement stays uncertain; a late ack cannot release it': async (subject) => {
    const row = await dispatching(subject);
    assert.equal(await subject.outbox.recoverExpired({ scope: SCOPE, nowIso: at(LEASE_MS), limit: 10 }), 1);
    assert.equal(await subject.outbox.complete({ ...fence(row, 0), completion: { status: 'delivered' } }), false);
    assert.equal(await subject.outbox.recoverExpired({ scope: SCOPE, nowIso: at(LEASE_MS * 2), limit: 10 }), 0);
    assert.equal((await claim(subject, LEASE_MS * 2)).length, 0);
  },
};

/**
 * The fenced enqueue + dispatch contract as runnable cases; each case builds a fresh subject.
 * Run them against every host adapter (the in-memory reference passes them in Jini's own tests).
 * @complexity O(cases) subjects, each a handful of adapter calls.
 * @example for (const c of fencedOutboxConformance({ createSubject })) it(c.name, c.run);
 */
export function fencedOutboxConformance<E, Tx>(
  required: { createSubject: () => Promise<FencedConformanceSubject<E, Tx>> }, _optional: Empty = {},
): readonly FencedConformanceCase[] {
  return Object.entries(CASES).map(([name, check]) => ({
    name, run: async () => check(await required.createSubject() as Subject),
  }));
}
