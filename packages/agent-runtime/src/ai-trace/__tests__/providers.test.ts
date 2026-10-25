/**
 * Per-provider mapping proof: each fixture drives the provider's REAL normalizer (or, for the
 * HTTP tool-turn path, the real `runProviderToolTurn` projection with the real OpenAI SSE frame
 * parser) and feeds what it emits into the recorder. Assertions pin what each provider can and
 * cannot supply — a `null` here is the provider's gap, recorded honestly, not a test shortcut.
 */
import { describe, expect, it, vi } from 'vitest';
import { createAiTraceRecorder, createRecordingAiTraceSink, type AiTraceEvent } from '../index.js';
import { createClaudeStreamHandler } from '../../claude-stream.js';
import { createCopilotStreamHandler } from '../../copilot-stream.js';
import { createQoderStreamHandler } from '../../qoder-stream.js';
import { createJsonEventStreamHandler } from '../../json-event-stream.js';
import { createAcpSessionState, handleSessionUpdate, type AcpSessionEffects } from '../../agent-protocol/acp/session.js';
import { createToolCallTextSuppressor } from '../../agent-protocol/acp/text-suppression.js';
import { noopAccountFailureClassifier } from '../../agent-protocol/acp/account-failure.js';
import { formatUsage } from '../../agent-protocol/acp/rpc.js';
import { runProviderToolTurn, providerTurnAdapters } from '../../providers/tool-turn.js';
import { processOpenAiStreamFrame, resolveOpenAiToolCalls, executeOpenAiToolCalls, type OpenAiStreamState } from '../../providers/openai-chat.js';
import { createRoleMarkerGuard } from '../../role-marker-guard.js';
import { steppingClock } from './scenario.js';

type Turn = AiTraceEvent & { kind: 'model_turn' };
type Tool = AiTraceEvent & { kind: 'tool_call' };
type Finished = AiTraceEvent & { kind: 'run_finished' };

function traceOf(feed: (observe: (event: Record<string, unknown>) => void) => void | Promise<void>, provider: string) {
  const sink = createRecordingAiTraceSink();
  const recorder = createAiTraceRecorder({ sink, runId: provider, agentId: provider }, { provider, now: steppingClock() });
  recorder.start({ input: 'prompt' });
  const done = feed((event) => recorder.observe(event));
  const finish = () => {
    recorder.finish({ outcome: 'succeeded' });
    return {
      turns: sink.events.filter((e): e is Turn => e.kind === 'model_turn'),
      tools: sink.events.filter((e): e is Tool => e.kind === 'tool_call'),
      finished: sink.events.at(-1) as Finished,
    };
  };
  return done instanceof Promise ? done.then(finish) : finish();
}

function jsonl(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

describe('Claude Code (claude-stream-json)', () => {
  it('model, run-level usage + provider cost, both tool calls with the input-validation failure', () => {
    const trace = traceOf((observe) => {
      const handler = createClaudeStreamHandler({ onEvent: observe }, { costBasis: 'run' });
      handler.feed({ chunk: jsonl([
        { type: 'system', subtype: 'init', model: 'claude-sonnet-4-5', session_id: 's1' },
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Creating the post.' }, { type: 'tool_use', id: 't1', name: 'mcp__jini__content_post_create', input: { title: 'Hi', body: 'x' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: "Unknown input 'body'", is_error: true }] } },
        { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'mcp__jini__content_post_create', input: { title: 'Hi', content: 'x' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'created post 42', is_error: false }] } },
        { type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'Done.' }] } },
        { type: 'result', subtype: 'success', is_error: false, duration_ms: 4000, total_cost_usd: 0.0123, stop_reason: 'end_turn', usage: { input_tokens: 1800, output_tokens: 75, cache_read_input_tokens: 500 } },
      ]) });
      handler.flush();
    }, 'claude') as Awaited<ReturnType<typeof traceOf>>;
    expect(trace.turns).toHaveLength(1);
    expect(trace.turns[0]).toMatchObject({ model: 'claude-sonnet-4-5', costUsd: 0.0123, costSource: 'provider', stopReason: 'end_turn', usage: { inputTokens: 1800, outputTokens: 75, cacheReadTokens: 500 } });
    expect(trace.tools.map((t) => [t.name, t.isError, t.errorClass])).toEqual([['mcp__jini__content_post_create', true, 'input_validation'], ['mcp__jini__content_post_create', false, null]]);
  });
});

describe('GitHub Copilot CLI (copilot-stream-json)', () => {
  it('tools and denial class; no token counters and no cost (CLI reports duration only)', () => {
    const trace = traceOf((observe) => {
      const handler = createCopilotStreamHandler({ onEvent: observe });
      handler.feed({ chunk: jsonl([
        { type: 'session.tools_updated', data: { model: 'gpt-5.2' } },
        { type: 'assistant.message_delta', data: { deltaContent: 'Looking into it.' } },
        { type: 'tool.execution_start', data: { toolCallId: 'call_1', toolName: 'bash', arguments: { command: 'ls' } } },
        { type: 'tool.execution_complete', data: { toolCallId: 'call_1', result: 'index.html', success: true } },
        { type: 'tool.execution_start', data: { toolCallId: 'call_2', toolName: 'bash', arguments: { command: 'rm -rf /' } } },
        { type: 'tool.execution_complete', data: { toolCallId: 'call_2', result: 'permission denied', success: false } },
        { type: 'result', usage: { sessionDurationMs: 900 }, success: true },
      ]) });
      handler.flush();
    }, 'copilot') as Awaited<ReturnType<typeof traceOf>>;
    expect(trace.turns[0]).toMatchObject({ model: 'gpt-5.2', usage: null, costUsd: null, stopReason: 'completed' });
    expect(trace.tools.map((t) => [t.name, t.isError, t.errorClass])).toEqual([['bash', false, null], ['bash', true, 'denied']]);
  });
});

describe('Qoder CLI (qoder-stream-json)', () => {
  it('model, usage and provider cost; the stream carries no tool events at all', () => {
    const trace = traceOf((observe) => {
      const handler = createQoderStreamHandler({ onEvent: observe });
      handler.feed({ chunk: jsonl([
        { type: 'system', subtype: 'init', model: 'qwen3-coder', session_id: 'q1' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
        { type: 'result', subtype: 'success', is_error: false, duration_ms: 900, total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 2 } },
      ]) });
      handler.flush();
    }, 'qoder') as Awaited<ReturnType<typeof traceOf>>;
    expect(trace.turns[0]).toMatchObject({ model: 'qwen3-coder', costUsd: 0.001, usage: { inputTokens: 10, outputTokens: 2 } });
    expect(trace.tools).toEqual([]);
  });
});

describe('Codex CLI (json-event-stream kind=codex)', () => {
  it('model receipt, usage with cache, a failed command and an approval-denied MCP call; no cost', () => {
    const trace = traceOf((observe) => {
      const handler = createJsonEventStreamHandler({ kind: 'codex', onEvent: observe });
      handler.feed({ chunk: jsonl([
        { type: 'thread.started', thread_id: 'th', model: 'gpt-5-codex' },
        { type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command: 'post --body x' } },
        { type: 'item.completed', item: { id: 'cmd_1', type: 'command_execution', command: 'post --body x', aggregated_output: "error: Unknown input 'body'\n", exit_code: 2 } },
        { type: 'item.completed', item: { id: 'item_0', type: 'mcp_tool_call', server: 'jini', tool: 'content_post_create', arguments: { title: 'Hi' }, result: null, error: { message: 'MCP tool call requires approval, but approval policy is never' }, status: 'failed' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Could not post.' } },
        { type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 30, cached_input_tokens: 50 } },
      ]) });
      handler.flush();
    }, 'codex') as Awaited<ReturnType<typeof traceOf>>;
    expect(trace.turns[0]).toMatchObject({ model: 'gpt-5-codex', costUsd: null, usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 50 } });
    expect(trace.tools.map((t) => [t.toolCallId, t.isError, t.errorClass])).toEqual([['cmd_1', true, 'input_validation'], ['item_0', true, 'denied']]);
  });
});

describe('ACP agents (Gemini CLI / Codex / others over ACP) — real session-update handlers', () => {
  it('model + usage; only artifact-write tool calls surface, and without result text', () => {
    const trace = traceOf((observe) => {
      const effects = {
        send: ({ payload }: { payload: Record<string, unknown> }) => observe(payload),
        fail: vi.fn(), failWithPayload: vi.fn(), writeRpc: vi.fn(), sendPrompt: vi.fn(), recoverFromModelSelectionError: vi.fn(),
        // Mirrors session.ts finishCleanPrompt: formatUsage(result.usage) → { type: 'usage', usage, durationMs }.
        finishCleanPrompt: (usage: unknown) => observe({ type: 'usage', usage: formatUsage(usage), durationMs: 10 }),
        emitVisibleTextDelta: (delta: string) => observe({ type: 'text_delta', delta }),
        noteArtifactTextSuppression: vi.fn(), noteToolCallTextSuppression: vi.fn(), emitAcpRawShapeDiagnostic: vi.fn(),
        toolCallTextSuppressor: createToolCallTextSuppressor(), runStartedAt: Date.now(), modelUnavailableErrorCode: undefined,
        accountFailureClassifier: noopAccountFailureClassifier, model: undefined, onSessionInit: undefined, resumeSessionId: undefined,
        effectiveCwd: '/tmp/project', mcpServers: undefined, envFormat: 'array',
      } as unknown as AcpSessionEffects;
      const state = createAcpSessionState();
      const update = (u: Record<string, unknown>) => handleSessionUpdate({ state, effects, update: u });
      update({ sessionUpdate: 'current_model_update', currentModelId: 'gemini-2.5-pro' });
      update({ sessionUpdate: 'tool_call', toolCallId: 'shell-1', title: 'Run shell', kind: 'execute', status: 'pending' });
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'shell-1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: "Unknown input 'body'" } }] });
      update({ sessionUpdate: 'tool_call', toolCallId: 'w-1', title: 'Write index.html', kind: 'edit', status: 'pending', locations: [{ path: '/tmp/project/index.html' }], rawInput: { file_path: '/tmp/project/index.html', content: '<html></html>' } });
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'w-1', status: 'completed' });
      effects.finishCleanPrompt({ inputTokens: 300, outputTokens: 20, thoughtTokens: 7 });
    }, 'gemini-acp') as Awaited<ReturnType<typeof traceOf>>;
    expect(trace.turns[0]).toMatchObject({ model: 'gemini-2.5-pro', costUsd: null, usage: { inputTokens: 300, outputTokens: 20, reasoningTokens: 7 } });
    // GAP (measured): the failed shell call never reaches the normalized stream — ACP mirrors only artifact writes.
    expect(trace.tools.map((t) => t.toolCallId)).not.toContain('shell-1');
    for (const tool of trace.tools) expect(tool.output).toBeNull();
  });
});

describe('OpenAI HTTP (runProviderToolTurn protocol=openai, real SSE frame parser)', () => {
  it('one turn per model call with usage; executor failure folds to an isError tool result', async () => {
    const sse = (data: unknown) => ({ data: JSON.stringify(data) }) as Parameters<typeof processOpenAiStreamFrame>[0]['frame'];
    const round1 = [
      sse({ choices: [{ index: 0, delta: { content: 'Posting.' } }] }),
      sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'content_post_create', arguments: '{"title":"Hi","body":"x"}' } }] } }] }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 18, prompt_tokens_details: { cached_tokens: 0 } } }),
    ];
    const round2 = [
      sse({ choices: [{ index: 0, delta: { content: 'Done.' } }] }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 160, completion_tokens: 4 } }),
    ];
    const trace = await traceOf(async (observe) => {
      const openai: typeof providerTurnAdapters.openai = (async ({ onEvent }: { onEvent: (event: never) => void }, { executeTool }: { executeTool?: (call: { id: string; name: string; input: unknown }) => Promise<{ content: string }> } = {}) => {
        const emit = onEvent as (event: Record<string, unknown>) => void;
        for (const frames of [round1, round2]) {
          const state: OpenAiStreamState = { guard: createRoleMarkerGuard({ messageId: 'm' }), toolCalls: new Map(), fullText: '', finishReason: null, usage: null };
          for (const frame of frames) processOpenAiStreamFrame({ state, frame, onEvent: emit as never });
          const calls = resolveOpenAiToolCalls({ pending: state.toolCalls });
          for (const call of calls) emit({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
          if (calls.length && executeTool) await executeOpenAiToolCalls({ executeTool: executeTool as never, calls, onEvent: emit as never });
        }
        emit({ type: 'end', reason: 'stop' });
        return { finishReason: 'stop', toolTurns: 1 };
      }) as never;
      await runProviderToolTurn({
        protocol: 'openai', adapters: { ...providerTurnAdapters, openai }, apiKey: 'fixture', model: 'gpt-4.1', system: '', messages: [{ role: 'user', content: 'post' }],
        tools: [{ id: 'content_post_create', inputSchema: { type: 'object' } }],
        executeTool: async () => ({ content: "Unknown input 'body'", isError: true }),
        onEvent: (event) => observe(event as unknown as Record<string, unknown>),
      });
    }, 'openai');
    expect(trace.turns).toHaveLength(2);
    expect(trace.turns.map((t) => t.usage?.inputTokens)).toEqual([120, 160]);
    expect(trace.turns.every((t) => t.costUsd === null && t.model === null)).toBe(true);
    expect(trace.tools).toHaveLength(1);
    expect(trace.tools[0]).toMatchObject({ isError: true, errorClass: 'input_validation', turnId: trace.turns[0]!.turnId });
  });
});
