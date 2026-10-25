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
