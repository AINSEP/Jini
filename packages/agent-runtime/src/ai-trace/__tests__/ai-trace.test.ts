import { describe, expect, it, vi } from 'vitest';
import { createAiTraceRecorder, createRecordingAiTraceSink, createLazyAiTraceSink, noopAiTraceSink, captureText, classifyToolError, normalizeAiUsage, type AiTraceEvent, type AiTraceSink } from '../index.js';
import { SCENARIO_EVENTS, steppingClock } from './scenario.js';

function runScenario(sink: AiTraceSink, capture: 'off' | 'metadata' | 'full' = 'metadata'): void {
  const recorder = createAiTraceRecorder({ sink, runId: 'run-1', agentId: 'claude' }, { provider: 'anthropic', sessionId: 'chat-9', capture, now: steppingClock() });
  recorder.start({ input: 'Write a post titled Hi' });
  for (const event of SCENARIO_EVENTS) recorder.observe(event);
  recorder.finish({ outcome: 'succeeded' });
}

describe('swap proof: noop and recording sinks see the same trace (the Langfuse mapping test lives with its provider plugin)', () => {
  it('records run → turn → 2 tool calls (one input_validation failure) → outcome', () => {
    const sink = createRecordingAiTraceSink();
    runScenario(sink);
    expect(sink.events.map((e) => e.kind)).toEqual(['run_started', 'tool_call', 'tool_call', 'model_turn', 'run_finished']);
    const [started, failedTool, okTool, turn, finished] = sink.events as [AiTraceEvent & { kind: 'run_started' }, AiTraceEvent & { kind: 'tool_call' }, AiTraceEvent & { kind: 'tool_call' }, AiTraceEvent & { kind: 'model_turn' }, AiTraceEvent & { kind: 'run_finished' }];
    expect(started).toMatchObject({ traceId: 'run-1', agentId: 'claude', provider: 'anthropic', sessionId: 'chat-9', input: { chars: 22 } });
    expect(failedTool).toMatchObject({ toolCallId: 'run-1:turn:0:tool:t1', name: 'content_post_create', isError: true, errorClass: 'input_validation', turnId: turn.turnId });
    expect(okTool).toMatchObject({ toolCallId: 'run-1:turn:0:tool:t2', isError: false, errorClass: null });
    expect(okTool.endedAt! - okTool.startedAt).toBeGreaterThan(0);
    expect(turn).toMatchObject({ model: 'claude-sonnet-4-5', costUsd: 0.0123, costSource: 'provider', stopReason: 'end_turn', usage: { inputTokens: 1800, outputTokens: 75, cacheReadTokens: 500, cacheWriteTokens: null, reasoningTokens: null }, output: { chars: 23 } });
    expect(finished).toMatchObject({ outcome: 'succeeded', error: null, totals: { turns: 1, toolCalls: 2, toolErrors: 1, inputTokens: 1800, outputTokens: 75, costUsd: 0.0123 } });
  });

  it('noop sink accepts the whole scenario', () => {
    expect(() => runScenario(noopAiTraceSink)).not.toThrow();
  });
});

describe('capture modes and redaction', () => {
  const secretPrompt = 'email ana@example.com api_key=notarealkey123';
  function capturedInput(capture: 'off' | 'metadata' | 'full') {
    const sink = createRecordingAiTraceSink();
    const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { capture });
    recorder.start({ input: secretPrompt });
    return (sink.events[0] as AiTraceEvent & { kind: 'run_started' }).input;
  }

  it('off sends nothing, metadata sends only the length, full sends redacted text', () => {
    expect(capturedInput('off')).toBeNull();
    expect(capturedInput('metadata')).toEqual({ chars: secretPrompt.length });
    const full = capturedInput('full')!;
    expect(full.text).not.toContain('ana@example.com');
    expect(full.text).not.toContain('notarealkey123');
    expect(full.text).toContain('[REDACTED:');
    expect(Object.values(full.redactions!).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2);
  });

  it('defaults to metadata so prompts never leave the process unless a host opts in', () => {
    expect(captureText({ text: 'hello' })).toEqual({ chars: 5 });
  });

  it('masks host-known exact secrets and truncates long text', () => {
    const captured = captureText({ text: `token=${'z'.repeat(4)} plain hunter2xyz ${'a'.repeat(50)}` }, { mode: 'full', exactSecrets: ['hunter2xyz'], maxChars: 30 })!;
    expect(captured.text).not.toContain('hunter2xyz');
    expect(captured.truncated).toBe(true);
    expect(captured.text!.length).toBe(30);
  });

  it('applies the capture mode to tool inputs and outputs too', () => {
    const sink = createRecordingAiTraceSink();
    runScenario(sink, 'off');
    const tool = sink.events.find((e) => e.kind === 'tool_call') as AiTraceEvent & { kind: 'tool_call' };
    expect(tool.input).toBeNull();
    expect(tool.output).toBeNull();
  });
});

describe('failure handling', () => {
  it('a throwing backend never breaks the run and is reported to the host', () => {
    const onSinkError = vi.fn();
    const recorder = createAiTraceRecorder({ sink: { record: () => { throw new Error('backend down'); } }, runId: 'r', agentId: 'a' }, { onSinkError });
    expect(() => { recorder.start({}); recorder.observe({ type: 'text_delta', delta: 'x' }); recorder.finish({ outcome: 'succeeded' }); }).not.toThrow();
    expect(onSinkError).toHaveBeenCalledTimes(3);
  });

  it('a failed run carries the last stream error and unresolved tools are flagged, not dropped', () => {
    const sink = createRecordingAiTraceSink();
    const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { now: steppingClock() });
    recorder.observe({ type: 'tool_use', id: 'slow', name: 'bash', input: { command: 'sleep 999' } });
    recorder.observe({ type: 'error', message: 'stream disconnected' });
    recorder.finish({ outcome: 'failed' });
    expect(sink.events.map((e) => e.kind)).toEqual(['run_started', 'model_turn', 'tool_call', 'run_finished']);
    expect(sink.events[1]).toMatchObject({ error: 'model_error', errorContent: { chars: 19 } });
    expect(sink.events[2]).toMatchObject({ toolCallId: 'r:turn:0:tool:slow', endedAt: null, isError: false });
    expect(sink.events[3]).toMatchObject({ outcome: 'failed', error: { message: 'run_error', code: null, content: { chars: 19 } } });
  });

  it('ignores events after finish and duplicate tool_use ids', () => {
    const sink = createRecordingAiTraceSink();
    const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' });
    recorder.observe({ type: 'tool_use', id: 't', name: 'x', input: {} });
    recorder.observe({ type: 'tool_use', id: 't', name: 'x', input: {} });
    recorder.observe({ type: 'tool_result', toolUseId: 't', content: 'ok', isError: false });
    recorder.finish({ outcome: 'succeeded' });
    recorder.observe({ type: 'text_delta', delta: 'late' });
    expect(sink.events.filter((e) => e.kind === 'tool_call')).toHaveLength(1);
    expect(sink.events.at(-1)!.kind).toBe('run_finished');
  });

  it('estimated cost is labelled estimated and only used when the provider reported none', () => {
    const sink = createRecordingAiTraceSink();
    const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, { model: 'm', priceUsage: ({ usage }) => (usage.inputTokens ?? 0) * 1e-6 });
    recorder.observe({ type: 'usage', usage: { prompt_tokens: 1000, completion_tokens: 5 } });
    recorder.observe({ type: 'usage', usage: { input_tokens: 1 }, costUsd: 0.5 });
    recorder.finish({ outcome: 'succeeded' });
    const turns = sink.events.filter((e) => e.kind === 'model_turn');
    expect(turns.map((t) => [t.costUsd, t.costSource])).toEqual([[0.001, 'estimated'], [0.5, 'provider']]);
  });
});

describe('classifyToolError', () => {
  it.each([
    ["Unknown input 'body'", 'input_validation'],
    ['[tool error] Unknown input \'body\'', 'input_validation'],
    ['InputValidationError: title is required', 'input_validation'],
    ['permission denied', 'denied'],
    ['Tool call was rejected by user', 'denied'],
    ['command timed out after 120s', 'timeout'],
    ['ENOENT: no such file', 'execution'],
    ['', 'execution'],
  ])('%s → %s', (content, expected) => {
    expect(classifyToolError({ content })).toBe(expected);
  });
});

describe('normalizeAiUsage', () => {
  it.each([
    ['anthropic', { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: null }],
    ['openai', { prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 5 } }, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: null, reasoningTokens: 5 }],
    ['google', { promptTokenCount: 1, candidatesTokenCount: 2, cachedContentTokenCount: 3, thoughtsTokenCount: 5 }, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: null, reasoningTokens: 5 }],
    ['acp / codex', { input_tokens: 1, output_tokens: 2, cached_read_tokens: 3, thought_tokens: 5 }, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: null, reasoningTokens: 5 }],
    ['neutral usage', { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 }, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 }],
  ])('%s', (_name, usage, expected) => {
    expect(normalizeAiUsage({ usage })).toEqual(expected);
  });

  it('returns null for absent or counter-less usage (copilot reports only duration)', () => {
    expect(normalizeAiUsage({ usage: null })).toBeNull();
    expect(normalizeAiUsage({ usage: { sessionDurationMs: 900 } })).toBeNull();
  });
});

describe('createLazyAiTraceSink', () => {
  it('queues while the backend loads, then replays in order', async () => {
    const recording = createRecordingAiTraceSink();
    let resolve!: (sink: AiTraceSink) => void;
    const lazy = createLazyAiTraceSink({ load: () => new Promise((r) => { resolve = r; }) });
    runScenario(lazy);
    expect(recording.events).toHaveLength(0);
    resolve(recording);
    await lazy.ready;
    expect(recording.events.map((e) => e.kind)).toEqual(['run_started', 'tool_call', 'tool_call', 'model_turn', 'run_finished']);
  });

  it('bounds the queue and degrades to noop when the SDK fails to load', async () => {
    const onLoadError = vi.fn();
    let reject!: (error: unknown) => void;
    const lazy = createLazyAiTraceSink({ load: () => new Promise((_r, j) => { reject = j; }) }, { maxQueued: 2, onLoadError });
    runScenario(lazy);
    expect(lazy.dropped()).toBe(3);
    reject(new Error("Cannot find package 'langfuse'"));
    await lazy.ready;
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(() => runScenario(lazy)).not.toThrow();
  });
});
