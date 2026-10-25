import { describe, expect, it, vi } from 'vitest';
import { createAiTraceRecorder, createRecordingAiTraceSink, createFanOutAiTraceSink, createLazyAiTraceSink, type AiTraceEvent, type AiTraceSink } from '../index.js';
import { runGoogleToolTurn } from '../../providers/google-messages.js';
import { runAnthropicToolTurn } from '../../providers/anthropic-messages.js';
import { runOpenAiToolTurn } from '../../providers/openai-chat.js';
import type { PinnedFetch, DnsLookupFn } from '../../providers/connection-guard.js';
import { createJsonEventStreamHandler } from '../../json-event-stream.js';

function fixture(options: Parameters<typeof createAiTraceRecorder>[1] = {}) {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: 'r', agentId: 'a' }, options);
  return { sink, recorder };
}

// Real request/normalizer/tool-loop code, with DNS and HTTP replaced by bounded, in-memory ports.
function transport({ requests }: { requests: readonly (readonly Record<string, unknown>[])[] }) {
  let next = 0;
  const fetchImpl: PinnedFetch = vi.fn(async () => {
    const frames = requests[next++];
    if (!frames) throw new Error('unexpected fixture request');
    return {
      ok: true, status: 200, text: async () => '',
      body: { async *[Symbol.asyncIterator]() {
        for (const frame of frames) yield new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
      } },
    };
  });
  const dnsLookup: DnsLookupFn = async () => [{ address: '8.8.8.8', family: 4 }];
  return { fetchImpl, dnsLookup };
}

describe('error capture policy (review #1)', () => {
  it.each(['off', 'metadata', 'full'] as const)('protects model and run errors in %s mode', (capture) => {
    const message = 'request failed for ana@example.com with private-fixture-key';
    const { sink, recorder } = fixture({ capture, exactSecrets: ['private-fixture-key'] });
    recorder.observe({ type: 'error', message, code: 'RATE_LIMITED' });
    recorder.finish({ outcome: 'failed' });
    const turn = sink.events.find((e) => e.kind === 'model_turn')!;
    const finished = sink.events.find((e) => e.kind === 'run_finished')!;
    const serialized = JSON.stringify(sink.events);
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('private-fixture-key');
    expect(turn.errorCode).toBe('RATE_LIMITED');
    expect(finished.error?.code).toBe('RATE_LIMITED');
    if (capture === 'off') {
      expect(turn.errorContent).toBeNull();
      expect(finished.error).toEqual({ message: 'run_error', code: 'RATE_LIMITED', content: null });
    } else if (capture === 'metadata') {
      expect(turn.errorContent).toEqual({ chars: message.length });
      expect(finished.error).toEqual({ message: 'run_error', code: 'RATE_LIMITED', content: { chars: message.length } });
    } else {
      expect(turn.error).toContain('[REDACTED:');
      expect(turn.errorContent?.chars).toBe(message.length);
      expect(finished.error?.message).toBe(turn.error);
      expect(finished.error?.content).toEqual(turn.errorContent);
    }
  });

  it('drops credential-shaped codes even with capture off, and redacts before truncating errors', () => {
    const { sink, recorder } = fixture({ capture: 'full', exactSecrets: ['private-fixture-key'], maxCapturedChars: 12 });
    recorder.observe({ type: 'error', message: 'private-fixture-key is invalid', code: 'private-fixture-key' });
    recorder.finish({ outcome: 'failed' }, { error: { message: 'private-fixture-key was rejected', code: 'ana@example.com' } });
    const turn = sink.events.find((e) => e.kind === 'model_turn')!;
    expect(turn.error).toBe('[REDACTED:ex');
    expect(turn.errorContent?.truncated).toBe(true);
    expect(turn.errorCode).toBeNull();
    expect(sink.events.at(-1)).toMatchObject({ error: { message: '[REDACTED:ex', code: null } });
    const off = fixture({ capture: 'off', exactSecrets: ['private-fixture-key'] });
    off.recorder.observe({ type: 'error', message: 'private-fixture-key', code: 'private-fixture-key' });
    off.recorder.finish({ outcome: 'failed' });
    expect(JSON.stringify(off.sink.events)).not.toContain('private-fixture-key');
  });

  it('retains safe numeric HTTP error codes separately from suppressed error content', () => {
    const { sink, recorder } = fixture({ capture: 'off' });
    recorder.observe({ type: 'error', message: 'sensitive upstream detail', code: '429' });
    recorder.finish({ outcome: 'failed' });
    expect(sink.events.find((e) => e.kind === 'model_turn')).toMatchObject({ error: 'model_error', errorCode: '429', errorContent: null });
    expect(sink.events.at(-1)).toMatchObject({ error: { message: 'run_error', code: '429', content: null } });
  });
});

describe('request boundaries, usage snapshots, and tool identity (review #5–#7)', () => {
  it('keeps Google final-frame text with its usage, merges snapshots, and prices once', async () => {
    const priceUsage = vi.fn(() => 0.25);
    const { sink, recorder } = fixture({ capture: 'full', priceUsage });
    const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 3, thoughtsTokenCount: 1 };
    const network = transport({ requests: [[
      { usageMetadata },
      { usageMetadata, candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] },
    ]] });
    await runGoogleToolTurn({ apiKey: 'fixture', model: 'gemini', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], onEvent: (event) => recorder.observe(event) }, network);
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.filter((e) => e.kind === 'model_turn')).toMatchObject([
      { output: { text: 'answer' }, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 3, reasoningTokens: 1 }, costUsd: 0.25 },
    ]);
    expect(priceUsage).toHaveBeenCalledTimes(1);
    expect(sink.events.at(-1)).toMatchObject({ totals: { turns: 1, inputTokens: 10, outputTokens: 3, costUsd: 0.25 } });
  });

  it('retains omitted counters and replaces repeated reported costs within one request', () => {
    const priceUsage = vi.fn(() => 100);
    const { sink, recorder } = fixture({ priceUsage });
    recorder.observe({ type: 'status', label: 'requesting' });
    recorder.observe({ type: 'usage', usage: { input_tokens: 9, cache_creation_input_tokens: 2 }, costUsd: 0.1 });
    recorder.observe({ type: 'usage', usage: { output_tokens: 4 }, costUsd: 0.2 });
    recorder.observe({ type: 'usage', usage: { output_tokens: 4 }, costUsd: 0.2 });
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.filter((e) => e.kind === 'model_turn')).toMatchObject([
      { usage: { inputTokens: 9, outputTokens: 4, cacheWriteTokens: 2 }, costUsd: 0.2, costSource: 'provider' },
    ]);
    expect(sink.events.at(-1)).toMatchObject({ totals: { turns: 1, inputTokens: 9, outputTokens: 4, costUsd: 0.2 } });
    expect(priceUsage).not.toHaveBeenCalled();
  });

  it('sums boundary-less CLI step usage (OpenCode step_finish) instead of keeping only the last step', () => {
    const { sink, recorder } = fixture();
    const handler = createJsonEventStreamHandler({ kind: 'opencode', onEvent: (event) => recorder.observe(event as Record<string, unknown>) });
    for (const input of [10, 20]) handler.feed({ chunk: JSON.stringify({ type: 'step_finish', part: { tokens: { input, output: 1 }, cost: 0.1 } }) + '\n' });
    handler.flush();
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.at(-1)).toMatchObject({ totals: { turns: 2, inputTokens: 30, outputTokens: 2 } });
    expect(sink.events.at(-1)).toHaveProperty('totals.costUsd', expect.closeTo(0.2));
  });

  it('records both Google requests that generate call_0 and pairs each result with its own span', async () => {
    const { sink, recorder } = fixture({ capture: 'full' });
    const toolFrame = (value: string) => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { value } } }] } }], usageMetadata: { promptTokenCount: 10 } });
    const network = transport({ requests: [[toolFrame('one')], [toolFrame('two')], [{ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] }]] });
    const executeTool = vi.fn(async ({ input }: { input: unknown }) => ({ content: JSON.stringify(input) }));
    await runGoogleToolTurn({ apiKey: 'fixture', model: 'gemini', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], onEvent: (event) => recorder.observe(event) }, { ...network, executeTool });
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.filter((e) => e.kind === 'tool_call')).toMatchObject([
      { toolCallId: 'r:turn:0:tool:call_0', turnId: 'r:turn:0', name: 'lookup', output: { text: '{"value":"one"}' } },
      { toolCallId: 'r:turn:1:tool:call_0', turnId: 'r:turn:1', name: 'lookup', output: { text: '{"value":"two"}' } },
    ]);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(sink.events.at(-1)).toMatchObject({ totals: { turns: 3, toolCalls: 2 } });
  });

  it('parents Anthropic tool-only follow-ups to the new request', async () => {
    const { sink, recorder } = fixture();
    const toolFrames = (id: string) => [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'lookup' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
    ];
    const network = transport({ requests: [toolFrames('one'), toolFrames('two'), [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }]] });
    await runAnthropicToolTurn({ apiKey: 'fixture', model: 'claude', maxTokens: 64, messages: [{ role: 'user', content: 'hi' }], onEvent: (event) => recorder.observe(event) }, { ...network, executeTool: async () => ({ content: 'ok' }) });
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.filter((e) => e.kind === 'tool_call')).toMatchObject([
      { toolCallId: 'r:turn:0:tool:one', turnId: 'r:turn:0' },
      { toolCallId: 'r:turn:1:tool:two', turnId: 'r:turn:1' },
    ]);
    expect(sink.events.filter((e) => e.kind === 'model_turn')).toHaveLength(3);
  });

  it('keeps unresolved calls when a later request reuses their raw tool id', () => {
    const { sink, recorder } = fixture();
    for (const name of ['first', 'second']) {
      recorder.observe({ type: 'status', label: 'requesting' });
      recorder.observe({ type: 'tool_use', id: 'call_0', name, input: {} });
    }
    recorder.finish({ outcome: 'failed' });
    expect(sink.events.filter((e) => e.kind === 'tool_call')).toMatchObject([
      { toolCallId: 'r:turn:0:tool:call_0', turnId: 'r:turn:0', name: 'first', endedAt: null },
      { toolCallId: 'r:turn:1:tool:call_0', turnId: 'r:turn:1', name: 'second', endedAt: null },
    ]);
  });

  it('keeps OpenAI delayed post-usage tools on the request that emitted them', async () => {
    const { sink, recorder } = fixture();
    const network = transport({ requests: [[
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'lookup', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
    ], [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'two', function: { name: 'lookup', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 3 } },
    ], [{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 1 } }]] });
    await runOpenAiToolTurn({ apiKey: 'fixture', model: 'gpt', messages: [{ role: 'user', content: 'hi' }], onEvent: (event) => recorder.observe(event) }, { ...network, executeTool: async () => ({ content: 'ok' }) });
    recorder.finish({ outcome: 'succeeded' });
    expect(sink.events.filter((e) => e.kind === 'tool_call')).toMatchObject([
      { toolCallId: 'r:turn:0:tool:one', turnId: 'r:turn:0' },
      { toolCallId: 'r:turn:1:tool:two', turnId: 'r:turn:1' },
    ]);
    expect(sink.events.filter((e) => e.kind === 'model_turn').map((e) => e.usage?.inputTokens)).toEqual([10, 20, 30]);
  });
});

describe('failure isolation (review #2, #3, #9)', () => {
  it('contains a pricing failure and a throwing error reporter while still finishing the trace', () => {
    const failure = new Error('pricing');
    const onSinkError = vi.fn(() => { throw new Error('logger'); });
    const { sink, recorder } = fixture({ priceUsage: () => { throw failure; }, onSinkError });
    recorder.observe({ type: 'usage', usage: { input_tokens: 1 } });
    expect(() => recorder.finish({ outcome: 'succeeded' })).not.toThrow();
    expect(onSinkError).toHaveBeenCalledWith(failure);
    expect(sink.events.at(-1)).toMatchObject({ kind: 'run_finished', totals: { turns: 1, inputTokens: 1, costUsd: null } });
  });

  it.each(['sync', 'async'] as const)('isolates %s sink cleanup failures and a broken reporter', async (mode) => {
    const failure = new Error('backend');
    const broken = () => { if (mode === 'sync') throw failure; return Promise.reject(failure); };
    const healthy = { ...createRecordingAiTraceSink(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
    const onSinkError = vi.fn(() => { throw new Error('logger'); });
    const sink = createFanOutAiTraceSink({ sinks: [{ record: () => { throw failure; }, flush: broken, shutdown: broken }, healthy] }, { onSinkError });
    const event: AiTraceEvent = { kind: 'run_finished', traceId: 'r', at: 0, outcome: 'succeeded', error: null, totals: { turns: 0, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null } };
    expect(() => sink.record(event)).not.toThrow();
    await expect(sink.flush!()).resolves.toBeUndefined();
    await expect(sink.shutdown!()).resolves.toBeUndefined();
    expect(healthy.events).toEqual([event]);
    expect(healthy.flush).toHaveBeenCalledTimes(1);
    expect(healthy.shutdown).toHaveBeenCalledTimes(1);
    expect(onSinkError).toHaveBeenCalledTimes(3);
  });

  it('contains queued replay failures individually and continues with later events', async () => {
    let resolve!: (sink: AiTraceSink) => void;
    const onSinkError = vi.fn(() => { throw new Error('logger'); });
    const lazy = createLazyAiTraceSink({ load: () => new Promise((done) => { resolve = done; }) }, { onSinkError });
    const { sink: expected, recorder } = fixture();
    recorder.start({});
    recorder.finish({ outcome: 'succeeded' });
    for (const event of expected.events) lazy.record(event);
    const seen: AiTraceEvent[] = [];
    resolve({ record(event) { if (event.kind === 'run_started') throw new Error('replay'); seen.push(event); } });
    await expect(lazy.ready).resolves.toBeUndefined();
    expect(seen).toEqual([expected.events[1]]);
    expect(onSinkError).toHaveBeenCalledTimes(1);
    lazy.record(expected.events[1]!);
    expect(seen).toEqual([expected.events[1], expected.events[1]]);
  });

  it.each(['throw', 'reject'] as const)('contains initialization %s and throwing load-error callbacks', async (mode) => {
    const failure = new Error('load');
    const onLoadError = vi.fn(() => { throw new Error('logger'); });
    const lazy = createLazyAiTraceSink({ load: () => { if (mode === 'throw') throw failure; return Promise.reject(failure); } }, { onLoadError });
    await expect(lazy.ready).resolves.toBeUndefined();
    await expect(lazy.flush!()).resolves.toBeUndefined();
    await expect(lazy.shutdown!()).resolves.toBeUndefined();
    expect(onLoadError).toHaveBeenCalledWith(failure);
  });
});
