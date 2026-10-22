import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../event-log.js';
import type { EventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';

async function finishedRun(lifecycle: ReturnType<typeof createRunLifecycle>, runId: string): Promise<void> {
  await lifecycle.start({ contextRef: 'ctx' }, { runId });
  await lifecycle.finish({ runId, status: 'succeeded', code: 0, signal: null, resumable: false });
}

/** An in-memory log with event-log retention disabled, so only the lifecycle can free a run. */
function unboundedLog(): EventLog {
  return createInMemoryEventLog({}, { terminalRetentionMs: null, maxRuns: null });
}

describe('RunLifecycle — dropEventsOnEviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drops an evicted run\'s events (N=30 runs: log holds 30 runs without the option, 0 with it)', async () => {
    const withoutLog = unboundedLog();
    const without = createRunLifecycle({ eventLog: withoutLog }, { terminalRetentionMs: 1_000 });
    const withLog = unboundedLog();
    const withDrop = createRunLifecycle({ eventLog: withLog }, { terminalRetentionMs: 1_000, dropEventsOnEviction: true });
    for (let i = 0; i < 30; i += 1) {
      await finishedRun(without, `r${i}`);
      await finishedRun(withDrop, `r${i}`);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await withoutLog.listRunIds({})).toHaveLength(30);
    expect(await withLog.listRunIds({})).toHaveLength(0);
  });

  it('drops on cap eviction too, keeping the log no larger than maxTerminalRuns', async () => {
    const eventLog = unboundedLog();
    const lifecycle = createRunLifecycle({ eventLog }, { maxTerminalRuns: 2, terminalRetentionMs: 1_000_000, dropEventsOnEviction: true });
    for (let i = 0; i < 5; i += 1) await finishedRun(lifecycle, `r${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(await eventLog.listRunIds({})).toEqual(['r3', 'r4']);
  });

  it('reports a failing drop through onInternalError instead of throwing', async () => {
    const eventLog = unboundedLog();
    const error = new Error('drop failed');
    vi.spyOn(eventLog, 'drop').mockRejectedValue(error);
    const onInternalError = vi.fn();
    const lifecycle = createRunLifecycle({ eventLog }, { terminalRetentionMs: 10, dropEventsOnEviction: true, onInternalError });
    await finishedRun(lifecycle, 'r1');
    await vi.advanceTimersByTimeAsync(10);
    expect(onInternalError).toHaveBeenCalledWith({ source: 'event-log-drop', runId: 'r1', error });
  });

  it('falls back to console.error without a sink, and contains a throwing sink', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('drop failed');
    const noSinkLog = unboundedLog();
    vi.spyOn(noSinkLog, 'drop').mockRejectedValue(error);
    await finishedRun(createRunLifecycle({ eventLog: noSinkLog }, { terminalRetentionMs: 10, dropEventsOnEviction: true }), 'a');
    const sinkError = new Error('sink failed');
    const throwingSinkLog = unboundedLog();
    vi.spyOn(throwingSinkLog, 'drop').mockRejectedValue(error);
    const onInternalError = () => { throw sinkError; };
    await finishedRun(createRunLifecycle({ eventLog: throwingSinkLog }, { terminalRetentionMs: 10, dropEventsOnEviction: true, onInternalError }), 'b');
    await vi.advanceTimersByTimeAsync(10);
    expect(consoleError).toHaveBeenCalledWith('[@jini-ai/daemon] internal error (event-log-drop, runId=a)', error);
    expect(consoleError).toHaveBeenCalledWith('[@jini-ai/daemon] internal error sink failed (event-log-drop, runId=b)', sinkError);
  });
});
