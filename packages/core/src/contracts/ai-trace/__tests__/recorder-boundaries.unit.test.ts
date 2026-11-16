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
