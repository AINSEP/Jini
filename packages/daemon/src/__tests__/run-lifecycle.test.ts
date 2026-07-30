import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import type { EventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';

function makeLifecycle(maxEntriesPerRun?: number) {
  const eventLog = createInMemoryEventLog(maxEntriesPerRun !== undefined ? { maxEntriesPerRun } : {});
  return { eventLog, lifecycle: createRunLifecycle({ eventLog }) };
}

describe('RunLifecycle — start', () => {
  it('starts a run in the running state and emits a single start event first', async () => {
    const { lifecycle } = makeLifecycle();
    const { run, started } = await lifecycle.start({ contextRef: 'ctx-1', agentId: 'agent-a' });

    expect(started).toBe(true);
    expect(run.state).toBe('running');

    let delivered: RunProtocolEvent[] = [];
    const result = await lifecycle.stream(run.id, (event) => delivered.push(event));
    expect(result.kind).toBe('ok');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: 'start', payload: { runId: run.id, agentId: 'agent-a' } });
  });

  it('never keys a run on a product-scoped record identifier — only an opaque contextRef', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'opaque-ref-xyz' });
    const listed = await lifecycle.list('opaque-ref-xyz');
    expect(listed.map((r) => r.id)).toContain(run.id);
  });

  it('a duplicate start with the same idempotencyKey replays the existing run instead of creating a second one', async () => {
    const { lifecycle } = makeLifecycle();
    const first = await lifecycle.start({ contextRef: 'ctx-1', idempotencyKey: 'dup-1' });
    const second = await lifecycle.start({ contextRef: 'ctx-1', idempotencyKey: 'dup-1' });

    expect(second.started).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    const all = await lifecycle.list('ctx-1');
    expect(all).toHaveLength(1);
  });

  it('starts with distinct idempotencyKeys (or none) as separate runs', async () => {
    const { lifecycle } = makeLifecycle();
    const a = await lifecycle.start({ contextRef: 'ctx-1', idempotencyKey: 'k1' });
    const b = await lifecycle.start({ contextRef: 'ctx-1', idempotencyKey: 'k2' });
    expect(a.run.id).not.toBe(b.run.id);
  });

  it('unwinds the run and idempotency reservation when the durable start append fails', async () => {
    const inner = createInMemoryEventLog();
    let failStart = true;
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'start' && failStart) throw new Error('start append failed');
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });
    const input = { contextRef: 'ctx-start-failure', runId: 'retryable-run', idempotencyKey: 'retryable-key' };

    await expect(lifecycle.start(input)).rejects.toThrow('start append failed');
    expect(await lifecycle.get('retryable-run')).toBeUndefined();

    failStart = false;
    await expect(lifecycle.start(input)).resolves.toMatchObject({
      run: { id: 'retryable-run', state: 'running' },
      started: true,
    });
  });

  it('throws when starting with an explicit runId that already exists and no idempotencyKey makes it a legitimate replay', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.start({ contextRef: 'ctx-1', runId: 'dup-run-id' });
    await expect(lifecycle.start({ contextRef: 'ctx-1', runId: 'dup-run-id' })).rejects.toThrow(/already exists/);
  });

  it('rehydrates durable terminal state, context grouping, idempotency, and replay after a lifecycle restart', async () => {
    const eventLog = createInMemoryEventLog();
    const first = createRunLifecycle({ eventLog });
    const started = await first.start({ contextRef: 'ctx-restart', runId: 'run-restart', idempotencyKey: 'same-request' });
    await first.emit(started.run.id, { event: 'agent', data: { type: 'text_delta', delta: 'durable output' } });
    await first.finish({ runId: started.run.id, status: 'failed', code: 1, signal: null, resumable: true });

    const recovered = createRunLifecycle({ eventLog });
    await recovered.rehydrate();

    expect(await recovered.get(started.run.id)).toMatchObject({ id: started.run.id, state: 'failed' });
    expect((await recovered.list('ctx-restart')).map((run) => run.id)).toEqual([started.run.id]);
    const duplicate = await recovered.start({ contextRef: 'ctx-restart', idempotencyKey: 'same-request' });
    expect(duplicate).toEqual({ run: expect.objectContaining({ id: started.run.id, state: 'failed' }), started: false });

    const events: RunProtocolEvent[] = [];
    await recovered.stream(started.run.id, (event) => events.push(event));
    expect(events.map((event) => event.kind)).toEqual(['start', 'agent', 'end']);
    expect(events[0]?.payload).toMatchObject({ contextRef: 'ctx-restart' });
  });

  it('marks an active run interrupted by a restart as a resumable failure instead of leaving a dead driver running', async () => {
    const eventLog = createInMemoryEventLog();
    const first = createRunLifecycle({ eventLog });
    const { run } = await first.start({ contextRef: 'ctx-interrupted', runId: 'run-interrupted' });

    const recovered = createRunLifecycle({ eventLog });
    await recovered.rehydrate();

    expect(await recovered.get(run.id)).toMatchObject({ state: 'failed' });
    expect(await recovered.resume(run.id)).toEqual({ run: expect.objectContaining({ state: 'running' }), resumed: true });
    const replay = await eventLog.replay(run.id, null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') expect(replay.entries.filter((entry) => entry.event === 'end')).toHaveLength(1);
  });
});

describe('RunLifecycle — rehydrate edge cases', () => {
  it('rehydrates a succeeded run and a cancelled run with their real terminal states, not the failed default', async () => {
    const eventLog = createInMemoryEventLog();
    const first = createRunLifecycle({ eventLog });
    const succeeded = await first.start({ contextRef: 'ctx-a', runId: 'run-succeeded' });
    await first.finish({ runId: succeeded.run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    const cancelled = await first.start({ contextRef: 'ctx-a', runId: 'run-cancelled' });
    await first.finish({ runId: cancelled.run.id, status: 'cancelled', code: null, signal: 'SIGTERM', resumable: false });

    const recovered = createRunLifecycle({ eventLog });
    await recovered.rehydrate();

    expect(await recovered.get('run-succeeded')).toMatchObject({ state: 'succeeded' });
    expect(await recovered.get('run-cancelled')).toMatchObject({ state: 'cancelled' });
  });

  it('defensively treats a malformed (non-record) persisted end-entry payload as a failed, non-resumable terminal state', async () => {
    const eventLog = createInMemoryEventLog();
    await eventLog.append({ runId: 'run-malformed', event: 'start', data: { runId: 'run-malformed', contextRef: 'ctx-a' } });
    await eventLog.append({ runId: 'run-malformed', event: 'end', data: 'not-a-record-payload' });

    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate();

    expect(await lifecycle.get('run-malformed')).toMatchObject({ state: 'failed' });
    expect(await lifecycle.resume('run-malformed')).toMatchObject({ resumed: false });
  });

  it('CR-R6: rehydrate() is single-flight — overlapping calls and a later post-completion call each trigger exactly one real hydration pass', async () => {
    // Asserting only the final reconstructed state (as this test previously did) would still
    // pass even if the `if (hydration) return hydration;` single-flight guard were deleted —
    // re-processing an idempotent terminal log twice yields the same end state, just wastefully.
    // Gating the EventLog's own `listRunIds`/`replay` call counts is what actually distinguishes
    // "one hydration pass, reused" from "hydrated twice, coincidentally same result".
    const eventLog = createInMemoryEventLog();
    const first = createRunLifecycle({ eventLog });
    await first.start({ contextRef: 'ctx-a', runId: 'run-a' });
    await first.finish({ runId: 'run-a', status: 'succeeded', code: 0, signal: null, resumable: false });

    const recovered = createRunLifecycle({ eventLog });
    const listRunIdsSpy = vi.spyOn(eventLog, 'listRunIds');
    const replaySpy = vi.spyOn(eventLog, 'replay');

    const firstCall = recovered.rehydrate();
    const secondCall = recovered.rehydrate(); // overlapping, issued before firstCall resolves
    await Promise.all([firstCall, secondCall]);
    expect(await recovered.get('run-a')).toMatchObject({ state: 'succeeded' });
    expect(listRunIdsSpy).toHaveBeenCalledTimes(1);
    expect(replaySpy).toHaveBeenCalledTimes(1);

    // A rehydrate() called again after hydration already completed also
    // short-circuits via the same `if (hydration) return hydration;` guard —
    // no additional EventLog reads at all.
    await recovered.rehydrate();
    expect(await recovered.get('run-a')).toMatchObject({ state: 'succeeded' });
    expect(listRunIdsSpy).toHaveBeenCalledTimes(1);
    expect(replaySpy).toHaveBeenCalledTimes(1);
  });

  it('skips a runId that is already present in the in-memory registry (e.g. started directly on this same instance)', async () => {
    const eventLog = createInMemoryEventLog();
    const lifecycle = createRunLifecycle({ eventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-a', runId: 'run-live' });

    await lifecycle.rehydrate();

    expect(await lifecycle.get(run.id)).toMatchObject({ state: 'running' });
    expect((await lifecycle.list('ctx-a')).map((r) => r.id)).toEqual([run.id]);
  });

  it('skips a runId whose retained entries are empty (e.g. every entry evicted before a restart)', async () => {
    const eventLog = createInMemoryEventLog({ maxEntriesPerRun: 0 });
    const first = createRunLifecycle({ eventLog });
    await first.start({ contextRef: 'ctx-a', runId: 'run-empty' });

    const recovered = createRunLifecycle({ eventLog });
    await recovered.rehydrate();

    // Nothing to reconstruct from zero retained entries — the run is simply
    // absent from the rehydrated instance rather than half-populated.
    expect(await recovered.get('run-empty')).toBeUndefined();
  });

  it("falls back to the first retained entry's timestamp and an undefined contextRef once the original start entry has been evicted", async () => {
    const eventLog = createInMemoryEventLog({ maxEntriesPerRun: 1 });
    const first = createRunLifecycle({ eventLog });
    const { run } = await first.start({ contextRef: 'ctx-a', runId: 'run-evicted-start' });
    // Cap of 1 evicts the 'start' entry on the very next append — only the
    // most recent entry ever survives.
    await first.emit(run.id, { event: 'agent', data: { type: 'status', label: 'still going' } });
    await first.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const recovered = createRunLifecycle({ eventLog });
    await recovered.rehydrate();

    expect(await recovered.get(run.id)).toMatchObject({ id: run.id, state: 'succeeded' });
    expect((await recovered.list()).map((r) => r.id)).toContain(run.id);
    // No contextRef is recoverable once the start entry (its only carrier)
    // has been evicted — list(contextRef) can no longer find this run.
    expect((await recovered.list('ctx-a')).map((r) => r.id)).not.toContain(run.id);
  });
});

describe('RunLifecycle — get/list direct queries', () => {
  it('get() returns undefined for an unknown runId', async () => {
    const { lifecycle } = makeLifecycle();
    expect(await lifecycle.get('never-started')).toBeUndefined();
  });

  it('list() with no contextRef argument returns every known run, not just one context', async () => {
    const { lifecycle } = makeLifecycle();
    const a = await lifecycle.start({ contextRef: 'ctx-a' });
    const b = await lifecycle.start({ contextRef: 'ctx-b' });
    const all = await lifecycle.list();
    expect(all.map((r) => r.id).sort()).toEqual([a.run.id, b.run.id].sort());
  });
});

describe('RunLifecycle — emit', () => {
  it('appends driver events in call order and fans them out live', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const delivered: RunProtocolEvent[] = [];
    await lifecycle.stream(run.id, (event) => delivered.push(event));

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'Thinking' } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'Hello' } });

    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent', 'agent']);
  });

  it('throws on an unknown runId', async () => {
    const { lifecycle } = makeLifecycle();
    await expect(lifecycle.emit('no-such-run', { event: 'agent', data: { type: 'status', label: 'x' } })).rejects.toThrow(
      /unknown run/,
    );
  });

  it('throws when emitting on an already-terminal run', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    await expect(lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'x' } })).rejects.toThrow(/terminal/);
  });

  it('CR-R1: isolates a throwing subscriber (e.g. a dead SSE writer) so emit() still resolves and other subscribers still receive the event', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    // Only throw for a *live* delivery through emit()'s fan-out — the replay-phase
    // delivery inside stream() itself (the 'start' entry) must complete normally so the
    // subscription is actually established, matching how a real transport (e.g. the SSE
    // writer) only fails once flowing, not while replaying buffered history.
    let deliveries = 0;
    const result = await lifecycle.stream(run.id, () => {
      deliveries += 1;
      if (deliveries > 1) throw new Error('dead transport');
    });
    expect(result.kind).toBe('ok');
    const delivered: RunProtocolEvent[] = [];
    await lifecycle.stream(run.id, (event) => delivered.push(event));

    await expect(
      lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'x' } }),
    ).resolves.toMatchObject({ kind: 'agent' });
    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent']);
  });
});

describe('RunLifecycle — finish', () => {
  it('transitions to the terminal state and emits exactly one end event with the mapped status', async () => {
    const { lifecycle, eventLog } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const finished = await lifecycle.finish({ runId: run.id, status: 'cancelled', code: null, signal: 'SIGTERM', resumable: false });
    expect(finished.state).toBe('cancelled');

    const replay = await eventLog.replay(run.id, null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      const endEntries = replay.entries.filter((e) => e.event === 'end');
      expect(endEntries).toHaveLength(1);
      // RunState uses 'cancelled' (2 L); RunEndPayload.status uses 'canceled'
      // (1 L) — the vocabulary-firewall canary cited in extraction-plan §12
      // C5. Assert the bridge maps correctly rather than silently mismatching.
      expect(endEntries[0]!.data).toMatchObject({ status: 'canceled' });
    }
  });

  it('is idempotent — a second finish() call while already terminal is a no-op, no duplicate end event', async () => {
    const { lifecycle, eventLog } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: true });
    const secondCallResult = await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    // The second call's *requested* status ('succeeded') must NOT overwrite the first's ('failed').
    expect(secondCallResult.state).toBe('failed');

    const replay = await eventLog.replay(run.id, null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries.filter((e) => e.event === 'end')).toHaveLength(1);
    }
  });

  it('serializes concurrent finish calls behind one durable end append', async () => {
    const inner = createInMemoryEventLog();
    let releaseEnd!: () => void;
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve;
    });
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end') await endGate;
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-concurrent-finish' });

    const first = lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: true });
    const second = lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    releaseEnd();

    await expect(first).resolves.toMatchObject({ state: 'failed' });
    await expect(second).resolves.toMatchObject({ state: 'failed' });
    const replay = await inner.replay(run.id, null);
    expect(replay.kind === 'ok' && replay.entries.filter((entry) => entry.event === 'end')).toHaveLength(1);
  });

  it('keeps a run retryable and resolves existing waiters after a failed durable end append', async () => {
    const inner = createInMemoryEventLog();
    let failEnd = true;
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end' && failEnd) throw new Error('end append failed');
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-finish-failure' });
    const waiter = lifecycle.waitForTerminal(run.id);

    await expect(
      lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: true }),
    ).rejects.toThrow('end append failed');
    const statusAfterFailure = await lifecycle.get(run.id);
    expect(statusAfterFailure).toMatchObject({ state: 'running' });
    expect(statusAfterFailure).not.toHaveProperty('endedAt');

    failEnd = false;
    await expect(
      lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false }),
    ).resolves.toMatchObject({ state: 'succeeded' });
    await expect(waiter).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('delivers the end event live to a subscriber that is already streaming when finish() is called', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const delivered: RunProtocolEvent[] = [];
    const result = await lifecycle.stream(run.id, (event) => delivered.push(event));
    expect(result.kind).toBe('ok');
    expect(delivered.map((e) => e.kind)).toEqual(['start']);

    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    // Delivered via finish()'s own live-subscriber broadcast loop, not a
    // subsequent replay — no reconnect happened here.
    expect(delivered.map((e) => e.kind)).toEqual(['start', 'end']);
  });

  it('resolves waitForTerminal()', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const waiter = lifecycle.waitForTerminal(run.id);
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    const status = await waiter;
    expect(status.state).toBe('succeeded');
  });

  it('CR-R1: a throwing subscriber does not strand waitForTerminal() — finish() still resolves terminal waiters', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    // Same reasoning as the emit() isolation test above: let the 'start' replay delivery
    // succeed so the subscription is actually established, then throw only on the live
    // 'end' event delivered by finish()'s own fan-out.
    let deliveries = 0;
    await lifecycle.stream(run.id, () => {
      deliveries += 1;
      if (deliveries > 1) throw new Error('dead transport on the terminal end event');
    });
    const waiter = lifecycle.waitForTerminal(run.id);

    await expect(
      lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false }),
    ).resolves.toMatchObject({ state: 'succeeded' });
    await expect(waiter).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('waitForTerminal() resolves immediately for an already-terminal run', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    const status = await lifecycle.waitForTerminal(run.id);
    expect(status.state).toBe('succeeded');
  });
});

describe('RunLifecycle — cancel', () => {
  it('is idempotent — cancelling an already-terminal run is a no-op, not an error', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const status = await lifecycle.cancel({ runId: run.id });
    expect(status.state).toBe('succeeded');
  });

  it('cancelling a run whose finish() is still committing returns that finish\'s outcome instead of recording cancel intent', async () => {
    // `finish()` reserves the terminal transition with `finishPromise` *before* awaiting the
    // durable end append, and the run stays non-terminal for that whole window. A `cancel()`
    // arriving inside it must join the in-flight transition rather than latch cancellation intent
    // onto a run that is already on its way to a different terminal state — otherwise the run
    // would report `succeeded` while also claiming a cancel was requested.
    const inner = createInMemoryEventLog();
    let releaseEndAppend: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseEndAppend = resolve;
    });
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end') await gate;
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-cancel-race' });

    const listener = vi.fn();
    lifecycle.onCancelRequested(run.id, listener);

    const finishPromise = lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    // Still mid-flight: the end append is gated, so the run has not committed yet.
    expect(await lifecycle.get(run.id)).toMatchObject({ state: 'running' });

    const cancelPromise = lifecycle.cancel({ runId: run.id, reason: 'too late' });
    releaseEndAppend?.();

    expect((await cancelPromise).state).toBe('succeeded');
    expect((await finishPromise).state).toBe('succeeded');
    // No cancellation intent was recorded, so no driver was told to tear anything down.
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies onCancelRequested listeners without itself forcing a terminal transition', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const listener = vi.fn();
    lifecycle.onCancelRequested(run.id, listener);
    const status = await lifecycle.cancel({ runId: run.id, reason: 'user requested' });

    expect(listener).toHaveBeenCalledWith({ runId: run.id, reason: 'user requested' });
    // The kernel does not own subprocess signaling (extraction-plan task 7,
    // @jini-ai/agent-runtime); it is the driver's job to observe the signal and
    // call finish() once it knows the real outcome.
    expect(status.state).toBe('running');

    const finished = await lifecycle.finish({ runId: run.id, status: 'cancelled', code: null, signal: 'SIGTERM', resumable: false });
    expect(finished.state).toBe('cancelled');
  });

  it('unsubscribe stops further cancel notifications', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const listener = vi.fn();
    const unsubscribe = lifecycle.onCancelRequested(run.id, listener);
    unsubscribe();
    await lifecycle.cancel({ runId: run.id });

    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that subscribes AFTER cancel() was already called still learns about it immediately (no missed-cancellation race)', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await lifecycle.cancel({ runId: run.id, reason: 'already gone' });

    const lateListener = vi.fn();
    lifecycle.onCancelRequested(run.id, lateListener);

    expect(lateListener).toHaveBeenCalledWith({ runId: run.id, reason: 'already gone' });
  });
});

describe('RunLifecycle — resume', () => {
  it('is a no-op when the run is not terminal', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const result = await lifecycle.resume(run.id);
    expect(result).toEqual({ run: expect.objectContaining({ state: 'running' }), resumed: false });
  });

  it('is a no-op when the run is terminal but not resumable', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });

    const result = await lifecycle.resume(run.id);
    expect(result.resumed).toBe(false);
    expect(result.run.state).toBe('failed');
  });

  it('transitions a resumable terminal run back to running without emitting a new protocol event, and the event log cursor sequence continues unbroken', async () => {
    const { lifecycle, eventLog } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'working' } });
    await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: true });

    const beforeResumeReplay = await eventLog.replay(run.id, null);
    expect(beforeResumeReplay.kind).toBe('ok');
    const countBefore = beforeResumeReplay.kind === 'ok' ? beforeResumeReplay.entries.length : -1;

    const result = await lifecycle.resume(run.id);
    expect(result.resumed).toBe(true);
    expect(result.run.state).toBe('running');

    const afterResumeReplay = await eventLog.replay(run.id, null);
    expect(afterResumeReplay.kind).toBe('ok');
    if (afterResumeReplay.kind === 'ok') {
      // resume() itself emits nothing — same entry count as before resume.
      expect(afterResumeReplay.entries).toHaveLength(countBefore);
    }

    // Continuing to drive the resumed run appends onto the SAME cursor sequence.
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'retrying' } });
    const finished = await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    expect(finished.state).toBe('succeeded');

    const finalReplay = await eventLog.replay(run.id, null);
    expect(finalReplay.kind).toBe('ok');
    if (finalReplay.kind === 'ok') {
      const ids = finalReplay.entries.map((e) => Number(e.id));
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(finalReplay.entries.filter((e) => e.event === 'end')).toHaveLength(2);
    }
  });

  it('waitForTerminal() opens a fresh wait window after resume()', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: true });
    await lifecycle.resume(run.id);

    const waiter = lifecycle.waitForTerminal(run.id);
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    await waiter;
    expect(resolved).toBe(true);
  });
});

describe('RunLifecycle — stream (reconnect)', () => {
  it('replays buffered history then subscribes for live events; unsubscribe stops delivery', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'a' } });

    const delivered: RunProtocolEvent[] = [];
    const result = await lifecycle.stream(run.id, (e) => delivered.push(e));
    expect(result.kind).toBe('ok');
    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent']);

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'b' } });
    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent', 'agent']);

    if (result.kind === 'ok') {
      result.unsubscribe();
    }
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'c' } });
    expect(delivered).toHaveLength(3);
  });

  it('propagates replay-gap from the underlying EventLog', async () => {
    const { lifecycle } = makeLifecycle(2);
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    for (let i = 0; i < 5; i += 1) {
      await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: String(i) } });
    }
    const result = await lifecycle.stream(run.id, () => {}, { afterCursor: '1' });
    expect(result.kind).toBe('replay-gap');
  });

  it('returns unknown-run for a runId the lifecycle has never seen', async () => {
    const { lifecycle } = makeLifecycle();
    const result = await lifecycle.stream('never-started', () => {});
    expect(result).toEqual({ kind: 'unknown-run' });
  });

  it('OD-parity: a reconnecting client already caught up on a terminal run still receives one more delivery of the end event', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const fullReplayDelivered: RunProtocolEvent[] = [];
    await lifecycle.stream(run.id, (e) => fullReplayDelivered.push(e));
    const lastCursor = fullReplayDelivered[fullReplayDelivered.length - 1]!.opaqueCursor;

    // Reconnect with a cursor already at the very last (end) event.
    const delivered: RunProtocolEvent[] = [];
    const result = await lifecycle.stream(run.id, (e) => delivered.push(e), { afterCursor: lastCursor });
    expect(result.kind).toBe('ok');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ kind: 'end' });
  });

  it('buffers a live event that arrives while the replay query is still in flight, then delivers it deduped against the (by-then-caught-up) replay', async () => {
    // stream()'s own doc: "Subscribe before awaiting the durable replay. Any
    // event appended while the replay query is in flight is buffered, then
    // delivered after the replay entries..." — a real durable EventLog
    // adapter has genuine I/O latency on replay(); this in-memory reference
    // implementation resolves instantly, so the narrow subscribe→replay
    // window is reproduced deterministically here via an injected EventLog
    // wrapper that gates its first replay() call open only once this test
    // has appended a live event during that window.
    const inner = createInMemoryEventLog();
    let releaseReplay: (() => void) | undefined;
    const gatedEventLog: EventLog = {
      append: inner.append,
      listRunIds: inner.listRunIds,
      drop: inner.drop,
      async replay(runId, afterCursor) {
        if (releaseReplay === undefined) {
          await new Promise<void>((resolve) => {
            releaseReplay = resolve;
          });
        }
        return inner.replay(runId, afterCursor);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog: gatedEventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const delivered: RunProtocolEvent[] = [];
    const streamPromise = lifecycle.stream(run.id, (event) => delivered.push(event));

    // stream() has already subscribed and is now suspended awaiting the
    // gated replay() — this event lands on the live subscriber (buffered,
    // since `replaying` is still true) before the replay query resolves.
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'arrived-during-replay' } });

    expect(releaseReplay).toBeDefined();
    releaseReplay!();
    const result = await streamPromise;
    expect(result.kind).toBe('ok');

    // By the time the gated replay actually ran, the underlying store
    // already had both entries, so replay's own delivery already included
    // the 'agent' entry — the buffered copy must be deduped, not delivered
    // a second time.
    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent']);
  });

  it('delivers a buffered live event through the buffer fallback when it genuinely postdates a stale replay snapshot', async () => {
    // Complements the dedup case above: here the injected EventLog's
    // replay() computes its result BEFORE the live emit() happens (a real
    // stale durable read), so the buffered 'agent' event is the only way it
    // ever reaches the caller — not a duplicate of anything replay saw.
    const inner = createInMemoryEventLog();
    let releaseReplay: (() => void) | undefined;
    const gatedEventLog: EventLog = {
      append: inner.append,
      listRunIds: inner.listRunIds,
      drop: inner.drop,
      async replay(runId, afterCursor) {
        const snapshot = await inner.replay(runId, afterCursor);
        if (releaseReplay === undefined) {
          await new Promise<void>((resolve) => {
            releaseReplay = resolve;
          });
        }
        return snapshot;
      },
    };
    const lifecycle = createRunLifecycle({ eventLog: gatedEventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const delivered: RunProtocolEvent[] = [];
    const streamPromise = lifecycle.stream(run.id, (event) => delivered.push(event));

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'postdates-the-snapshot' } });

    expect(releaseReplay).toBeDefined();
    releaseReplay!();
    const result = await streamPromise;
    expect(result.kind).toBe('ok');

    expect(delivered.map((e) => e.kind)).toEqual(['start', 'agent']);
  });

  it('flushes buffered live output before exactly one end when the run finishes during replay', async () => {
    const inner = createInMemoryEventLog();
    let releaseReplay: (() => void) | undefined;
    const gatedEventLog: EventLog = {
      append: inner.append,
      listRunIds: inner.listRunIds,
      drop: inner.drop,
      async replay(runId, afterCursor) {
        const snapshot = await inner.replay(runId, afterCursor);
        if (releaseReplay === undefined) {
          await new Promise<void>((resolve) => {
            releaseReplay = resolve;
          });
        }
        return snapshot;
      },
    };
    const lifecycle = createRunLifecycle({ eventLog: gatedEventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-terminal-during-replay' });
    const delivered: RunProtocolEvent[] = [];
    const streamPromise = lifecycle.stream(run.id, (event) => delivered.push(event));

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'must arrive before end' } });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(releaseReplay).toBeDefined();
    releaseReplay!();
    await expect(streamPromise).resolves.toMatchObject({ kind: 'ok' });

    expect(delivered.map((event) => event.kind)).toEqual(['start', 'agent', 'end']);
    expect(delivered.filter((event) => event.kind === 'end')).toHaveLength(1);
  });

  it('removes the provisional subscriber when durable replay rejects', async () => {
    const inner = createInMemoryEventLog();
    const replayError = new Error('durable replay failed');
    const eventLog: EventLog = {
      append: inner.append,
      listRunIds: inner.listRunIds,
      drop: inner.drop,
      async replay() {
        throw replayError;
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });
    const { run } = await lifecycle.start({ contextRef: 'ctx-replay-error' });
    const subscriber = vi.fn();

    await expect(lifecycle.stream(run.id, subscriber)).rejects.toBe(replayError);
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'after failed replay' } });

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('removes the provisional subscriber when a replay callback throws', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-callback-error' });
    const subscriber = vi.fn(() => {
      throw new Error('consumer callback failed');
    });

    await expect(lifecycle.stream(run.id, subscriber)).rejects.toThrow('consumer callback failed');
    expect(subscriber).toHaveBeenCalledTimes(1);

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'after callback failure' } });
    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('the unsubscribe handle returned for an already-terminal run is callable and a genuine no-op', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const result = await lifecycle.stream(run.id, () => {});
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(() => result.unsubscribe()).not.toThrow();
    }
  });
});

describe('RunLifecycle — inactivity watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes a run as a resumable failure if no emit() occurs within the inactivity timeout', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', inactivityTimeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('failed');
    const resumeResult = await lifecycle.resume(run.id);
    expect(resumeResult.resumed).toBe(true);
  });

  it('emit() resets the inactivity window', async () => {
    const { lifecycle } = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', inactivityTimeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(700);
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'still going' } });
    await vi.advanceTimersByTimeAsync(700);

    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('running');
  });

  it('contains and reports a durable end-append failure from the timer callback', async () => {
    const inner = createInMemoryEventLog();
    const appendError = new Error('event database is closed');
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end') throw appendError;
        return inner.append(input);
      },
    };
    const onInternalError = vi.fn();
    const lifecycle = createRunLifecycle({ eventLog, onInternalError });
    const { run } = await lifecycle.start({ contextRef: 'ctx-timeout-error', inactivityTimeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(onInternalError).toHaveBeenCalledWith({
      source: 'inactivity-timeout',
      runId: run.id,
      error: appendError,
    });
    const statusAfterFailure = await lifecycle.get(run.id);
    expect(statusAfterFailure).toMatchObject({ state: 'running' });
    expect(statusAfterFailure).not.toHaveProperty('endedAt');
  });

  it('logs a durable end-append failure to the console when no onInternalError sink is configured', async () => {
    // Same containment path as the test above, but with the diagnostic sink omitted: the failure
    // must still surface somewhere rather than vanishing into a swallowed timer rejection.
    const inner = createInMemoryEventLog();
    const appendError = new Error('event database is closed');
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end') throw appendError;
        return inner.append(input);
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lifecycle = createRunLifecycle({ eventLog });
      const { run } = await lifecycle.start({ contextRef: 'ctx-no-sink', inactivityTimeoutMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`internal error (inactivity-timeout, runId=${run.id})`),
        appendError,
      );
      // Containment, not recovery: the run is left exactly as it was.
      expect(await lifecycle.get(run.id)).toMatchObject({ state: 'running' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not let a throwing onInternalError sink turn a contained timer failure into a second unhandled rejection', async () => {
    const inner = createInMemoryEventLog();
    const appendError = new Error('event database is closed');
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'end') throw appendError;
        return inner.append(input);
      },
    };
    const sinkError = new Error('telemetry sink exploded');
    const onInternalError = vi.fn(() => {
      throw sinkError;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lifecycle = createRunLifecycle({ eventLog, onInternalError });
      const { run } = await lifecycle.start({ contextRef: 'ctx-bad-sink', inactivityTimeoutMs: 1_000 });

      // Must not reject: the watchdog callback is fire-and-forget, so a throwing sink escaping
      // here would surface as an unhandled rejection (fatal in modern Node).
      await vi.advanceTimersByTimeAsync(1_000);

      expect(onInternalError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`internal error sink failed (inactivity-timeout, runId=${run.id})`),
        sinkError,
      );
      expect(await lifecycle.get(run.id)).toMatchObject({ state: 'running' });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('a watchdog armed onto a run that finished during start()\'s own durable append is a no-op once it fires (start/finish race)', async () => {
    // The record is inserted into the registry (`runs.set`) *before* `start()` awaits the
    // durable append of its 'start' event, but the watchdog itself is only armed *after*
    // that await resolves. If a caller races `finish()` in during that window — the record
    // already exists so `finish()` can find it — the watchdog then gets armed onto an
    // already-terminal run. `handleInactivityTimeout` must recognize that and never call
    // `finish()` a second time when it eventually fires.
    const inner = createInMemoryEventLog();
    let releaseStartAppend: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseStartAppend = resolve;
    });
    const eventLog: EventLog = {
      ...inner,
      append: async (input) => {
        if (input.event === 'start') await gate;
        return inner.append(input);
      },
    };
    const lifecycle = createRunLifecycle({ eventLog });

    const startPromise = lifecycle.start({ contextRef: 'ctx-1', runId: 'race-run', inactivityTimeoutMs: 1_000 });
    const finishPromise = lifecycle.finish({ runId: 'race-run', status: 'failed', code: null, signal: null, resumable: true });

    releaseStartAppend?.();
    await startPromise; // resumes and arms a watchdog after the durable start exists
    await finishPromise; // appends the end only after the start promise commits

    const finishSpy = vi.spyOn(lifecycle, 'finish');
    await vi.advanceTimersByTimeAsync(1_000); // fires the watchdog's onTimeout

    expect(finishSpy).not.toHaveBeenCalled();
    const status = await lifecycle.get('race-run');
    expect(status?.state).toBe('failed');
  });
});
