import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createDeadlineSignal } from '../../fetch-with-timeout.js';

/** Virtual time belongs to the host; cancellation releases the scheduled wait. */
function fakeWait() {
  let now = 0;
  const pending = new Map<AbortSignal, { due: number; finish: () => void }>();
  const signals: AbortSignal[] = [];
  const wait = ({ ms, signal }: { ms: number; signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
    signals.push(signal);
    signal.throwIfAborted();
    const abort = () => { pending.delete(signal); reject(signal.reason); };
    pending.set(signal, { due: now + ms, finish: () => {
      pending.delete(signal);
      signal.removeEventListener('abort', abort);
      resolve();
    } });
    signal.addEventListener('abort', abort, { once: true });
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const task of pending.values()) if (task.due <= now) task.finish();
    await Promise.resolve();
  };
  return { wait, advance, pending, signals };
}

describe('deadline wait port and disposal', () => {
  // Guards wait({ ms, signal }) and the fulfillment callback's timeout abort.
  it('fires only when the host wait reaches the remaining deadline', async () => {
    const clock = fakeWait();
    const deadline = createDeadlineSignal({ waitMs: 100 }, { wait: clock.wait, startedAt: 950, now: () => 1_000 });
    expect(deadline.signal.aborted).toBe(false);
    await clock.advance(49);
    expect(deadline.signal.aborted).toBe(false);
    await clock.advance(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBeInstanceOf(DOMException);
    expect(deadline.signal.reason.name).toBe('TimeoutError');
    expect(clock.pending.size).toBe(0);
    expect(clock.signals).toHaveLength(1);
    expect(getEventListeners(clock.signals[0]!, 'abort')).toHaveLength(0);
    deadline.dispose();
  });

  // Guards timer.abort() in dispose, including rejection observation and idempotency.
  it('dispose releases the wait without aborting the deadline, even when repeated', async () => {
    const clock = fakeWait();
    const deadline = createDeadlineSignal({ waitMs: 25_000 }, { wait: clock.wait });
    const timerSignal = clock.signals[0]!;
    let cancellations = 0;
    timerSignal.addEventListener('abort', () => { cancellations++; }, { once: true });
    expect(clock.pending.size).toBe(1);
    expect(timerSignal.aborted).toBe(false);
    deadline.dispose();
    deadline.dispose();
    expect(timerSignal.aborted).toBe(true);
    expect(cancellations).toBe(1);
    expect(clock.pending.size).toBe(0);
    await clock.advance(25_000);
    expect(deadline.signal.aborted).toBe(false);
    expect(getEventListeners(timerSignal, 'abort')).toHaveLength(0);
  });

  // Guards the fulfillment callback against a wait already queued when disposed.
  it('dispose wins over a resolved wait whose callback has not run yet', async () => {
    const clock = fakeWait();
    const deadline = createDeadlineSignal({ waitMs: 10 }, { wait: clock.wait });
    const completion = clock.advance(10);
    deadline.dispose();
    await completion;
    expect(deadline.signal.aborted).toBe(false);
    expect(clock.signals[0]!.aborted).toBe(true);
  });

  // Guards caller reason propagation, timer cancellation and parent listener cleanup.
  it('parent cancellation propagates immediately and releases both resources', async () => {
    const clock = fakeWait();
    const parent = new AbortController();
    const reason = new Error('host cancelled');
    const deadline = createDeadlineSignal({ waitMs: 100 }, { wait: clock.wait, signal: parent.signal });
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(1);
    parent.abort(reason);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(clock.signals[0]!.aborted).toBe(true);
    expect(clock.pending.size).toBe(0);
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
    await clock.advance(100);
    expect(deadline.signal.reason).toBe(reason);
  });

  it('an already-aborted parent allocates no wait or listener', () => {
    const clock = fakeWait();
    const reason = new Error('already cancelled');
    const parent = AbortSignal.abort(reason);
    const deadline = createDeadlineSignal({ waitMs: 100 }, { wait: clock.wait, signal: parent });
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(clock.signals).toHaveLength(0);
    expect(getEventListeners(parent, 'abort')).toHaveLength(0);
    deadline.dispose();
  });

  // Guards signal.removeEventListener('abort', onAbort) for both settlement paths.
  it.each(['dispose', 'deadline'] as const)('%s detaches only its parent listener and preserves the first outcome', async outcome => {
    const clock = fakeWait();
    const parent = new AbortController();
    const unrelated = () => {};
    parent.signal.addEventListener('abort', unrelated);
    const deadline = createDeadlineSignal({ waitMs: 100 }, { wait: clock.wait, signal: parent.signal });
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(2);
    if (outcome === 'dispose') deadline.dispose();
    else await clock.advance(100);
    expect(getEventListeners(parent.signal, 'abort')).toEqual([unrelated]);
    expect(deadline.signal.aborted).toBe(outcome === 'deadline');
    const reason = deadline.signal.reason;
    expect(parent.signal.aborted).toBe(false);
    parent.abort(new Error('later parent abort'));
    expect(deadline.signal.aborted).toBe(outcome === 'deadline');
    expect(deadline.signal.reason).toBe(reason);
    parent.signal.removeEventListener('abort', unrelated);
  });

  it('a host wait failure aborts with its reason and detaches the parent', async () => {
    const reason = new Error('scheduler failed');
    const parent = new AbortController();
    const deadline = createDeadlineSignal({ waitMs: 100 }, { wait: () => Promise.reject(reason), signal: parent.signal });
    await Promise.resolve();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
  });
});
