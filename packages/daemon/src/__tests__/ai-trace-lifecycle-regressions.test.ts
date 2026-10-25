import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordingAiTraceSink, createJsonEventStreamHandler, createClaudeStreamHandler, type AiTraceSink } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle, type RunLifecycle } from '../run-lifecycle.js';
import { withAiTracing, type AiTracingOptions } from '../ai-trace-lifecycle.js';
import { translateAgentRuntimeEvent } from '../agent-executor/event-translation.js';

function fixture(options: AiTracingOptions = {}, overrideSink?: AiTraceSink) {
  const sink = createRecordingAiTraceSink();
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}, { terminalRetentionMs: null, maxRuns: null }) }, { slowRunThresholdMs: null });
  const unsubscribed = vi.fn();
  let listener: ((event: RunProtocolEvent) => void) | undefined;
  const observed: RunLifecycle = { ...lifecycle, async stream(args, optional = {}) {
    listener = args.onEvent;
    const subscription = await lifecycle.stream(args, optional);
    if (subscription.kind !== 'ok') return subscription;
    return { kind: 'ok', unsubscribe: () => { unsubscribed(); subscription.unsubscribe(); } };
  } };
  return { sink, lifecycle, unsubscribed, deliverAgain: (event: RunProtocolEvent) => listener?.(event), traced: withAiTracing({ lifecycle: observed, sink: overrideSink ?? sink }, options) };
}

const success = { status: 'succeeded' as const, code: 0, signal: null, resumable: false };

describe('AI trace lifecycle failure containment and terminal observation', () => {
  afterEach(() => vi.useRealTimers());

  it('passes object arguments to provider/session mappers through the real decorator (#11)', async () => {
    const providerOf = vi.fn(({ agentId }: { agentId: string }) => `provider:${agentId}`);
    const sessionOf = vi.fn(({ contextRef }: { contextRef: string }) => `session:${contextRef}`);
    const { sink, traced } = fixture({ providerOf, sessionOf });
    const { run } = await traced.start({ contextRef: 'chat' }, { agentId: 'agent' });
    await traced.finish({ runId: run.id, ...success });
    expect(providerOf).toHaveBeenCalledWith({ agentId: 'agent' });
    expect(sessionOf).toHaveBeenCalledWith({ contextRef: 'chat' });
    expect(sink.events[0]).toMatchObject({ provider: 'provider:agent', sessionId: 'session:chat' });
  });

  it.each(['providerOf', 'sessionOf'] as const)('preserves a committed start when %s and the error reporter throw (#2)', async (mapper) => {
    const failure = new Error('mapper');
    const onSinkError = vi.fn(() => { throw new Error('logger'); });
    const { traced, lifecycle } = fixture({ [mapper]: () => { throw failure; }, onSinkError });
    const result = await traced.start({ contextRef: 'chat' });
    expect(result.started).toBe(true);
    expect(result.run.state).toBe('running');
    expect(await lifecycle.get({ runId: result.run.id })).toEqual(result.run);
    expect(onSinkError).toHaveBeenCalledWith(failure);
    await expect(traced.finish({ runId: result.run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('preserves emit and finish results when pricing and error reporting throw (#2)', async () => {
    const failure = new Error('pricing');
    const onSinkError = vi.fn(() => { throw new Error('logger'); });
    const { traced, sink, unsubscribed } = fixture({ priceUsage: () => { throw failure; }, onSinkError });
    const { run } = await traced.start({ contextRef: 'chat' });
    const data = { type: 'usage' as const, usage: { input_tokens: 10, output_tokens: 2 } };
    await expect(traced.emit({ runId: run.id, input: { event: 'agent', data } })).resolves.toMatchObject({ kind: 'agent', payload: data });
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
    expect(onSinkError).toHaveBeenCalledWith(failure);
    expect(sink.events.at(-1)).toMatchObject({ outcome: 'succeeded', totals: { turns: 1, inputTokens: 10, costUsd: null } });
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('contains a recorder failure during emit and releases it even when finalization fails (#2)', async () => {
    let failClock = false;
    const failure = new Error('clock');
    const onSinkError = vi.fn();
    const { traced, lifecycle, unsubscribed, deliverAgain } = fixture({ now: () => { if (failClock) throw failure; return 1; }, onSinkError });
    const { run } = await traced.start({ contextRef: 'chat' });
    failClock = true;
    await expect(traced.emit({ runId: run.id, input: { event: 'agent', data: { type: 'text_delta', delta: 'answer' } } })).resolves.toMatchObject({ kind: 'agent' });
    expect(onSinkError).toHaveBeenCalledTimes(1);
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
    expect(onSinkError).toHaveBeenCalledTimes(2);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    // Re-delivery of a terminal event cannot reach a retained failed recorder.
    const events: RunProtocolEvent[] = [];
    await lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
    deliverAgain(events.find((event) => event.kind === 'end')!);
    expect(onSinkError).toHaveBeenCalledTimes(2);
  });

  it('contains backend and reporter failures without changing any run transition (#2)', async () => {
    const sink: AiTraceSink = { record: () => { throw new Error('sink'); } };
    const { traced, unsubscribed } = fixture({ onSinkError: () => { throw new Error('logger'); } }, sink);
    const { run } = await traced.start({ contextRef: 'chat' });
    await expect(traced.emit({ runId: run.id, input: { event: 'agent', data: { type: 'text_delta', delta: 'answer' } } })).resolves.toMatchObject({ kind: 'agent' });
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('finishes watchdog traces once, releases the subscription, and retains the actual failed outcome (#8)', async () => {
    vi.useFakeTimers();
    const { traced, sink, unsubscribed } = fixture();
    const { run } = await traced.start({ contextRef: 'chat' }, { inactivityTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await traced.get({ runId: run.id })).toMatchObject({ state: 'failed' });
    expect(sink.events.filter((event) => event.kind === 'run_finished')).toMatchObject([{ outcome: 'failed' }]);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'failed' });
    expect(sink.events.filter((event) => event.kind === 'run_finished')).toHaveLength(1);
  });

  it('observes a terminal transition that races subscription replay (#8)', async () => {
    const { lifecycle, sink } = fixture();
    const raced: RunLifecycle = { ...lifecycle, async stream(args, optional) {
      await lifecycle.finish({ runId: args.runId, ...success });
      return lifecycle.stream(args, optional);
    } };
    const traced = withAiTracing({ lifecycle: raced, sink });
    await expect(traced.start({ contextRef: 'chat' })).resolves.toMatchObject({ started: true });
    await vi.waitFor(() => expect(sink.events.map((event) => event.kind)).toEqual(['run_started', 'run_finished']));
    expect(sink.events.at(-1)).toMatchObject({ outcome: 'succeeded' });
  });

  it('never delays a committed start or emit on a hung trace subscription (#2)', async () => {
    const { lifecycle, sink } = fixture();
    const hung: RunLifecycle = { ...lifecycle, stream: () => new Promise(() => {}) };
    const traced = withAiTracing({ lifecycle: hung, sink });
    const { run } = await traced.start({ contextRef: 'chat' });
    await expect(traced.emit({ runId: run.id, input: { event: 'agent', data: { type: 'text_delta', delta: 'answer' } } })).resolves.toMatchObject({ kind: 'agent' });
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
    expect(sink.events.map((event) => event.kind)).toEqual(['run_started']);
  });

  it.each([
    ['refused', async () => ({ kind: 'unknown-run' as const })],
    ['rejected', async () => { throw new Error('replay down'); }],
  ])('recheck #3: a %s subscription still finishes the started trace with the run\'s real outcome', async (_label, stream) => {
    const onSinkError = vi.fn();
    const { lifecycle, sink } = fixture();
    const traced = withAiTracing({ lifecycle: { ...lifecycle, stream }, sink }, { onSinkError });
    const { run } = await traced.start({ contextRef: 'chat' });
    await vi.waitFor(() => expect(onSinkError).toHaveBeenCalledTimes(1));
    await expect(traced.finish({ runId: run.id, status: 'cancelled', code: null, signal: 'SIGTERM', resumable: false })).resolves.toMatchObject({ state: 'cancelled' });
    await vi.waitFor(() => expect(sink.events.map((event) => event.kind)).toEqual(['run_started', 'run_finished']));
    expect(sink.events.at(-1)).toMatchObject({ outcome: 'cancelled' });
  });

  it('recheck #3: an unreadable terminal state after a failed subscription releases the trace without inventing an outcome', async () => {
    const { lifecycle, sink } = fixture();
    const waited = vi.fn(async () => { throw new Error('unknown run'); });
    const traced = withAiTracing({ lifecycle: { ...lifecycle, stream: async () => ({ kind: 'unknown-run' as const }), waitForTerminal: waited }, sink });
    const { run } = await traced.start({ contextRef: 'chat' });
    await vi.waitFor(() => expect(waited).toHaveBeenCalledWith({ runId: run.id }));
    await expect(traced.finish({ runId: run.id, ...success })).resolves.toMatchObject({ state: 'succeeded' });
    expect(sink.events.map((event) => event.kind)).toEqual(['run_started']);
  });

  it('propagates underlying lifecycle failures without treating them as telemetry failures', async () => {
    const onSinkError = vi.fn();
    const { traced } = fixture({ onSinkError });
    await expect(traced.emit({ runId: 'missing', input: { event: 'agent', data: { type: 'text_delta', delta: 'answer' } } })).rejects.toThrow();
    await expect(traced.finish({ runId: 'missing', ...success })).rejects.toThrow();
    expect(onSinkError).not.toHaveBeenCalled();
  });
});

describe('real normalizer → canonical translation → lifecycle → trace (#4)', () => {
  it.each(['codex', 'claude'] as const)('preserves %s cache/reasoning counters and stop reasons', async (provider) => {
    const { traced, sink } = fixture();
    const { run } = await traced.start({ contextRef: 'chat' }, { agentId: provider });
    const pending: Array<Promise<unknown>> = [];
    const onEvent = (rawEvent: unknown) => {
      const translation = translateAgentRuntimeEvent({ rawEvent });
      if (translation.kind === 'agent') pending.push(traced.emit({ runId: run.id, input: { event: 'agent', data: translation.payload } }));
    };
    const handler = provider === 'codex' ? createJsonEventStreamHandler({ kind: 'codex', onEvent }) : createClaudeStreamHandler({ onEvent }, { costBasis: 'run' });
    const frame = provider === 'codex'
      ? { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 3, reasoning_output_tokens: 2 } }
      : { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } };
    handler.feed({ chunk: JSON.stringify(frame) + '\n' });
    handler.flush();
    await Promise.all(pending);
    await traced.finish({ runId: run.id, ...success });
    const turn = sink.events.find((event) => event.kind === 'model_turn')!;
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: provider === 'claude' ? 4 : null, reasoningTokens: provider === 'codex' ? 2 : null });
    expect(turn.stopReason).toBe(provider === 'claude' ? 'end_turn' : null);
  });
});
