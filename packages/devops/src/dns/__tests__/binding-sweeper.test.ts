import { describe, expect, it, vi } from 'vitest';

import {
  DOMAIN_BINDING_SWEEP_FAILED_LINE,
  DOMAIN_BINDING_SWEEP_INTERVAL_MS,
  DOMAIN_BINDING_SWEEP_LIMIT,
  DOMAIN_BINDING_SWEEP_STOP_GRACE_MS,
  DOMAIN_BINDING_SWEEP_STOP_LATE_LINE,
  startDomainBindingSweeper,
  type DomainBindingSweepScheduler,
} from '../binding-sweeper.js';

/** A logger port that records each line and, separately, what went in its error bag. */
function recordingLogger() {
  const lines: string[] = [];
  const errors: unknown[] = [];
  const write = ({ message }: { message: string }, optional?: { error?: unknown }) => {
    lines.push(message);
    if (optional !== undefined && 'error' in optional) errors.push(optional.error);
  };
  return { lines, errors, logger: { info: write, warn: write, error: write } };
}
const silentLogger = recordingLogger().logger;

/**
 * @file The due-bindings DNS loop on a fake scheduler: off without a pre-bound sweep, one sweep per
 * interval with the batch limit, never two at once, failures logged (not thrown) and retried, and a
 * bounded `stop`. What a sweep checks is the host's dns-change tests' subject.
 */

function fakeScheduler() {
  const intervals: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const timeouts: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const scheduler: DomainBindingSweepScheduler = {
    every: ({ ms, run }) => { const timer = { ms, run, cancelled: false }; intervals.push(timer); return { cancel: () => { timer.cancelled = true; } }; },
    after: ({ ms, run }) => { const timer = { ms, run, cancelled: false }; timeouts.push(timer); return { cancel: () => { timer.cancelled = true; } }; },
  };
  const fire = () => { for (const timer of intervals) if (!timer.cancelled) timer.run(); };
  return { scheduler, intervals, timeouts, fire };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('startDomainBindingSweeper', () => {
  it('no pre-bound sweep: an idle handle and no timer (off by injection)', async () => {
    const clock = fakeScheduler();
    const sweeper = startDomainBindingSweeper({ sweep: undefined, scheduler: clock.scheduler, logger: silentLogger });
    expect(clock.intervals.length).toBe(0);
    await sweeper.tick();
    await sweeper.stop();
  });

  it('sweeps once per interval at the default minute with the default batch limit, single flight', async () => {
    const clock = fakeScheduler();
    const limits: number[] = [];
    const gate = deferred();
    const sweeper = startDomainBindingSweeper(
      { sweep: async ({ limit }) => { limits.push(limit); await gate.promise; return []; }, scheduler: clock.scheduler, logger: { info: () => expect.fail('nothing to log'), warn: () => expect.fail('nothing to log'), error: () => expect.fail('nothing to log') } },
    );
    expect(clock.intervals.map((timer) => timer.ms)).toEqual([DOMAIN_BINDING_SWEEP_INTERVAL_MS]);
    expect(limits, 'no sweep before the first interval').toEqual([]);
    clock.fire();
    clock.fire();
    const direct = sweeper.tick();
    expect(limits, 'a running sweep is never stacked').toEqual([DOMAIN_BINDING_SWEEP_LIMIT]);
    gate.resolve();
    await direct;
    await sweeper.tick();
    expect(limits.length, 'the next sweep runs once the previous one settled').toBe(2);
    await sweeper.stop();
    expect(clock.intervals[0]!.cancelled).toBe(true);
  });

  it('a failed sweep is logged with the failure in the error bag (never in the line), never thrown, and the loop keeps going', async () => {
    const clock = fakeScheduler();
    const { lines, errors, logger } = recordingLogger();
    let calls = 0;
    const broke = new TypeError(`resolver broke ${'x'.repeat(300)}`);
    const failures: unknown[] = [broke, 'eio'];
    const sweeper = startDomainBindingSweeper(
      { sweep: async () => { calls += 1; throw failures.shift(); }, scheduler: clock.scheduler, logger },
      { intervalMs: 5, limit: 3 },
    );
    expect(clock.intervals[0]!.ms).toBe(5);
    await sweeper.tick();
    await sweeper.tick();
    expect(calls).toBe(2);
    expect(lines).toEqual([DOMAIN_BINDING_SWEEP_FAILED_LINE, DOMAIN_BINDING_SWEEP_FAILED_LINE]);
    expect(errors[0]).toBe(broke);
    expect(errors[1]).toBe('eio');
    await sweeper.stop();
  });

  it('stop waits a bounded grace for a running sweep, logs when it gives up, and is idempotent', async () => {
    const clock = fakeScheduler();
    const { lines, logger } = recordingLogger();
    const gate = deferred();
    let stopped = 0;
    const sweeper = startDomainBindingSweeper(
      { sweep: async () => { await gate.promise; stopped += 1; return ['example.com']; }, scheduler: clock.scheduler, logger },
    );
    void sweeper.tick();
    const stopping = sweeper.stop();
    await flush();
    expect(clock.timeouts.map((timer) => timer.ms)).toEqual([DOMAIN_BINDING_SWEEP_STOP_GRACE_MS]);
    clock.timeouts[0]!.run();
    await stopping;
    expect(lines).toEqual([DOMAIN_BINDING_SWEEP_STOP_LATE_LINE]);
    await sweeper.tick();
    expect(stopped, 'no sweep starts after stop').toBe(0);
    gate.resolve();
    await flush();

    const quick = deferred();
    const clean = fakeScheduler();
    const second = startDomainBindingSweeper(
      { sweep: async () => { await quick.promise; return []; }, scheduler: clean.scheduler, logger },
    );
    void second.tick();
    const done = second.stop();
    quick.resolve();
    await done;
    expect(clean.timeouts[0]!.cancelled, 'the grace timer is cancelled when the sweep finishes in time').toBe(true);
    await second.stop();
    expect(lines.length).toBe(1);
  });

  it('rejects a non-positive or non-finite interval', () => {
    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => startDomainBindingSweeper({ sweep: async () => [], scheduler: fakeScheduler().scheduler, logger: silentLogger }, { intervalMs })).toThrow(RangeError);
    }
  });

  it('logs only on the injected logger, never straight to the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { lines, logger } = recordingLogger();
      const sweeper = startDomainBindingSweeper({ sweep: async () => { throw new Error('boom'); }, scheduler: fakeScheduler().scheduler, logger });
      await sweeper.tick();
      expect(lines).toEqual([DOMAIN_BINDING_SWEEP_FAILED_LINE]);
      expect(errors).not.toHaveBeenCalled();
      await sweeper.stop();
    } finally {
      errors.mockRestore();
    }
  });
});
