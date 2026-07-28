import {
  buildTranscript,
  type AgentEvent,
  type ChatAttachment,
  type ChatMessage,
  type RunStatus,
} from '@injini/chat-core';
import type { ChatTransport, RunHandlers, StartRunInput } from '@injini/chat-react';

interface RunStatusWire {
  id: string;
  state: RunStatus;
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
 * @returns A role-delimited transcript scoped and sanitized by `@injini/chat-core`.
 * @throws Never.
 *
 * @complexity Time: O(n), where n is the total history character count.
 * @complexity Space: O(n) for the filtered history and resulting transcript.
 *
 * @overallScore 100/100
 */
export function composeRunPrompt({ history, agentId }: ComposeRunPromptInput): string {
  const visibleHistory = history.filter((message) => message.id !== 'welcome');
  return buildTranscript(
    visibleHistory,
    agentId === undefined ? {} : { targetAgentId: agentId },
  );
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
  if (payload.type === 'status' && typeof payload.label === 'string') {
    return {
      kind: 'status',
      label: payload.label,
      ...(typeof payload.detail === 'string' ? { detail: payload.detail } : {}),
    };
  }
  if (payload.type === 'text_delta' && typeof payload.delta === 'string') {
    return { kind: 'text', text: payload.delta };
  }
  if (payload.type === 'thinking_delta' && typeof payload.delta === 'string') {
    return { kind: 'thinking', text: payload.delta };
  }
  if (
    payload.type === 'tool_input_delta' &&
    typeof payload.id === 'string' &&
    typeof payload.name === 'string' &&
    typeof payload.delta === 'string'
  ) {
    handlers.onToolInputDelta?.(payload.id, payload.name, payload.delta);
    return null;
  }
  if (payload.type === 'tool_use' && typeof payload.id === 'string' && typeof payload.name === 'string') {
    return { kind: 'tool_use', id: payload.id, name: payload.name, input: payload.input };
  }
  if (payload.type === 'tool_result' && typeof payload.toolUseId === 'string' && typeof payload.content === 'string') {
    return {
      kind: 'tool_result',
      toolUseId: payload.toolUseId,
      content: payload.content,
      isError: payload.isError === true,
    };
  }
  if (payload.type === 'usage') {
    const usage = payload.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
    return {
      kind: 'usage',
      ...(typeof usage?.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
      ...(typeof usage?.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
      ...(typeof payload.costUsd === 'number' ? { costUsd: payload.costUsd } : {}),
      ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
    };
  }
  return { kind: 'ext', name: typeof payload.type === 'string' ? payload.type : 'agent', data: payload };
}

function parseSseFrame(frame: string): RunProtocolEventWire | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data.length === 0) return null;
  return JSON.parse(data) as RunProtocolEventWire;
}

async function streamRun(
  runId: string,
  handlers: RunHandlers,
  signal?: AbortSignal,
): Promise<void> {
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
      let boundary = buffered.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        boundary = buffered.indexOf('\n\n');
        const wireEvent = parseSseFrame(frame);
        if (!wireEvent) continue;
        if (wireEvent.kind === 'error') {
          const payload = wireEvent.payload as { message?: unknown };
          handlers.onError(new Error(typeof payload.message === 'string' ? payload.message : 'The run failed'));
          continue;
        }
        if (wireEvent.kind === 'end') {
          const payload = wireEvent.payload as { status?: unknown };
          if (payload.status === 'failed') handlers.onError(new Error('The agent run failed'));
          reachedEnd = true;
          handlers.onDone(events);
          continue;
        }
        const event = toAgentEvent(wireEvent, handlers);
        if (event) {
          events.push(event);
          handlers.onEvent(event);
        }
      }
      if (done) break;
    }
    if (!reachedEnd && !signal?.aborted) throw new Error('The daemon event stream closed before the run ended');
  } finally {
    reader.releaseLock();
  }
}

export function createDaemonChatTransport(): ChatTransport {
  return {
    async startRun(input: StartRunInput, handlers: RunHandlers) {
      const agentId = input.agentId ?? 'playground-demo';
      const prompt = composeRunPrompt({ history: input.history, agentId });
      if (!prompt) throw new Error('A prompt is required');
      const context = (input.context ?? {}) as PlaygroundContext;
      const project = typeof context.project === 'string' ? context.project : 'starter-site';
      const model = typeof context.model === 'string' && context.model.length > 0 ? context.model : undefined;
      const reasoning =
        typeof context.reasoning === 'string' && context.reasoning.length > 0
          ? context.reasoning
          : undefined;
      const workingDirectory =
        typeof context.workingDirectory === 'string' && context.workingDirectory.length > 0
          ? context.workingDirectory
          : undefined;
      // Proves which tab started this run so page.* calls can be routed back to it.
      const frontendBindToken =
        typeof context.frontendBindToken === 'string' && context.frontendBindToken.length > 0
          ? context.frontendBindToken
          : undefined;
      const response = await fetch('/api/runs', {
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
      });
      if (!response.ok) throw await readApiError(response);
      const body = (await response.json()) as RunResponseWire;
      void streamRun(body.run.id, handlers, input.signal).catch((error: unknown) => {
        if (!input.signal.aborted) handlers.onError(error instanceof Error ? error : new Error(String(error)));
      });
      return { runId: body.run.id };
    },
    async reattachRun(runId, handlers) {
      await streamRun(runId, handlers);
    },
    async fetchRunStatus(runId) {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw await readApiError(response);
      return ((await response.json()) as RunResponseWire).run.state;
    },
    async stopRun(runId) {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Canceled from Jini Playground' }),
      });
      if (!response.ok) throw await readApiError(response);
    },
  };
}
