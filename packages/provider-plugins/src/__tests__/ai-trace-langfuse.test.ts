/** The Langfuse provider plugin: event mapping through the real agent-runtime recorder, and the factory (recording client, no network). Moved from `@jini-ai/agent-runtime`. */
import { describe, expect, it } from 'vitest';
import { createAiTraceRecorder, createFanOutAiTraceSink, createRecordingAiTraceSink, noopAiTraceSink, type AiTraceSink } from '@jini-ai/agent-runtime/ai-trace';
import { createLangfuseAiTraceSink, createLangfuseClient, toLangfuseCall, type LangfuseCall, type LangfuseClientPort } from '../ai-trace-langfuse/langfuse.js';
import plugin, { createLangfuseProvider } from '../ai-trace-langfuse/index.js';
import { SCENARIO_EVENTS, steppingClock } from './ai-trace-scenario.js';

function fakeLangfuseClient(): LangfuseClientPort & { calls: LangfuseCall[]; flushed: number } {
  const calls: LangfuseCall[] = [];
  const client = {
    calls,
    flushed: 0,
    trace: (body: Record<string, unknown>) => void calls.push({ method: 'trace', body }),
    generation: (body: Record<string, unknown>) => void calls.push({ method: 'generation', body }),
    span: (body: Record<string, unknown>) => void calls.push({ method: 'span', body }),
    flushAsync: async () => void (client.flushed += 1),
    shutdownAsync: async () => {},
  };
  return client;
}

function runScenario(sink: AiTraceSink, capture: 'off' | 'metadata' | 'full' = 'metadata'): void {
  const recorder = createAiTraceRecorder({ sink, runId: 'run-1', agentId: 'claude' }, { provider: 'anthropic', sessionId: 'chat-9', capture, now: steppingClock() });
  recorder.start({ input: 'Write a post titled Hi' });
  for (const event of SCENARIO_EVENTS) recorder.observe(event);
  recorder.finish({ outcome: 'succeeded' });
}

describe('Langfuse mapping', () => {
  it('maps the same scenario 1:1 onto Langfuse trace/generation/spans with error levels', async () => {
    const recording = createRecordingAiTraceSink();
    const client = fakeLangfuseClient();
    runScenario(createFanOutAiTraceSink({ sinks: [recording, createLangfuseAiTraceSink({ client }), noopAiTraceSink] }));
    expect(client.calls).toEqual(recording.events.map((event) => toLangfuseCall({ event })));
    expect(client.calls.map((c) => c.method)).toEqual(['trace', 'span', 'span', 'generation', 'trace']);
    const [trace, failedSpan, okSpan, generation, final] = client.calls.map((c) => c.body);
    expect(trace).toMatchObject({ id: 'run-1', name: 'agent:claude', sessionId: 'chat-9', tags: ['provider:anthropic'] });
    expect(failedSpan).toMatchObject({ traceId: 'run-1', parentObservationId: generation!.id, name: 'tool:content_post_create', level: 'ERROR', statusMessage: 'input_validation' });
    expect(okSpan).toMatchObject({ level: 'DEFAULT', statusMessage: undefined });
    expect(generation).toMatchObject({ traceId: 'run-1', model: 'claude-sonnet-4-5', usageDetails: { input: 1800, output: 75, cache_read_input_tokens: 500 }, costDetails: { total: 0.0123 }, level: 'DEFAULT' });
    expect(final).toMatchObject({ id: 'run-1', tags: ['outcome:succeeded'], metadata: { toolErrors: 1 } });
    await createFanOutAiTraceSink({ sinks: [createLangfuseAiTraceSink({ client })] }).flush!();
    expect(client.flushed).toBe(1);
  });

});

describe('ai-trace-langfuse factory', () => {
  it('plugin setup only registers the ai_trace factory', () => {
    const registered: unknown[] = [];
    plugin.definition.setup({ providers: { register: (value: unknown) => { registered.push(value); } } } as never);
    expect(registered).toEqual([{ contract: 'ai_trace', id: 'langfuse', contractVersion: 1, factory: createLangfuseProvider }]);
  });

  it('records through an injected client and shuts it down on dispose', async () => {
    const client = fakeLangfuseClient();
    let shutdowns = 0;
    client.shutdownAsync = async () => { shutdowns += 1; };
    const resource = createLangfuseProvider({ publicKey: 'pk', secretKey: 'sk' }, { client });
    const sink: AiTraceSink = resource.port;
    runScenario(sink);
    expect(client.calls.map((c) => c.method)).toEqual(['trace', 'span', 'span', 'generation', 'trace']);
    await resource.dispose({});
    expect(shutdowns).toBe(1);
  });

  it('builds a real SDK client from configuration without any network call', async () => {
    const client = createLangfuseClient({ publicKey: 'pk-lf-test', secretKey: 'sk-lf-test', baseUrl: 'http://langfuse.invalid', environment: 'test', release: '1' });
    expect(typeof client.trace).toBe('function');
    expect(typeof client.flushAsync).toBe('function');
    const resource = createLangfuseProvider({ publicKey: 'pk-lf-test', secretKey: 'sk-lf-test', baseUrl: ' http://langfuse.invalid ' });
    await resource.dispose({});
    await (client.shutdownAsync() as Promise<unknown>);
  });

  it.each([
    [{ secretKey: 'sk' }, 'publicKey must be a non-empty string'],
    [{ publicKey: ' ', secretKey: 'sk' }, 'publicKey must be a non-empty string'],
    [{ publicKey: 'pk' }, 'secretKey must be a non-empty string'],
    [{ publicKey: 'pk', secretKey: 3 }, 'secretKey must be a non-empty string'],
    [{ publicKey: 'pk', secretKey: 'sk', baseUrl: '' }, 'baseUrl must be a non-empty string'],
    [{ publicKey: 'pk', secretKey: 'sk', environment: null }, 'environment must be a non-empty string'],
    [{ publicKey: 'pk', secretKey: 'sk', release: 1 }, 'release must be a non-empty string'],
  ])('refuses %j', (input, message) => {
    expect(() => createLangfuseProvider(input, { client: fakeLangfuseClient() })).toThrow(new TypeError(message));
  });
});

describe('Langfuse mapping edges (pure, no client)', () => {
  const started = { kind: 'run_started', traceId: 't', runId: 'r', at: 0, agentId: 'codex', provider: null, model: null, sessionId: null, input: null, tags: ['x'] } as const;
  const turn = { kind: 'model_turn', traceId: 't', turnId: 'u', index: 0, startedAt: 10, endedAt: 20, model: null, input: null, output: null, reasoning: null,
    usage: null, costUsd: null, costSource: null, ttftMs: null, stopReason: null, error: null } as const;
  const tool = { kind: 'tool_call', traceId: 't', toolCallId: 'c', turnId: 'u', name: 'n', input: null, output: null, isError: false, errorClass: null, startedAt: 1, endedAt: 2 } as const;

  it('run_started without session, input or provider omits them; captured metadata carries truncation and redactions', () => {
    expect(toLangfuseCall({ event: started }).body).toMatchObject({ sessionId: undefined, input: null, tags: ['x'], metadata: { provider: null } });
    const body = toLangfuseCall({ event: { ...started, input: { chars: 9, text: 'redacted…', truncated: true, redactions: { secret: 1 } } } }).body;
    expect(body).toMatchObject({ input: 'redacted…', metadata: { inputChars: 9, inputTruncated: true, inputRedactions: { secret: 1 } } });
    expect(toLangfuseCall({ event: { ...started, input: { chars: 3 } } }).body.metadata).toEqual({ runId: 'r', agentId: 'codex', provider: null, model: null, inputChars: 3 });
  });

  it('model_turn: absent usage/cost/ttft stay undefined; all-null counters are not zeros; an error is ERROR; reasoning text rides metadata', () => {
    expect(toLangfuseCall({ event: turn }).body).toMatchObject({ model: undefined, usageDetails: undefined, costDetails: undefined, completionStartTime: undefined, level: 'DEFAULT', statusMessage: undefined });
    const nullCounters = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
    expect(toLangfuseCall({ event: { ...turn, usage: nullCounters } }).body.usageDetails).toBeUndefined();
    const failed = toLangfuseCall({ event: { ...turn, ttftMs: 5, error: 'overloaded', reasoning: { chars: 4, text: 'hmm.' }, costUsd: 0 } }).body;
    expect(failed).toMatchObject({ completionStartTime: new Date(15).toISOString(), level: 'ERROR', statusMessage: 'overloaded', costDetails: { total: 0 }, metadata: { reasoning: 'hmm.', reasoningChars: 4 } });
    expect(toLangfuseCall({ event: { ...turn, reasoning: { chars: 4 } } }).body.metadata).not.toHaveProperty('reasoning');
  });

  it('tool_call: an error is ERROR with its class; an unfinished tool is a WARNING marked unresolved', () => {
    expect(toLangfuseCall({ event: { ...tool, isError: true, errorClass: 'timeout' } }).body).toMatchObject({ level: 'ERROR', statusMessage: 'timeout' });
    expect(toLangfuseCall({ event: { ...tool, endedAt: null } }).body).toMatchObject({ level: 'WARNING', statusMessage: 'unresolved', endTime: undefined });
  });

  it('run_finished carries the policy-applied error message and code as output', () => {
    const finished = { kind: 'run_finished', traceId: 't', at: 0, outcome: 'failed', error: { message: '[redacted]', code: 'E_RUN' }, totals: { turns: 1, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null } } as const;
    expect(toLangfuseCall({ event: finished }).body).toMatchObject({ output: { error: '[redacted]', code: 'E_RUN' }, tags: ['outcome:failed'] });
  });

  it('the sink forwards flush and shutdown to the client', async () => {
    const client = fakeLangfuseClient();
    let shutdowns = 0;
    client.shutdownAsync = async () => { shutdowns += 1; };
    const sink = createLangfuseAiTraceSink({ client });
    await sink.flush!();
    await sink.shutdown!();
    expect([client.flushed, shutdowns]).toEqual([1, 1]);
  });

  it('createLangfuseClient omits unset optional settings', async () => {
    const client = createLangfuseClient({ publicKey: 'pk', secretKey: 'sk' });
    expect(typeof client.span).toBe('function');
    await client.shutdownAsync();
  });
});
