/**
 * @module ai-trace-langfuse/langfuse
 *
 * Langfuse backend for `@jini-ai/agent-runtime/ai-trace`'s sink port, shipped as the
 * `ai-trace-langfuse` provider plugin (moved out of the former `@jini-ai/agent-runtime/ai-trace/langfuse`
 * subpath 2026-10-25, Langfuse review #10). Maps run → Langfuse trace, model turn → generation,
 * tool call → span (child of the generation that requested it), failures → `level: 'ERROR'` with
 * the error class as `statusMessage`.
 *
 * Why the `langfuse` JS SDK client shape rather than Langfuse's OTel endpoint: the SDK client is
 * four methods (`trace`/`generation`/`span`/`flushAsync`) with Langfuse's own batching, retry and
 * upsert-by-id semantics, so this adapter is a pure mapping plus client construction. The OTel route
 * needs an OTel SDK, exporter and the GenAI attribute mapping — that belongs to the
 * `observability-opentelemetry` provider plugin and would add a second, generic OTel adapter, not
 * replace this one.
 *
 * The SDK is bundled into this plugin only. The former lazy `import('langfuse')` is gone: the host
 * imports the plugin at all only when Langfuse is installed, enabled and configured, so a host with
 * tracing off pays nothing and the runtime core needs no Langfuse dependency.
 */
import { Langfuse } from 'langfuse';
import type { AiCapturedText, AiTraceEvent, AiTraceSink } from '@jini-ai/agent-runtime/ai-trace';

type Body = Record<string, unknown>;

/** The subset of the `langfuse` SDK client this adapter calls. Tests pass a recording fake. */
export interface LangfuseClientPort {
  trace(body: Body): unknown;
  generation(body: Body): unknown;
  span(body: Body): unknown;
  flushAsync(): Promise<unknown>;
  shutdownAsync(): Promise<unknown>;
}

export interface LangfuseCall {
  readonly method: 'trace' | 'generation' | 'span';
  readonly body: Body;
}

/** Langfuse shows `input`/`output` verbatim; metadata-only capture sends `null` plus the char count in metadata. */
function content(captured: AiCapturedText | null): string | null {
  return captured?.text ?? null;
}

function contentMeta(name: string, captured: AiCapturedText | null): Body {
  if (!captured) return {};
  return { [`${name}Chars`]: captured.chars, ...(captured.truncated ? { [`${name}Truncated`]: true } : {}), ...(captured.redactions ? { [`${name}Redactions`]: captured.redactions } : {}) };
}

function iso(at: number | null): string | undefined {
  return at === null ? undefined : new Date(at).toISOString();
}

/** Drops `null` counters: Langfuse treats a present `0` as a real zero, and "not reported" is not zero. */
function usageDetails(usage: Extract<AiTraceEvent, { kind: 'model_turn' }>['usage']): Body | undefined {
  if (!usage) return undefined;
  const pairs: Array<[string, number | null]> = [['input', usage.inputTokens], ['output', usage.outputTokens], ['cache_read_input_tokens', usage.cacheReadTokens], ['cache_creation_input_tokens', usage.cacheWriteTokens], ['reasoning_tokens', usage.reasoningTokens]];
  const kept = pairs.filter((pair): pair is [string, number] => pair[1] !== null);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** A tool still running when the run ended is a WARNING: not a failure, but not a success either. */
function toolLevel(e: Extract<AiTraceEvent, { kind: 'tool_call' }>): 'ERROR' | 'WARNING' | 'DEFAULT' {
  if (e.isError) return 'ERROR';
  return e.endedAt === null ? 'WARNING' : 'DEFAULT';
}

const MAPPERS: { [K in AiTraceEvent['kind']]: (event: Extract<AiTraceEvent, { kind: K }>) => LangfuseCall } = {
  run_started: (e) => ({ method: 'trace', body: { id: e.traceId, name: `agent:${e.agentId}`, sessionId: e.sessionId ?? undefined, input: content(e.input), timestamp: iso(e.at), tags: [...e.tags, ...(e.provider ? [`provider:${e.provider}`] : [])], metadata: { runId: e.runId, agentId: e.agentId, provider: e.provider, model: e.model, ...contentMeta('input', e.input) } } }),
  model_turn: (e) => ({
    method: 'generation',
    body: { id: e.turnId, traceId: e.traceId, name: `turn-${e.index}`, model: e.model ?? undefined, input: content(e.input), output: content(e.output), startTime: iso(e.startedAt), endTime: iso(e.endedAt), completionStartTime: iso(e.ttftMs === null ? null : e.startedAt + e.ttftMs), usageDetails: usageDetails(e.usage), costDetails: e.costUsd === null ? undefined : { total: e.costUsd }, level: e.error ? 'ERROR' : 'DEFAULT', statusMessage: e.error ?? undefined, metadata: { stopReason: e.stopReason, costSource: e.costSource, ...contentMeta('input', e.input), ...contentMeta('output', e.output), ...contentMeta('reasoning', e.reasoning), ...(e.reasoning?.text ? { reasoning: e.reasoning.text } : {}) } },
  }),
  tool_call: (e) => ({ method: 'span', body: { id: `${e.traceId}:tool:${e.toolCallId}`, traceId: e.traceId, parentObservationId: e.turnId, name: `tool:${e.name}`, input: content(e.input), output: content(e.output), startTime: iso(e.startedAt), endTime: iso(e.endedAt), level: toolLevel(e), statusMessage: e.errorClass ?? (e.endedAt === null ? 'unresolved' : undefined), metadata: { toolName: e.name, toolCallId: e.toolCallId, isError: e.isError, errorClass: e.errorClass, ...contentMeta('input', e.input), ...contentMeta('output', e.output) } } }),
  run_finished: (e) => ({ method: 'trace', body: { id: e.traceId, output: e.error ? { error: e.error.message, code: e.error.code } : null, tags: [`outcome:${e.outcome}`], metadata: { outcome: e.outcome, ...e.totals } } }),
};

/** Pure mapping, exported so the mapping can be asserted without any client. */
export function toLangfuseCall({ event }: { event: AiTraceEvent }): LangfuseCall {
  return (MAPPERS[event.kind] as (e: AiTraceEvent) => LangfuseCall)(event);
}

export function createLangfuseAiTraceSink({ client }: { client: LangfuseClientPort }): AiTraceSink {
  return {
    record(event) {
      const call = toLangfuseCall({ event });
      client[call.method](call.body);
    },
    flush: async () => {
      await client.flushAsync();
    },
    shutdown: async () => {
      await client.shutdownAsync();
    },
  };
}

export interface LangfuseSinkConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl?: string;
  readonly environment?: string;
  readonly release?: string;
}

/** Builds the SDK client (no network until the first flush) and its sink. */
export function createLangfuseClient({ publicKey, secretKey, baseUrl, environment, release }: LangfuseSinkConfig): LangfuseClientPort {
  return new Langfuse({ publicKey, secretKey, ...(baseUrl ? { baseUrl } : {}), ...(environment ? { environment } : {}), ...(release ? { release } : {}) });
}
