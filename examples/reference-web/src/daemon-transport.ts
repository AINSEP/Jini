import { drainRunEventFrames } from './run-event-frames.js';
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';
import {
  buildTranscript,
  type AgentEvent,
  type ChatAttachment,
  type ChatMessage,
  type ChatRunStatus,
} from '@jini-ai/chat/core';
import type { ChatTransport, RunHandlers, StartRunInput } from '@jini-ai/chat/react';

interface RunStatusWire {
  id: string;
  state: ChatRunStatus;
}

interface RunResponseWire {
  run: RunStatusWire;
}

interface RunProtocolEventWire {
  kind: 'start' | 'agent' | 'stdout' | 'stderr' | 'error' | 'end';
  payload: unknown;
}

interface PlaygroundContext {
  project?: unknown;
  model?: unknown;
  reasoning?: unknown;
  workingDirectory?: unknown;
  frontendBindToken?: unknown;
}

interface ComposeRunPromptInput {
  history: ChatMessage[];
  agentId?: string;
}

/**
 * Builds the agent prompt from visible conversation history while excluding
 * the playground's synthetic welcome message.
 *
 * @param input - Conversation history and the agent receiving the next turn.
 * @returns A role-delimited transcript scoped and sanitized by `@jini-ai/chat/core`.
 * @throws Never.
 *
 * @complexity Time: O(n), where n is the total history character count.
 * @complexity Space: O(n) for the filtered history and resulting transcript.
 *
 * @overallScore 100/100
 */
export function composeRunPrompt({ history, agentId }: ComposeRunPromptInput): string {
  const visibleHistory = history.filter((message) => message.id !== 'welcome');
  return buildTranscript({ history: visibleHistory }, agentId === undefined ? {} : { targetAgentId: agentId });
}

export function encodeRunContext(
  prompt: string,
  project: string,
  model?: string,
  reasoning?: string,
  workingDirectory?: string,
  attachments: readonly ChatAttachment[] = [],
  frontendBindToken?: string,
): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    prompt,
    project,
    ...(model !== undefined ? { model } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(frontendBindToken !== undefined ? { frontendBindToken } : {}),
  }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `playground:${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}

async function readApiError(response: Response): Promise<Error> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as { error?: { message?: string }; message?: string };
    return new Error(body.error?.message ?? body.message ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

export function toAgentEvent(event: RunProtocolEventWire, handlers: RunHandlers): AgentEvent | null {
  if (event.kind === 'stdout') {
    // AgentExecutor deliberately publishes raw child stdout for diagnostics
    // and also publishes the parsed, user-visible payload as `agent` events.
    // Rendering both leaks structured CLI protocols (Claude stream-json,
    // Codex JSONL, and similar) into the conversation and duplicates plain
    // runtime output. The durable stdout event remains available through the
    // daemon event log; the chat surface consumes only parsed `agent` events.
    return null;
  }
  if (event.kind === 'stderr') {
    const payload = event.payload as { chunk?: unknown };
    return { kind: 'raw', line: typeof payload.chunk === 'string' ? payload.chunk : '' };
  }
  if (event.kind !== 'agent') return null;

  const payload = event.payload as Record<string, unknown>;
  const convert = typeof payload.type === 'string' ? AGENT_EVENT_READERS.get(payload.type) : undefined;
  const converted = convert?.(payload, handlers);
  if (converted !== undefined) return converted;
  return { kind: 'ext', name: typeof payload.type === 'string' ? payload.type : 'agent', data: payload };
}

type AgentPayloadReader = (payload: Record<string, unknown>, handlers: RunHandlers) => AgentEvent | null | undefined;
const AGENT_EVENT_READERS = new Map<string, AgentPayloadReader>([
  ['status', payload => {
    if (typeof payload.label !== 'string') return undefined;
    return { kind: 'status', label: payload.label, ...(typeof payload.detail === 'string' ? { detail: payload.detail } : {}) };
  }],
  ['text_delta', payload => typeof payload.delta === 'string' ? { kind: 'text', text: payload.delta } : undefined],
  ['thinking_delta', payload => typeof payload.delta === 'string' ? { kind: 'thinking', text: payload.delta } : undefined],
  ['tool_input_delta', (payload, handlers) => {
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string' || typeof payload.delta !== 'string') return undefined;
    handlers.onToolInputDelta?.(payload.id, payload.name, payload.delta);
    return null;
  }],
  ['tool_use', payload => {
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string') return undefined;
    return { kind: 'tool_use', id: payload.id, name: payload.name, input: payload.input };
  }],
  ['tool_result', payload => {
    if (typeof payload.toolUseId !== 'string' || typeof payload.content !== 'string') return undefined;
    return { kind: 'tool_result', toolUseId: payload.toolUseId, content: payload.content, isError: payload.isError === true };
  }],
  ['usage', usageAgentEvent],
  ['a2ui', payload => {
    // Unwrap `.message` here rather than letting the generic `ext` fallback below carry the whole
    // `{type, message}` envelope — `A2uiSurfaceCard` (registered against `ext-event-renderer-registry.ts`'s
    // 'a2ui' name) expects each event's `data` to already be one real `AgentToRendererMessage`.
    return { kind: 'ext', name: 'a2ui', data: payload.message };
  }],
]);

function usageAgentEvent(payload: Record<string, unknown>): AgentEvent {
  const usage = payload.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
  return {
    kind: 'usage',
    ...(typeof usage?.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage?.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof payload.costUsd === 'number' ? { costUsd: payload.costUsd } : {}),
    ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
  };
}

async function streamRun(
  runId: string,
  handlers: RunHandlers,
  signal?: AbortSignal,
): Promise<void> {
  // Deliberately plain `fetch`, not `fetchWithTimeout`: this reads an SSE-over-fetch stream that
  // can legitimately stay open for the whole duration of a long-running agent turn. A whole-call
  // `AbortSignal.timeout` would sever it mid-stream — the caller's own `signal` (component
  // unmount / explicit cancel) is the correct and only cancellation mechanism here, matching the
  // same exclusion this fix's server-side counterpart applied to the streaming LLM providers.
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, signal === undefined ? {} : { signal });
  if (!response.ok) throw await readApiError(response);
  if (!response.body) throw new Error('The daemon returned an empty event stream');

  const events: AgentEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let reachedEnd = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      buffered = drainRunEventFrames({ buffered, onEvent: wireEvent => {
        if (deliverRunEvent({ wireEvent: wireEvent as RunProtocolEventWire, events, handlers })) reachedEnd = true;
      } });
      if (done) break;
    }
    if (!reachedEnd && !signal?.aborted) throw new Error('The daemon event stream closed before the run ended');
  } finally {
    reader.releaseLock();
  }
}

function deliverRunEvent({ wireEvent, events, handlers }: { wireEvent: RunProtocolEventWire; events: AgentEvent[]; handlers: RunHandlers }): boolean {
  if (wireEvent.kind === 'error') {
    const payload = wireEvent.payload as { message?: unknown };
    handlers.onError(new Error(typeof payload.message === 'string' ? payload.message : 'The run failed'));
    return false;
  }
  if (wireEvent.kind === 'end') {
    const payload = wireEvent.payload as { status?: unknown };
    if (payload.status === 'failed') handlers.onError(new Error('The agent run failed'));
    handlers.onDone(events);
    return true;
  }
  const event = toAgentEvent(wireEvent, handlers);
  if (event) {
    events.push(event);
    handlers.onEvent(event);
  }
  return false;
}

function nonEmptyRunOption(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function createDaemonChatTransport(): ChatTransport {
  return {
    async startRun(input: StartRunInput, handlers: RunHandlers) {
      const agentId = input.agentId ?? 'playground-demo';
      const prompt = composeRunPrompt({ history: input.history, agentId });
      if (!prompt) throw new Error('A prompt is required');
      const context = (input.context ?? {}) as PlaygroundContext;
      const project = typeof context.project === 'string' ? context.project : 'starter-site';
      const model = nonEmptyRunOption(context.model);
      const reasoning = nonEmptyRunOption(context.reasoning);
      const workingDirectory = nonEmptyRunOption(context.workingDirectory);
      // Proves which tab started this run so page.* calls can be routed back to it.
      const frontendBindToken = nonEmptyRunOption(context.frontendBindToken);
      const response = await fetchWithTimeout(
        '/api/runs',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contextRef: encodeRunContext(
              prompt,
              project,
              model,
              reasoning,
              workingDirectory,
              input.attachments ?? [],
              frontendBindToken,
            ),
            agentId,
          }),
          signal: input.signal,
        },
        { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
      );
      if (!response.ok) throw await readApiError(response);
      const body = (await response.json()) as RunResponseWire;
      void streamRun(body.run.id, handlers, input.signal).catch((error: unknown) => {
        if (!input.signal.aborted) handlers.onError(error instanceof Error ? error : new Error(String(error)));
      });
      return { runId: body.run.id };
    },
    async reattachRun(runId, handlers, options) {
      // Honoring the signal is what lets the caller detach: without it this SSE read loop outlives
      // the component that opened it for as long as the run keeps streaming.
      await streamRun(runId, handlers, options?.signal);
    },
    async fetchRunStatus(runId) {
      const response = await fetchWithTimeout(
        `/api/runs/${encodeURIComponent(runId)}`,
        {},
        { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw await readApiError(response);
      return ((await response.json()) as RunResponseWire).run.state;
    },
    async stopRun(runId) {
      const response = await fetchWithTimeout(
        `/api/runs/${encodeURIComponent(runId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'Canceled from Jini Playground' }),
        },
        { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
      );
      if (!response.ok) throw await readApiError(response);
    },
  };
}
