import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmissionIpRetentionPort } from '../../submission-ip-retention.js';
import {
  assertSubmissionIpSweepInterval,
  startSubmissionIpExpirySweep,
  SUBMISSION_IP_SWEEP_INTERVAL_MS,
  type SubmissionIpSweep,
} from '../submission-ip-expiry-sweep.js';

/** Supplied sweeps never touch their repo here: the retention policy itself is tested with the forms domain. */
const repo: SubmissionIpRetentionPort = { clearExpiredIps: async () => 0 };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Captures the one timer the runner registers so ticks are driven by hand. */
function captureInterval() {
  let tick: (() => void) | undefined;
  let delay: number | undefined;
  let unrefs = 0;
  let clears = 0;
  const handle = { unref: () => { unrefs++; } };
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((run: () => void, ms: number) => {
    expect(tick, 'the runner must register exactly one timer').toBeUndefined();
    tick = run;
    delay = ms;
    return handle;
  }) as unknown as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((timer: unknown) => {
    expect(timer).toBe(handle);
    clears++;
  }) as unknown as typeof clearInterval);
  return {
    tick() { expect(tick).toBeDefined(); tick!(); },
    get delay() { return delay; },
    get unrefs() { return unrefs; },
    get clears() { return clears; },
  };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('startSubmissionIpExpirySweep lifecycle', () => {
  it('runs one boot pass with the injected clock and repo, schedules daily, unrefs the timer, and stops future ticks', async () => {
    const timer = captureInterval();
    const calls: Array<{ now: number; repo: SubmissionIpRetentionPort }> = [];
    let now = 123;
    const sweep: SubmissionIpSweep = async (required) => { calls.push(required); return 0; };
    const stop = startSubmissionIpExpirySweep({ repo, sweep, onError: () => {} }, { now: () => now });
    expect(calls).toEqual([{ now: 123, repo }]);
    expect(calls[0]!.repo).toBe(repo);
    expect(SUBMISSION_IP_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(timer.delay).toBe(SUBMISSION_IP_SWEEP_INTERVAL_MS);
    expect(timer.unrefs).toBe(1);
    await turn();
    now = 456;
    timer.tick();
    await turn();
    expect(calls.map((call) => call.now)).toEqual([123, 456]);

    await stop();
    timer.tick();
    await turn();
    expect(calls.map((call) => call.now), 'a queued tick after stop cannot start a pass').toEqual([123, 456]);
    expect(timer.clears).toBe(1);
    await stop();
  });

  it('honours a custom interval and defaults the clock to Date.now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    const nows: number[] = [];
    const sweep: SubmissionIpSweep = async ({ now }) => { nows.push(now); return 0; };
    const stop = startSubmissionIpExpirySweep({ repo, sweep, onError: () => {} }, { intervalMs: 1000 });
    expect(nows).toEqual([Date.parse('2026-03-01T00:00:00.000Z')]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(nows).toEqual([0, 1000, 2000].map((offset) => Date.parse('2026-03-01T00:00:00.000Z') + offset));
    await stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips overlapping ticks, and stop waits for a running pass before resolving', async () => {
    const timer = captureInterval();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const stop = startSubmissionIpExpirySweep({ repo, onError: () => {}, sweep: async () => { calls++; await held; return 0; } });
    timer.tick();
    timer.tick();
    expect(calls, 'the boot pass is still running so both ticks are skipped').toBe(1);
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await turn();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(calls).toBe(1);
  });

  it('contains sync throws, rejected sweeps and throwing reporters, and a later tick retries', async () => {
    const timer = captureInterval();
    const failure = new Error('locked');
    const reported: unknown[] = [];
    let calls = 0;
    const sweep: SubmissionIpSweep = () => {
      calls++;
      if (calls === 1) throw failure;
      if (calls === 2) return Promise.reject(failure);
      return Promise.resolve(0);
    };
    const stop = startSubmissionIpExpirySweep({ repo, sweep, onError: ({ error }) => { reported.push(error); throw new Error('logger failed'); } });
    await turn();
    timer.tick();
    await turn();
    timer.tick();
    await turn();
    expect(calls).toBe(3);
    expect(reported).toEqual([failure, failure]);
    await expect(stop()).resolves.toBeUndefined();
  });

  it('reports a failing clock instead of crashing, and a later tick retries with a working one', async () => {
    const timer = captureInterval();
    const failure = new Error('clock failed');
    const reported: unknown[] = [];
    let clockCalls = 0;
    const seen: number[] = [];
    const stop = startSubmissionIpExpirySweep({ repo, sweep: async ({ now }) => { seen.push(now); return 0; }, onError: ({ error }) => { reported.push(error); } }, {
      now: () => { if (++clockCalls === 1) throw failure; return 789; },
    });
    await turn();
    timer.tick();
    await turn();
    expect(seen).toEqual([789]);
    expect(reported).toEqual([failure]);
    await stop();
  });
});

describe('submission IP sweep interval guard', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('refuses %s as a non-positive or unsafe interval', (intervalMs) => {
    expect(() => assertSubmissionIpSweepInterval({ intervalMs })).toThrow(new RangeError('submission IP sweep interval must be positive'));
  });

  it('accepts the smallest positive integer and the daily default', () => {
    expect(() => assertSubmissionIpSweepInterval({ intervalMs: 1 })).not.toThrow();
    expect(() => assertSubmissionIpSweepInterval({ intervalMs: SUBMISSION_IP_SWEEP_INTERVAL_MS })).not.toThrow();
  });

  it('refuses a bad interval before the boot pass runs or any timer is registered', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const sweep = vi.fn(async () => 0);
    expect(() => startSubmissionIpExpirySweep({ repo, sweep, onError: () => {} }, { intervalMs: 0 })).toThrow(RangeError);
    expect(sweep).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
