import { describe, expect, it, vi } from 'vitest';
import { createFanOutAiTraceSink, createLazyAiTraceSink, createRecordingAiTraceSink } from '../sinks.js';
import type { AiTraceEvent, AiTraceSink } from '../types.js';

const text = { chars: 6, text: 'secret', truncated: true, redactions: { exact: 1 } };
const totals = { turns: 1, toolCalls: 1, toolErrors: 1, inputTokens: null, outputTokens: null, costUsd: null };
const events = [
  { kind: 'run_started', traceId: 'r', runId: 'r', at: 0, agentId: 'a', provider: null, model: null, sessionId: null, input: text, tags: [] },
  { kind: 'model_turn', traceId: 'r', turnId: 't', index: 0, startedAt: 0, endedAt: 1, model: null,
    input: text, output: text, reasoning: text, usage: null, costUsd: null, costSource: null, ttftMs: null,
    stopReason: null, error: 'sensitive model error', errorContent: text },
  { kind: 'tool_call', traceId: 'r', turnId: 't', toolCallId: 'c', name: 'lookup', input: text, output: null,
    isError: true, errorClass: 'execution', startedAt: 0, endedAt: 1 },
  { kind: 'run_finished', traceId: 'r', at: 1, outcome: 'failed', error: { message: 'sensitive run error', code: 'E', content: text }, totals },
] as const satisfies readonly AiTraceEvent[];

describe('fan-out preserves destination capture policies', () => {
  it.each(['off', 'metadata'] as const)('strips every text surface for a %s destination beside a full sink', mode => {
    const full = createRecordingAiTraceSink();
    const limited = createRecordingAiTraceSink();
    const sink = createFanOutAiTraceSink({ sinks: [{ ...full, capture: 'full' }, { ...limited, capture: mode }] });
    for (const event of events) sink.record(event);
    const captured = mode === 'off' ? null : { chars: 6 };
    expect(sink.capture).toBe('full');
    expect(full.events).toEqual(events);
    expect(full.events[0]).toBe(events[0]);
    expect(limited.events).toEqual([
      { ...events[0], input: captured },
      { ...events[1], input: captured, output: captured, reasoning: captured, errorContent: captured, error: 'model_error' },
      { ...events[2], input: captured, output: null },
      { ...events[3], error: { message: 'run_error', code: 'E', content: captured } },
    ]);
    expect(events[1]).toHaveProperty('error', 'sensitive model error');
  });

  it('defaults to metadata, preserving null errors and absent text as null', async () => {
    const limited = createRecordingAiTraceSink();
    const sink = createFanOutAiTraceSink({ sinks: [limited] });
    const { errorContent: _errorContent, ...baseTurn } = events[1];
    const turn: AiTraceEvent = { ...baseTurn, input: null, output: null, reasoning: null, error: null };
    const finished: AiTraceEvent = { ...events[3], error: null };
    sink.record(turn);
    sink.record(finished);
    expect(sink.capture).toBe('metadata');
    expect(limited.events).toEqual([{ ...turn, errorContent: null }, finished]);
    await expect(sink.flush!()).resolves.toBeUndefined();
    await expect(sink.shutdown!()).resolves.toBeUndefined();
  });
});

describe('lazy sink delivery and cleanup', () => {
  it('waits for initialization before cleanup and uses the loaded backend for live events', async () => {
    let resolve!: (sink: AiTraceSink) => void;
    const recording = createRecordingAiTraceSink();
    const flush = vi.fn(async () => {});
    const shutdown = vi.fn(async () => {});
    const sink = createLazyAiTraceSink({ load: () => new Promise(done => { resolve = done; }) });
    const flushing = sink.flush!();
    const shuttingDown = sink.shutdown!();
    expect(flush).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    resolve({ ...recording, flush, shutdown });
    await Promise.all([flushing, shuttingDown]);
    sink.record(events[0]!);
    expect(recording.events).toEqual([events[0]]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(sink.dropped()).toBe(0);
  });

  it.each(['flush', 'shutdown'] as const)('isolates a loaded backend %s rejection', async method => {
    const failure = new Error(method);
    const onSinkError = vi.fn();
    const sink = createLazyAiTraceSink({ load: async () => ({ record() {}, [method]: async () => { throw failure; } }) }, { onSinkError });
    await expect(sink[method]!()).resolves.toBeUndefined();
    expect(onSinkError).toHaveBeenCalledTimes(1);
    expect(onSinkError).toHaveBeenCalledWith(failure);
  });

  it('supports a backend without cleanup methods', async () => {
    const recording = createRecordingAiTraceSink();
    const sink = createLazyAiTraceSink({ load: async () => recording });
    await sink.ready;
    sink.record(events[3]!);
    await expect(sink.flush!()).resolves.toBeUndefined();
    await expect(sink.shutdown!()).resolves.toBeUndefined();
    expect(recording.events).toEqual([events[3]]);
  });
});
