import { describe, expect, it, vi } from 'vitest';
import { InMemoryFencedOutbox, InMemoryTransaction, fencedOutboxConformance, outboxRequestDigest } from '../index.js';
import { NOW, row, type TestEvent } from './fixtures.js';

/** Reference subject: host intent records join the same in-memory transaction as the enqueue. */
async function createSubject() {
  const outbox = new InMemoryFencedOutbox<TestEvent>();
  const intents = new Set<string>();
  return {
    outbox, event: row().event, conflictingEvent: row('evt-2').event,
    hasIntent: async ({ key }: { key: string }) => intents.has(key),
    begin: async () => {
      const transaction = new InMemoryTransaction();
      return { transaction,
        recordIntent: async ({ key }: { key: string }) => transaction.join({ commit: () => { intents.add(key); }, rollback: () => { intents.delete(key); } }),
        commit: async () => transaction.commit(), rollback: async () => transaction.rollback() };
    },
  };
}

describe('fenced outbox conformance: in-memory reference adapter', () => {
  for (const conformance of fencedOutboxConformance({ createSubject })) it(conformance.name, conformance.run);

  it('fails an adapter that commits its own enqueue instead of joining the caller transaction', async () => {
    class SelfCommitting extends InMemoryFencedOutbox<TestEvent> {
      override enqueueWithReceipt(required: Parameters<InMemoryFencedOutbox<TestEvent>['enqueueWithReceipt']>[0]) {
        return super.enqueueWithReceipt(required);
      }
    }
    const cases = fencedOutboxConformance({ createSubject: async () => ({ ...await createSubject(), outbox: new SelfCommitting() }) });
    const failing: string[] = [];
    for (const conformance of cases) await conformance.run().catch(() => failing.push(conformance.name));
    expect(failing).toEqual(['enqueue joins the caller transaction and commits only with it', 'rollback discards the host intent and the enqueue together']);
  });
});

describe('in-memory reference adapter transactions', () => {
  const intent = { event: row().event, scope: 'scope-a', idempotencyKey: 'k', requestDigest: 'd' };

  it('rejects a settled transaction before writing anything', async () => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const transaction = new InMemoryTransaction();
    transaction.commit();
    await expect(outbox.enqueueWithReceipt({ intent }, { transaction })).rejects.toThrow('open transaction');
    expect(outbox.rows.size).toBe(0);
    expect(() => transaction.rollback()).toThrow('transaction already committed');
    expect(() => transaction.join({ commit: () => {}, rollback: () => {} })).toThrow('already committed');
  });

  it('sees its own uncommitted key; another writer is refused until it settles', async () => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const mine = new InMemoryTransaction();
    await outbox.enqueueWithReceipt({ intent }, { transaction: mine });
    await expect(outbox.enqueueWithReceipt({ intent }, { transaction: mine })).resolves.toEqual({ status: 'existing' });
    await expect(outbox.enqueueWithReceipt({ intent }, { transaction: new InMemoryTransaction() })).rejects.toThrow('reserved by another open transaction');
    await expect(outbox.enqueueWithReceipt({ intent })).rejects.toThrow('reserved by another open transaction');
    expect(outbox.rows.size).toBe(1);
    mine.rollback();
    await expect(outbox.enqueueWithReceipt({ intent })).resolves.toEqual({ status: 'inserted' });
  });

  it.each(['enqueue first', 'intent first'])('a failing joined commit (%s) rolls back every write and settles rolled-back', async (order) => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const transaction = new InMemoryTransaction();
    const rollback = vi.fn();
    const enqueue = () => outbox.enqueueWithReceipt({ intent }, { transaction });
    const failing = () => transaction.join({ commit: () => { throw new Error('intent write failed'); }, rollback });
    if (order === 'enqueue first') { await enqueue(); failing(); } else { failing(); await enqueue(); }
    expect(() => transaction.commit()).toThrow('intent write failed');
    expect(transaction.status).toBe('rolled-back');
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(outbox.rows.size).toBe(0);
    await expect(outbox.claimReady({ scope: 'scope-a', batchSize: 10, nowIso: NOW, claimLeaseMs: 1_000 })).resolves.toEqual([]);
    await expect(outbox.enqueueWithReceipt({ intent })).resolves.toEqual({ status: 'inserted' });
  });
});

describe('outboxRequestDigest', () => {
  it('ignores key order and changes with any value', () => {
    const digest = outboxRequestDigest({ request: { a: 1, b: { c: [1, 2] } } });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(outboxRequestDigest({ request: { b: { c: [1, 2] }, a: 1 } })).toBe(digest);
    expect(outboxRequestDigest({ request: { a: 1, b: { c: [2, 1] } } })).not.toBe(digest);
  });
});
