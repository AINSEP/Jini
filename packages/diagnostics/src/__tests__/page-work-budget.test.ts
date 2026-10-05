/**
 * Direct tests for the per-page work budget. The web-evidence suites only ever finish inside it;
 * nothing proved the deadline fires, that it is shared across steps, or how release() behaves on
 * an exhausted budget or a non-timeout close failure. Timers are faked; Date.now follows them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageWorkBudget, PageWorkTimeout } from '../web-evidence/page-work-budget.js';

beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-04T00:00:00Z') }); });
afterEach(() => { vi.useRealTimers(); });

describe('PageWorkBudget', () => {
  it('counts one budget down across steps instead of granting each a fresh allowance', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    expect(budget.remainingMs()).toBe(1_000);
    vi.advanceTimersByTime(400);
    expect(budget.remainingMs()).toBe(600);
    vi.advanceTimersByTime(5_000);
    expect(budget.remainingMs()).toBe(0);
  });

  it('returns the work result and clears its timer when the work finishes in time', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    await expect(budget.run({ work: async () => 'done' })).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with PageWorkTimeout at the remaining deadline, not the original one', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    vi.advanceTimersByTime(700);
    const pending = budget.run({ work: () => new Promise<never>(() => {}) });
    const settled = pending.then(() => 'resolved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(299);
    expect(await Promise.race([settled, Promise.resolve('still pending')])).toBe('still pending');
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(PageWorkTimeout);
    expect((error as Error).message).toBe('page work timed out after 1000ms');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never starts work once the budget is exhausted', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 50 });
    vi.advanceTimersByTime(50);
    let started = false;
    await expect(budget.run({ work: async () => { started = true; } })).rejects.toThrow(new PageWorkTimeout({ timeoutMs: 50 }));
    expect(started).toBe(false);
  });

  it('propagates a work failure unchanged', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    const failure = new Error('evaluate failed');
    await expect(budget.run({ work: async () => { throw failure; } })).rejects.toBe(failure);
  });
});

describe('PageWorkBudget.release', () => {
  it('waits for a close that finishes inside the budget', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    let closed = false;
    await budget.release({ close: async () => { closed = true; } });
    expect(closed).toBe(true);
  });

  it('stops waiting for a stalled close at the deadline without throwing', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 100 });
    let calls = 0;
    const releasing = budget.release({ close: () => { calls++; return new Promise<void>(() => {}); } });
    await vi.advanceTimersByTimeAsync(100);
    await expect(releasing).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('still initiates close on an exhausted budget, returns at once and swallows its late rejection', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 10 });
    vi.advanceTimersByTime(10);
    let reject!: (error: unknown) => void;
    let calls = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await budget.release({ close: () => { calls++; return new Promise<void>((_resolve, rej) => { reject = rej; }); } });
      expect(calls).toBe(1);
      vi.useRealTimers();
      reject(new Error('late close failure'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('rethrows a close failure that is not a budget timeout', async () => {
    const budget = new PageWorkBudget({ timeoutMs: 1_000 });
    const failure = new Error('browser crashed');
    await expect(budget.release({ close: async () => { throw failure; } })).rejects.toBe(failure);
  });
});
