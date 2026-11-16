import { describe, expect, it } from 'vitest';
import { createAiTraceRecorder } from '../recorder.js';
import { createRecordingAiTraceSink, createFanOutAiTraceSink } from '../sinks.js';
import type { AiTraceEvent } from '../types.js';

function setup(capture: 'full' | 'metadata' | 'off' = 'full') {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { capture, now: () => 50 });
  const kinds = () => sink.events.map(e => e.kind);
  return { sink, recorder, kinds };
}

describe('recorder lifecycle', () => {
  it('ignores a second start and a second finish', () => {
    const { recorder, kinds, sink } = setup();
    recorder.start({ input: 'first' });
    recorder.start({ input: 'second' });
    recorder.finish({ outcome: 'succeeded' });
    recorder.finish({ outcome: 'failed' }, { error: { message: 'late' } });
    expect(kinds()).toEqual(['run_started', 'run_finished']);
    expect(sink.events[0]).toMatchObject({ kind: 'run_started', input: { chars: 5, text: 'first' } });
    expect(sink.events[1]).toMatchObject({ kind: 'run_finished', outcome: 'succeeded', error: null });
  });
});

describe('recorder turn details', () => {
  it('keeps reasoning text only in full capture and counts it otherwise', () => {
    const full = setup('full');
    full.recorder.observe({ type: 'thinking_delta', delta: 'hmm ' });
    full.recorder.observe({ type: 'thinking_delta', delta: 'ok' });
    full.recorder.observe({ type: 'thinking_delta', delta: 42 });
    full.recorder.finish({ outcome: 'succeeded' });
    expect(full.sink.events.find(e => e.kind === 'model_turn')).toMatchObject({ reasoning: { chars: 6, text: 'hmm ok' } });

    const meta = setup('metadata');
    meta.recorder.observe({ type: 'thinking_delta', delta: 'secret thoughts' });
    meta.recorder.finish({ outcome: 'succeeded' });
    expect(meta.sink.events.find(e => e.kind === 'model_turn')).toMatchObject({ reasoning: { chars: 15 } });
    expect(JSON.stringify(meta.sink.events)).not.toContain('secret thoughts');
  });

  it('treats a non-string text delta as empty', () => {
    const { recorder, sink } = setup();
    recorder.observe({ type: 'text_delta', delta: { not: 'text' } });
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.find(e => e.kind === 'model_turn')).toMatchObject({ output: null });
  });

  it('reports the provider ttft when status gives one, and derives it from the first token otherwise', () => {
    let clock = 100;
    const sink = createRecordingAiTraceSink();
    const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { now: () => clock });
    recorder.observe({ type: 'status', label: 'requesting' });
    recorder.observe({ type: 'status', ttftMs: 7 });
    recorder.observe({ type: 'text_delta', delta: 'x' });
    clock = 130;
    recorder.observe({ type: 'status', label: 'requesting' });
    clock = 140;
    recorder.observe({ type: 'text_delta', delta: 'y' });
    clock = 190;
    recorder.finish({ outcome: 'succeeded' });
    const turns = sink.events.filter((e): e is Extract<AiTraceEvent, { kind: 'model_turn' }> => e.kind === 'model_turn');
    expect(turns.map(t => t.ttftMs)).toEqual([7, 10]);
  });
});

describe('recorder tool events', () => {
  it('ignores a tool_use without an id and names an unnamed tool "unknown"', () => {
    const { recorder, sink } = setup();
    recorder.observe({ type: 'tool_use', name: 'ghost', input: {} });
    recorder.observe({ type: 'tool_use', id: 't1', input: { a: 1 } });
    recorder.observe({ type: 'tool_result', toolUseId: 't1', content: 'done' });
    recorder.finish({ outcome: 'succeeded' });
    const calls = sink.events.filter(e => e.kind === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'unknown', isError: false, output: { chars: 4, text: 'done' } });
  });
});

describe('fan-out sink capture policy', () => {
  it('rejects an event of an unknown kind with a TypeError naming it, contained by the sink error reporter', () => {
    const received: unknown[] = [];
    const errors: unknown[] = [];
    const sink = createFanOutAiTraceSink({ sinks: [{ record: (e) => { received.push(e); }, capture: 'metadata' }] }, { onSinkError: (e: unknown) => errors.push(e) });
    sink.record({ kind: 'surprise' } as never);
    expect(received).toEqual([]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('Unknown AI trace event kind: surprise');
  });
});
