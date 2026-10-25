import { describe, expect, it } from 'vitest';
import { createRecordingAiTraceSink } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { withAiTracing } from '../ai-trace-lifecycle.js';

function tracedLifecycle(capture: 'metadata' | 'full' = 'metadata') {
  const sink = createRecordingAiTraceSink();
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}, { terminalRetentionMs: null, maxRuns: null }) }, { slowRunThresholdMs: null });
  return { sink, traced: withAiTracing({ lifecycle, sink }, { capture, providerOf: (agentId) => (agentId === 'claude' ? 'anthropic' : agentId) }) };
}

describe('withAiTracing(RunLifecycle)', () => {
  it('records start → agent events → finish as one trace, and the run itself is unchanged', async () => {
    const { sink, traced } = tracedLifecycle('full');
    const { run } = await traced.start({ contextRef: 'chat-7' }, { agentId: 'claude' });
    traced.noteRunInput({ runId: run.id, input: 'Write a post titled Hi' });
    const emit = (data: Record<string, unknown>) => traced.emit({ runId: run.id, input: { event: 'agent', data: data as never } });
    await emit({ type: 'status', label: 'starting_model', model: 'claude-sonnet-4-5' });
    await emit({ type: 'tool_use', id: 't1', name: 'content_post_create', input: { body: 'x' } });
    await emit({ type: 'tool_result', toolUseId: 't1', content: "Unknown input 'body'", isError: true });
    await emit({ type: 'usage', usage: { input_tokens: 10, output_tokens: 2 }, costUsd: 0.001 });
    await traced.emit({ runId: run.id, input: { event: 'stdout', data: { chunk: 'ignored' } } });
    const status = await traced.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(status.state).toBe('succeeded');
    expect(sink.events.map((e) => e.kind)).toEqual(['run_started', 'tool_call', 'model_turn', 'run_finished']);
    expect(sink.events[0]).toMatchObject({ runId: run.id, agentId: 'claude', provider: 'anthropic', sessionId: 'chat-7' });
    expect(sink.events[1]).toMatchObject({ errorClass: 'input_validation' });
    expect(sink.events[2]).toMatchObject({ model: 'claude-sonnet-4-5', input: { text: 'Write a post titled Hi' }, costUsd: 0.001 });
    expect(sink.events[3]).toMatchObject({ outcome: 'succeeded', totals: { toolErrors: 1 } });
  });

  it('a driver error event marks the failed outcome', async () => {
    const { sink, traced } = tracedLifecycle();
    const { run } = await traced.start({ contextRef: 'c' }, { agentId: 'codex' });
    await traced.emit({ runId: run.id, input: { event: 'error', data: { message: 'codex exited 1' } } });
    await traced.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });
    expect(sink.events.at(-1)).toMatchObject({ outcome: 'failed', error: { message: 'codex exited 1' } });
  });

  it('an idempotent replay start does not open a second trace', async () => {
    const { sink, traced } = tracedLifecycle();
    await traced.start({ contextRef: 'c' }, { agentId: 'a', idempotencyKey: 'k' });
    await traced.start({ contextRef: 'c' }, { agentId: 'a', idempotencyKey: 'k' });
    expect(sink.events.filter((e) => e.kind === 'run_started')).toHaveLength(1);
  });
});
