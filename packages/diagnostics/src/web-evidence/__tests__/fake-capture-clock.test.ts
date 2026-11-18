import { describe, expect, it } from 'vitest';
import { FakeCaptureClock } from '../testing/fake-clock.js';

describe('FakeCaptureClock', () => {
  it('moves only when advanced and fires timers at their own instants in time order', async () => {
    const clock = new FakeCaptureClock();
    const fired: Array<[string, number]> = [];
    clock.setTimeout(() => fired.push(['late', clock.now()]), 300);
    clock.setTimeout(() => fired.push(['early', clock.now()]), 100);
    clock.setTimeout(() => fired.push(['tie-first', clock.now()]), 300);
    expect(clock.now()).toBe(0);
    await clock.advance(250);
    expect(fired).toEqual([['early', 100]]);
    expect(clock.now()).toBe(250);
    await clock.advance(50);
    expect(fired).toEqual([['early', 100], ['late', 300], ['tie-first', 300]]);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('never fires a cleared timer, and lets a timer set by a firing timer run in the same advance', async () => {
    const clock = new FakeCaptureClock();
    const fired: string[] = [];
    const cancelled = clock.setTimeout(() => fired.push('cancelled'), 10);
    clock.clearTimeout(cancelled);
    clock.setTimeout(() => { fired.push('outer'); clock.setTimeout(() => fired.push('inner'), 5); }, 10);
    await clock.advance(20);
    expect(fired).toEqual(['outer', 'inner']);
  });

  it('treats a negative delay as due now', async () => {
    const clock = new FakeCaptureClock();
    let fired = false;
    clock.setTimeout(() => { fired = true; }, -5);
    await clock.advance(0);
    expect(fired).toBe(true);
  });

  it('aborts a deadline signal with a TimeoutError exactly when its time comes', async () => {
    const clock = new FakeCaptureClock();
    const signal = clock.deadlineSignal(1_000);
    await clock.advance(999);
    expect(signal.aborted).toBe(false);
    await clock.advance(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe('TimeoutError');
  });

  it('lets promises released by a timer settle before the next timer fires', async () => {
    const clock = new FakeCaptureClock();
    const order: string[] = [];
    const release = new Promise<void>(resolve => clock.setTimeout(resolve, 10));
    void release.then(() => Promise.resolve()).then(() => order.push('after first timer'));
    clock.setTimeout(() => order.push('second timer'), 20);
    await clock.advance(20);
    expect(order).toEqual(['after first timer', 'second timer']);
  });
});
