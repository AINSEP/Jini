import { describe, expect, it, vi } from 'vitest';
import { AgentExecutorError, isSupportedStreamFormat } from '../agent-executor/index.js';
import { LegacyMigrationError } from '../legacy-data-migration.js';
import { RunContextNotBoundError } from '../continuation/run-scoped-context-store.js';
import { ScheduledRunPersistenceError } from '../routines/scheduler.js';
import { AgentSessionStoreError } from '../store/agent-sessions/errors.js';
import { createInactivityWatchdog } from '../close-status.js';
import { classifyProcessExitFailure, resumableFromProcessExit } from '../run/core/retry.js';
import { isValidWallTime, isValidTimezone } from '../routines/schedule.js';

describe('public object arguments retain errors and fail closed predicates', () => {
  it('retains machine codes, messages, class identities and driver causes', () => {
    const executor = new AgentExecutorError({ code: 'AGENT_NOT_FOUND', message: 'missing agent' });
    expect([executor.name, executor.code, executor.message]).toEqual(['AgentExecutorError', 'AGENT_NOT_FOUND', 'missing agent']);
    const migration = new LegacyMigrationError({ code: 'blocked', message: 'existing payload' });
    expect([migration.name, migration.code, migration.message]).toEqual(['LegacyMigrationError', 'blocked', 'existing payload']);
    const context = new RunContextNotBoundError({ runId: 'r1' });
    expect(context.runId).toBe('r1');
    const cause = new Error('driver failure');
    const store = new AgentSessionStoreError({ code: 'unavailable' }, { cause });
    expect([store.name, store.code, store.message, store.cause]).toEqual(['AgentSessionStoreError', 'unavailable', 'agent session store unavailable', cause]);
    const scheduled = new ScheduledRunPersistenceError({ routineId: 'r2', slotAt: 123, originalError: cause });
    expect([scheduled.routineId, scheduled.slotAt, scheduled.originalError, scheduled.message]).toEqual(['r2', 123, cause, 'Routine r2 scheduled slot 123 could not be persisted']);
  });
  it('rejects unsupported stream families and invalid schedule fields', () => {
    expect(isSupportedStreamFormat({ value: 'unknown-format' })).toBe(false);
    expect(isSupportedStreamFormat({ value: 'plain' })).toBe(true);
    expect(isValidWallTime({ time: '25:00' })).toBe(false);
    expect(isValidWallTime({ time: '23:59' })).toBe(true);
    expect(isValidTimezone({ tz: 'invalid/timezone' })).toBe(false);
    expect(isValidTimezone({ tz: 'UTC' })).toBe(true);
  });
  it('retains signal retry classification and observed-output suppression', () => {
    expect(classifyProcessExitFailure({ code: null, signal: 'SIGKILL' })).toEqual({ failure_category: 'process_exit', failure_detail: 'signal_killed', retryable: true });
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' })).toBe(true);
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' }, { sideEffects: { userVisibleOutputSeen: true } })).toBe(false);
  });
});

describe('watchdog lifetime', () => {
  it('cannot rearm after repeated cancellation and later activity', () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const watchdog = createInactivityWatchdog({ timeoutMs: 20, onTimeout });
      watchdog.cancel({}); watchdog.cancel({}); watchdog.noteActivity({});
      vi.advanceTimersByTime(100);
      expect(onTimeout).toHaveBeenCalledTimes(0);
    } finally { vi.useRealTimers(); }
  });
  it('allows a fresh activity window after expiry until cancellation', () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const watchdog = createInactivityWatchdog({ timeoutMs: 20, onTimeout });
      vi.advanceTimersByTime(20); watchdog.noteActivity({}); vi.advanceTimersByTime(100);
      expect(onTimeout).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

// The old missing override let runtime definitions opt into auto-approval implicitly.
// Only an explicit bypass request may grant that authority.
describe('agent permission policy', () => {
  it('defaults build options to restricted and preserves explicit bypass', async () => {
    const { buildAgentBuildArgsOptions } = await import('../agent-executor/index.js');
    expect(buildAgentBuildArgsOptions({ input: {}, systemPromptOverlay: undefined })).toEqual({ permissionMode: 'restricted' });
    expect(buildAgentBuildArgsOptions({ input: { permissionMode: 'bypass' }, systemPromptOverlay: undefined })).toEqual({ permissionMode: 'bypass' });
    expect(() => buildAgentBuildArgsOptions({ input: { permissionMode: 'unknown' as never }, systemPromptOverlay: undefined })).toThrow('AgentExecutor: permissionMode must be restricted or bypass');
  });
});

it('uses an injected timer port and rejects its queued callback after cancellation', () => {
  let fire: () => void = () => {};
  const cancelTimer = vi.fn();
  const schedule = vi.fn(({ delayMs, callback }: { delayMs: number; callback: () => void }) => {
    expect(delayMs).toBe(20); fire = callback; return cancelTimer;
  });
  const onTimeout = vi.fn();
  const watchdog = createInactivityWatchdog({ timeoutMs: 20, onTimeout }, { scheduler: { schedule } });
  watchdog.cancel({}); fire(); watchdog.noteActivity({});
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(cancelTimer).toHaveBeenCalledTimes(1);
  expect(onTimeout).toHaveBeenCalledTimes(0);
});
