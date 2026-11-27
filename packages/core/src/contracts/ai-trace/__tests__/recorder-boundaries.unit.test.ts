import { expect, it, vi } from 'vitest';
import { createAiTraceRecorder } from '../recorder.js';
import { createRecordingAiTraceSink } from '../sinks.js';
import type { AiTraceEvent } from '../types.js';

it('attaches a late prompt only to the first model turn and ignores later prompt replacements', () => {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { capture: 'full', now: () => 100 });
  recorder.start({});
  recorder.noteInput({ input: 'late prompt' });
  recorder.observe({ type: 'text_delta', delta: 'first answer' });
  recorder.observe({ type: 'usage', usage: { input_tokens: 3 } });
  recorder.noteInput({ input: 'must not replace the first prompt' });
  recorder.observe({ type: 'text_delta', delta: 'second answer' });
  recorder.finish({ outcome: 'succeeded' });
  const turns = sink.events.filter(event => event.kind === 'model_turn');
  expect(turns.map(turn => ({ input: turn.input, output: turn.output }))).toEqual([
    { input: { chars: 11, text: 'late prompt' }, output: { chars: 12, text: 'first answer' } },
    { input: null, output: { chars: 13, text: 'second answer' } },
  ]);
});

it('reports orphan non-text tool results without inventing content or an input', () => {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { now: () => 100 });
  recorder.observe({ type: 'tool_result', content: { image: 'private bytes' }, isError: true });
  recorder.finish({ outcome: 'failed' });
  expect(sink.events.find(event => event.kind === 'tool_call')).toEqual({
    kind: 'tool_call', traceId: 'r', toolCallId: 'r:turn:0:tool:unknown', turnId: 'r:turn:0', name: 'unknown',
    input: null, output: null, isError: true, errorClass: 'execution', startedAt: 100, endedAt: 100,
  });
  expect(sink.events.at(-1)).toHaveProperty('totals', { turns: 1, toolCalls: 1, toolErrors: 1,
    inputTokens: null, outputTokens: null, costUsd: null });
});

it('rejects error prose and oversized labels as error codes while retaining a safe model label', () => {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { now: () => 0 });
  recorder.observe({ type: 'status', model: 'model', ttftMs: NaN });
  recorder.observe({ type: 'error', message: '', code: 'not a label' });
  recorder.finish({ outcome: 'failed' }, { error: { message: 'safe error', code: 'x'.repeat(65) } });
  expect(sink.events.find(event => event.kind === 'model_turn')).toMatchObject({ model: 'model', error: 'model_error', errorCode: null,
    ttftMs: null, errorContent: { chars: 5 } });
  expect(sink.events.at(-1)).toMatchObject({ error: { message: 'run_error', code: null, content: { chars: 10 } } });
});

it('contains a synchronous sink failure even when no error reporter is configured', () => {
  const record = vi.fn((_event: AiTraceEvent) => { throw new Error('sink unavailable'); });
  const recorder = createAiTraceRecorder({ sink: { record }, runId: 'r', agentId: 'a' }, { now: () => 0 });
  expect(() => recorder.finish({ outcome: 'succeeded' })).not.toThrow();
  expect(record.mock.calls.map(([event]) => (event as { kind: string }).kind)).toEqual(['run_started', 'run_finished']);
});

it('attributes delayed tools and merged usage to their HTTP request and starts follow-up timing at its own boundary', () => {
  const sink = createRecordingAiTraceSink();
  let now = 0;
  const recorder = createAiTraceRecorder({ sink, runId: 'http', agentId: 'provider' }, { capture: 'full', now: () => now });
  recorder.start({});
  now = 10;
  recorder.observe({ type: 'status', label: 'requesting', model: 'first-model' });
  now = 14;
  recorder.observe({ type: 'thinking_delta', delta: 'checking' });
  recorder.observe({ type: 'thinking_delta', delta: ' facts' });
  recorder.observe({ type: 'usage', usage: { input_tokens: 9 } });
  recorder.observe({ type: 'usage', usage: { output_tokens: 4 } });
  recorder.observe({ type: 'tool_use', id: 'c', name: 'lookup', input: { id: 3 } });
  recorder.observe({ type: 'tool_result', toolUseId: 'c', content: 'found' });
  recorder.observe({ type: 'turn_end', stopReason: 'tool_use' });
  now = 30;
  recorder.observe({ type: 'status', label: 'requesting', model: 'next-model' });
  now = 37;
  recorder.observe({ type: 'text_delta', delta: 'answer' });
  now = 45;
  recorder.observe({ type: 'end', reason: 'stop' });
  now = 60;
  recorder.finish({ outcome: 'succeeded' });

  const turns = sink.events.filter(event => event.kind === 'model_turn');
  expect(turns).toHaveLength(2);
  expect(turns.find(turn => turn.turnId === 'http:turn:0')).toMatchObject({
    model: 'first-model', startedAt: 10, endedAt: 30, toolCallCount: 1,
    reasoning: { chars: 14, text: 'checking facts' }, usage: { inputTokens: 9, outputTokens: 4 }, stopReason: 'tool_use',
  });
  expect(turns.find(turn => turn.turnId === 'http:turn:1')).toMatchObject({
    model: 'next-model', startedAt: 30, endedAt: 45, ttftMs: 7, stopReason: 'stop',
  });
  expect(sink.events.find(event => event.kind === 'tool_call')).toMatchObject({
    toolCallId: 'http:turn:0:tool:c', turnId: 'http:turn:0', output: { chars: 5, text: 'found' },
  });
});

it('reports a pricing failure without inventing cost or losing usage', () => {
  const sink = createRecordingAiTraceSink();
  const failure = new Error('price unavailable');
  const priceUsage = vi.fn(() => { throw failure; });
  const onSinkError = vi.fn();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, {
    now: () => 0, model: 'local-model', priceUsage, onSinkError,
  });
  recorder.start({});
  recorder.observe({ type: 'usage', usage: { input_tokens: 17 } });
  recorder.finish({ outcome: 'succeeded' });

  expect(priceUsage).toHaveBeenCalledExactlyOnceWith({ model: 'local-model', usage: {
    inputTokens: 17, outputTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
  } });
  expect(onSinkError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(sink.events.find(event => event.kind === 'model_turn')).toMatchObject({ usage: { inputTokens: 17 }, costUsd: null, costSource: null });
  expect(sink.events.find(event => event.kind === 'run_finished')).toMatchObject({ outcome: 'succeeded', totals: { inputTokens: 17, costUsd: null } });
});

it('counts reasoning without exporting it as text in metadata mode and ignores boundary-only turns', () => {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { now: () => 0 });
  recorder.start({});
  recorder.observe({ type: 'turn_end', stopReason: 'no open turn' });
  recorder.observe({ type: 'end', reason: 'no open turn' });
  recorder.observe({ type: 'thinking_delta', delta: 'private' });
  recorder.observe({ type: 'thinking_delta', delta: null });
  recorder.observe({ type: 'turn_end', stopReason: 'length' });
  recorder.observe({ type: 'end', reason: 'terminal-summary' });
  recorder.finish({ outcome: 'succeeded' });
  const turns = sink.events.filter(event => event.kind === 'model_turn');
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ reasoning: { chars: 7 }, stopReason: 'length' });
  expect(turns[0]?.reasoning).toStrictEqual({ chars: 7 });
});
