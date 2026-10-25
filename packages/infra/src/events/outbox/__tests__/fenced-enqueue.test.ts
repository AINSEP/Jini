import { describe, expect, it, vi } from 'vitest';
import { InMemoryFencedOutbox, InMemoryTransaction, fencedOutboxConformance, outboxRequestDigest } from '../index.js';
import { deferredValue } from './fenced-fixtures.js';
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

/** A host that serializes transaction turns: each begin waits until the previous transaction settles. */
async function createSerializedSubject() {
  const subject = await createSubject();
  let turn = Promise.resolve();
  return { ...subject, begin: async () => {
    const previous = turn;
    let release = () => {};
    turn = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const opened = await subject.begin();
    const settle = (action: () => Promise<void>) => async () => { try { await action(); } finally { release(); } };
    return { ...opened, commit: settle(opened.commit), rollback: settle(opened.rollback) };
  } };
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

describe('fenced outbox conformance: serialized host', () => {
  it('the fake host really queues a second begin until the first transaction settles', async () => {
    const subject = await createSerializedSubject();
    const first = await subject.begin();
    let secondOpened = false;
    const second = subject.begin().then(opened => { secondOpened = true; return opened; });
    await new Promise(resolve => { setTimeout(resolve, 10); });
    expect(secondOpened).toBe(false);
    await first.commit();
    await (await second).rollback();
    expect(secondOpened).toBe(true);
  });

  // A hang (the old case awaited the second begin while the first was still open) fails fast here.
  for (const conformance of fencedOutboxConformance({ createSubject: createSerializedSubject })) it(conformance.name, conformance.run, 2_000);
});

type Subject = Awaited<ReturnType<typeof createSubject>>;
const OVERLAP = 'overlapping transactions never both insert one key';
const overlapCase = (subject: () => Promise<Subject>) => fencedOutboxConformance({ createSubject: subject }).find(c => c.name === OVERLAP)!.run;
/** The subject's second begin (the contender's) goes through `contender` instead. */
const withContender = (base: Subject, contender: (begin: Subject['begin']) => ReturnType<Subject['begin']>): Subject => {
  let begun = 0;
  return { ...base, begin: () => (++begun === 2 ? contender(base.begin) : base.begin()) };
};

describe('fenced outbox conformance: host with a slow begin and an overlap barrier', () => {
  /** Each begin outlasts a macrotask, like a network round trip; the reference enqueue lands as soon as it is issued. */
  async function createLatencySubject() {
    const subject = await createSubject();
    return { ...subject, awaitOverlap: async () => {},
      begin: async () => { await new Promise(resolve => { setTimeout(resolve, 5); }); return subject.begin(); } };
  }
  for (const conformance of fencedOutboxConformance({ createSubject: createLatencySubject })) it(conformance.name, conformance.run);

  it('the first writer commits only after the host reports the contender reached the store', async () => {
    const base = await createSubject();
    const reached = deferredValue<void>();
    const firstCommitted = deferredValue<void>();
    const opened: InMemoryTransaction[] = [];
    const commits: number[] = [];
    /** Like a database row lock: the contender's enqueue waits until the first writer commits. */
    class Blocking extends InMemoryFencedOutbox<TestEvent> {
      override async enqueueWithReceipt(...args: Parameters<InMemoryFencedOutbox<TestEvent>['enqueueWithReceipt']>) {
        if (args[1]?.transaction === opened[1]) await firstCommitted.promise;
        return super.enqueueWithReceipt(...args);
      }
    }
    const awaitOverlap = vi.fn((_required: { transaction: unknown }) => reached.promise);
    const subject = { ...base, outbox: new Blocking(), awaitOverlap, begin: async () => {
      const transaction = await base.begin();
      const index = opened.push(transaction.transaction);
      return { ...transaction, commit: async () => {
        await transaction.commit();
        commits.push(index);
        if (index === 1) firstCommitted.resolve();
      } };
    } };
    const run = overlapCase(async () => subject)();
    await new Promise(resolve => { setTimeout(resolve, 10); });
    expect(commits).toEqual([]);
    expect(awaitOverlap).toHaveBeenCalledTimes(1);
    expect(awaitOverlap).toHaveBeenCalledWith({ transaction: opened[1] });
    reached.resolve();
    await run;
    expect(commits).toEqual([1, 2]);
  });
});

describe('fenced outbox conformance: contender failure paths', () => {
  it('a contender begin that rejects early surfaces its error, never as an unhandled rejection', async () => {
    const beginFailed = new Error('contender begin failed');
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', record);
    try {
      await expect(overlapCase(async () => withContender(await createSubject(), async () => { throw beginFailed; }))()).rejects.toBe(beginFailed);
    } finally {
      process.off('unhandledRejection', record);
    }
    expect(unhandled).toEqual([]);
  });

  it('a contender commit that rejects after a conflict receipt is rolled back; the commit error surfaces', async () => {
    const commitFailed = new Error('contender commit failed');
    const rollback = vi.fn();
    const subject = async () => withContender(await createSerializedSubject(), async (begin) => {
      const opened = await begin();
      rollback.mockImplementation(opened.rollback);
      return { ...opened, commit: async () => { throw commitFailed; }, rollback };
    });
    await expect(overlapCase(subject)()).rejects.toBe(commitFailed);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('when that rollback fails too, both errors surface in one AggregateError', async () => {
    const commitFailed = new Error('contender commit failed');
    const rollbackFailed = new Error('contender rollback failed');
    const subject = async () => withContender(await createSerializedSubject(), async (begin) => {
      const opened = await begin();
      return { ...opened, commit: async () => { throw commitFailed; },
        rollback: async () => { await opened.rollback(); throw rollbackFailed; } };
    });
    const error = await overlapCase(subject)().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toBe('contender commit failed and its rollback failed');
    expect((error as AggregateError).errors).toEqual([commitFailed, rollbackFailed]);
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

describe('in-memory transaction rollback failures', () => {
  const intent = { event: row().event, scope: 'scope-a', idempotencyKey: 'k', requestDigest: 'd' };
  const claimAll = (outbox: InMemoryFencedOutbox<TestEvent>) => outbox.claimReady({ scope: 'scope-a', batchSize: 10, nowIso: NOW, claimLeaseMs: 1_000 });
  const thrown = (run: () => void): unknown => { try { run(); } catch (error) { return error; } throw new Error('expected a throw'); };

  it('a throwing earlier rollback still removes the released enqueue; both errors surface', async () => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const transaction = new InMemoryTransaction();
    const undoFailed = new Error('earlier undo failed');
    const commitFailed = new Error('intent write failed');
    transaction.join({ commit: () => {}, rollback: () => { throw undoFailed; } });
    await outbox.enqueueWithReceipt({ intent }, { transaction });
    const laterRollback = vi.fn();
    transaction.join({ commit: () => { throw commitFailed; }, rollback: laterRollback });
    const error = thrown(() => transaction.commit());
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([commitFailed, undoFailed]);
    expect(transaction.status).toBe('rolled-back');
    expect(laterRollback).toHaveBeenCalledTimes(1);
    expect(outbox.rows.size).toBe(0);
    await expect(claimAll(outbox)).resolves.toEqual([]);
  });

  it('a failure before the outbox commit with a throwing rollback leaves the key unreserved', async () => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const transaction = new InMemoryTransaction();
    const commitFailed = new Error('intent write failed');
    const undoFailed = new Error('intent undo failed');
    transaction.join({ commit: () => { throw commitFailed; }, rollback: () => { throw undoFailed; } });
    await outbox.enqueueWithReceipt({ intent }, { transaction });
    expect((thrown(() => transaction.commit()) as AggregateError).errors).toEqual([commitFailed, undoFailed]);
    expect(outbox.rows.size).toBe(0);
    await expect(outbox.enqueueWithReceipt({ intent })).resolves.toEqual({ status: 'inserted' });
  });

  it('a commit error with clean rollbacks propagates as itself', () => {
    const transaction = new InMemoryTransaction();
    const commitFailed = new Error('intent write failed');
    transaction.join({ commit: () => { throw commitFailed; }, rollback: () => {} });
    expect(thrown(() => transaction.commit())).toBe(commitFailed);
  });

  it('plain rollback runs every undo: one failure is thrown as itself, several as an AggregateError in join order', async () => {
    const outbox = new InMemoryFencedOutbox<TestEvent>();
    const single = new InMemoryTransaction();
    const first = new Error('first undo failed');
    single.join({ commit: () => {}, rollback: () => { throw first; } });
    await outbox.enqueueWithReceipt({ intent }, { transaction: single });
    expect(thrown(() => single.rollback())).toBe(first);
    expect(single.status).toBe('rolled-back');
    expect(outbox.rows.size).toBe(0);

    const several = new InMemoryTransaction();
    const second = new Error('second undo failed');
    several.join({ commit: () => {}, rollback: () => { throw first; } });
    await outbox.enqueueWithReceipt({ intent }, { transaction: several });
    several.join({ commit: () => {}, rollback: () => { throw second; } });
    const error = thrown(() => several.rollback()) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe('transaction rollback failed');
    expect(error.errors).toEqual([first, second]);
    expect(outbox.rows.size).toBe(0);
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
