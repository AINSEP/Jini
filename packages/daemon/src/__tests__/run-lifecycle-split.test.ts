import { afterEach, describe, expect, it, vi } from 'vitest';
import * as daemon from '../index.js';
import { createInMemoryEventLog } from '../event-log.js';
import type { EventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RunLifecycle — split characterization', () => {
  it('reserves the run and idempotency key in the same turn before the start append settles', async () => {
    const inner = createInMemoryEventLog({});
    let releaseStart!: () => void;
    const gate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const eventLog: EventLog = {
      ...inner,
      async append(input) {
        if (input.event === 'start') await gate;
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: null });
    const start = lifecycle.start({ contextRef: 'ctx' }, { runId: 'reserved', idempotencyKey: 'key' });
    const duplicate = lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: 'key' });
    const finish = lifecycle.finish({ runId: 'reserved', status: 'succeeded', code: 0, signal: null, resumable: false });
    const results = Promise.all([start, duplicate, finish]);
    releaseStart();
    const [original, replay, terminal] = await results;
    expect(original).toMatchObject({ started: true, run: { id: 'reserved' } });
    expect(replay).toMatchObject({ started: false, run: { id: 'reserved' } });
    expect(terminal).toMatchObject({ id: 'reserved', state: 'succeeded' });
    const journal = await inner.replay({ runId: 'reserved', afterCursor: null });
    expect(journal.kind).toBe('ok');
    if (journal.kind === 'ok') expect(journal.entries.map((entry) => entry.event)).toEqual(['start', 'end']);
  });

  it('preserves failed-start error identity for dependents and hides the provisional run from queries', async () => {
    const inner = createInMemoryEventLog({});
    const error = new Error('start append rejected');
    let rejectStart!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, reject) => { rejectStart = reject; });
    const eventLog: EventLog = {
      ...inner,
      async append(input) {
        if (input.runId === 'failed-start' && input.event === 'start') await gate;
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: null });
    const start = lifecycle.start({ contextRef: 'ctx' }, { runId: 'failed-start', idempotencyKey: 'key' });
    const duplicate = lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: 'key' });
    const terminal = lifecycle.waitForTerminal({ runId: 'failed-start' });
    const failures = Promise.all([
      expect(start).rejects.toBe(error),
      expect(duplicate).rejects.toBe(error),
      expect(terminal).rejects.toBe(error),
    ]);
    const get = lifecycle.get({ runId: 'failed-start' });
    const list = lifecycle.list({});
    rejectStart(error);
    await failures;
    expect(await get).toBeUndefined();
    expect(await list).toEqual([]);
    const retry = await lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: 'key' });
    expect(retry.started).toBe(true);
    expect(retry.run.id).not.toBe('failed-start');
  });

  it('owns one hydration and looks up finish after the gated list settles', async () => {
    const inner = createInMemoryEventLog({});
    await inner.append({ runId: 'orphan', event: 'start', data: { contextRef: 'ctx' } });
    let releaseList!: () => void;
    const gate = new Promise<void>((resolve) => { releaseList = resolve; });
    const listRunIds = vi.fn(async () => {
      await gate;
      return inner.listRunIds({});
    });
    const eventLog: EventLog = { ...inner, listRunIds };
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: null });
    const first = lifecycle.rehydrate({});
    const second = lifecycle.rehydrate({});
    const finish = vi.spyOn(lifecycle, 'finish');
    releaseList();
    await Promise.all([first, second]);
    await lifecycle.rehydrate({});
    expect(listRunIds).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({ runId: 'orphan', status: 'failed', code: null, signal: null, resumable: true });
    expect(await lifecycle.get({ runId: 'orphan' })).toMatchObject({ state: 'failed' });
  });

  it('removes a provisional subscriber when terminal catch-up throws the original error', async () => {
    const eventLog = createInMemoryEventLog({});
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: null });
    const { run } = await lifecycle.start({ contextRef: 'ctx' });
    await lifecycle.finish({ runId: run.id, status: 'failed', code: null, signal: null, resumable: true });
    const journal = await eventLog.replay({ runId: run.id, afterCursor: null });
    expect(journal.kind).toBe('ok');
    if (journal.kind !== 'ok') throw new Error('expected a replayable terminal journal');
    const end = journal.entries[journal.entries.length - 1]!;
    expect(end.event).toBe('end');
    const error = new Error('terminal catch-up callback rejected');
    const onEvent = vi.fn(() => { throw error; });
    await expect(lifecycle.stream({ runId: run.id, onEvent }, { afterCursor: end.id })).rejects.toBe(error);
    expect((await lifecycle.resume({ runId: run.id })).resumed).toBe(true);
    await lifecycle.emit({ runId: run.id, input: { event: 'agent', data: { type: 'status', label: 'resumed' } } });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('replays a saved cancellation before registering a late listener', async () => {
    const eventLog = createInMemoryEventLog({});
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: null });
    const { run } = await lifecycle.start({ contextRef: 'ctx' });
    await lifecycle.cancel({ runId: run.id });
    const error = new Error('late cancel listener rejected');
    const listener = vi.fn(() => { throw error; });
    let thrown: unknown;
    try {
      lifecycle.onCancelRequested({ runId: run.id, listener });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(error);
    await expect(lifecycle.cancel({ runId: run.id })).resolves.toMatchObject({ state: 'running' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears correlation and invokes event drop before end delivery and terminal waiter settlement', async () => {
    vi.useFakeTimers();
    const inner = createInMemoryEventLog({});
    const order: string[] = [];
    const eventLog: EventLog = {
      ...inner,
      async drop(input) {
        order.push('drop');
        return inner.drop(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog }, {
      slowRunThresholdMs: null,
      maxTerminalRuns: 0,
      dropEventsOnEviction: true,
      delegatedResultCorrelation: {
        record: vi.fn(),
        matches: vi.fn(() => false),
        clearRun() { order.push('clear'); },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx' });
    await lifecycle.stream({ runId: run.id, onEvent(event) {
      if (event.kind === 'end') order.push('end');
    } });
    const terminal = lifecycle.waitForTerminal({ runId: run.id }).then((status) => {
      order.push('waiter');
      return status;
    });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    expect(await terminal).toMatchObject({ state: 'succeeded' });
    expect(order).toEqual(['clear', 'drop', 'end', 'waiter']);
    expect(await lifecycle.get({ runId: run.id })).toBeUndefined();
  });

  it('keeps nested slow notices suspended until the final resume starts a fresh window', async () => {
    vi.useFakeTimers();
    const eventLog = createInMemoryEventLog({});
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: 20 });
    const { run } = await lifecycle.start({ contextRef: 'ctx' });
    const notices: number[] = [];
    await lifecycle.stream({ runId: run.id, onEvent(event) {
      if (event.kind === 'agent' && event.payload.type === 'slow_running') notices.push(event.ts);
    } });
    lifecycle.suspendSlowRunNotice({ runId: run.id });
    lifecycle.suspendSlowRunNotice({ runId: run.id });
    lifecycle.resumeSlowRunNotice({ runId: run.id });
    await vi.advanceTimersByTimeAsync(100);
    expect(notices).toEqual([]);
    lifecycle.resumeSlowRunNotice({ runId: run.id });
    const resumedAt = Date.now();
    await vi.advanceTimersByTimeAsync(19);
    expect(notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(notices).toEqual([resumedAt + 20]);
    expect(await lifecycle.get({ runId: run.id })).toMatchObject({ state: 'running' });
  });

  it('keeps the three defaults and ten helper functions available from the package entry', () => {
    expect([
      daemon.DEFAULT_TERMINAL_RETENTION_MS,
      daemon.DEFAULT_MAX_TERMINAL_RUNS,
      daemon.DEFAULT_SLOW_RUN_THRESHOLD_MS,
    ]).toEqual([86_400_000, 1000, 45_000]);
    for (const helper of [
      daemon.resolveIdempotentReplayRunId,
      daemon.registerIdempotencyKeyIfPresent,
      daemon.clearIdempotencyIndexEntryIfMatching,
      daemon.buildStartPayload,
      daemon.deliverReplayedEvents,
      daemon.deliverUndeliveredEvents,
      daemon.finishStreamSubscription,
      daemon.computeRetentionDelayMs,
      daemon.armWatchdogIfConfigured,
      daemon.armSlowRunWatchdogIfConfigured,
    ]) expect(helper).toBeTypeOf('function');
  });
});
