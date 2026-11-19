import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStuckRunWatchdogForTests,
  trackRunProgress,
  trackRunStart,
  trackRunTerminal,
} from '../stuck-run.js';

describe('stuck-run watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetStuckRunWatchdogForTests();
  });

  afterEach(() => {
    __resetStuckRunWatchdogForTests();
    vi.useRealTimers();
  });

  it('reports client_run_stuck when a run makes no progress before stuckAfterMs', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-1' }, { reporter, stuckAfterMs: 1000 });

    vi.advanceTimersByTime(1000);

    expect(reporter).toHaveBeenCalledWith(
      'client_run_stuck',
      expect.objectContaining({ run_id: 'run-1' }),
    );
  });

  it('does not report when progress resets the watchdog before the deadline', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-2' }, { reporter, stuckAfterMs: 1000 });

    vi.advanceTimersByTime(700);
    trackRunProgress({ runId: 'run-2' });
    vi.advanceTimersByTime(700); // 1400ms total elapsed, but only 700ms since last progress

    expect(reporter).not.toHaveBeenCalledWith('client_run_stuck', expect.anything());

    vi.advanceTimersByTime(300); // now 1000ms since the progress reset
    expect(reporter).toHaveBeenCalledWith('client_run_stuck', expect.anything());
  });

  it('reports no event when a run terminates before the deadline', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-3' }, { reporter, stuckAfterMs: 1000 });
    vi.advanceTimersByTime(500);
    trackRunTerminal({ runId: 'run-3', terminalState: 'succeeded' });
    vi.advanceTimersByTime(1000);

    expect(reporter).not.toHaveBeenCalled();
  });

  it('reports client_run_unstuck when a run terminates after already being reported stuck', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-4' }, { reporter, stuckAfterMs: 1000 });
    vi.advanceTimersByTime(1000); // reports stuck
    trackRunTerminal({ runId: 'run-4', terminalState: 'succeeded' });

    expect(reporter).toHaveBeenCalledWith(
      'client_run_unstuck',
      expect.objectContaining({ run_id: 'run-4', terminal_state: 'succeeded' }),
    );
  });

  it('merges the supplied context into every event for that run', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-5' }, { reporter, stuckAfterMs: 1000, context: { agentId: 'x' } });
    vi.advanceTimersByTime(1000);

    expect(reporter).toHaveBeenCalledWith(
      'client_run_stuck',
      expect.objectContaining({ agentId: 'x' }),
    );
  });

  it('restarting the same runId cancels the previous watchdog', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-6' }, { reporter, stuckAfterMs: 1000 });
    vi.advanceTimersByTime(500);
    trackRunStart({ runId: 'run-6' }, { reporter, stuckAfterMs: 1000 }); // fresh start replaces the old timer
    vi.advanceTimersByTime(999);

    expect(reporter).not.toHaveBeenCalled();
  });

  it('progress on an untracked runId is a no-op', () => {
    expect(() => trackRunProgress({ runId: 'never-started' })).not.toThrow();
  });

  it('terminal on an untracked runId is a no-op', () => {
    expect(() => trackRunTerminal({ runId: 'never-started', terminalState: 'failed' })).not.toThrow();
  });

  it('trackRunStart is a no-op when window is unavailable (SSR-style)', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(() => trackRunStart({ runId: 'run-ssr' }, {})).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults reporter and context when none are supplied, without throwing', () => {
    expect(() => trackRunStart({ runId: 'run-defaults' })).not.toThrow();
  });

  it('reports client_run_stuck after the default 5-minute window when stuckAfterMs is omitted', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-default-duration' }, { reporter });
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(reporter).toHaveBeenCalledWith('client_run_stuck', expect.objectContaining({ run_id: 'run-default-duration' }));
  });

  it('progress on an already-stuck run is a no-op (does not re-schedule or throw)', () => {
    const reporter = vi.fn();
    trackRunStart({ runId: 'run-7' }, { reporter, stuckAfterMs: 1000 });
    vi.advanceTimersByTime(1000); // reports stuck once
    expect(reporter).toHaveBeenCalledTimes(1);

    expect(() => trackRunProgress({ runId: 'run-7' })).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(reporter).toHaveBeenCalledTimes(1);
  });
});
