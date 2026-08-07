/** @module agent-protocol/pi-rpc/events
 * Pure event mapper for pi's JSON-RPC stream protocol. Translates raw JSON
 * objects emitted by `pi --mode rpc` into the daemon's typed UI events:
 * status, text_delta, thinking, tool_use, tool_result, usage, and error.
 * No I/O — all side effects flow through the SendAgentEvent callback.
 */
import type { JsonRecord, SendAgentEvent, TokenUsage } from './internal.js';
import { getRecord } from './internal.js';

/** Timing and first-token-tracking context threaded through every mapPiRpcEvent call. */
export type PiRpcContext = {
  runStartedAt: number;
  sentFirstToken: { value: boolean };
};

/** One `raw.type` handler in the {@link PI_RPC_EVENT_HANDLERS} dispatch table. */
type PiRpcEventHandler = (raw: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext) => 'agent_end' | null;

export function handleAgentStart(_raw: JsonRecord, send: SendAgentEvent): null {
  send('agent', { type: 'status', label: 'working' });
  return null;
}

export function handleAgentEnd(): 'agent_end' {
  return 'agent_end';
}

export function handleTurnStart(_raw: JsonRecord, send: SendAgentEvent): null {
  send('agent', { type: 'status', label: 'thinking' });
  return null;
}

/** Extracts the subset of pi's `message.usage` fields the daemon reports as token usage. */
export function buildTokenUsage(u: JsonRecord): TokenUsage {
  const usage: TokenUsage = {};
  if (typeof u.input === 'number') usage.input_tokens = u.input;
  if (typeof u.output === 'number') usage.output_tokens = u.output;
  if (typeof u.cacheRead === 'number') usage.cached_read_tokens = u.cacheRead;
  if (typeof u.cacheWrite === 'number') usage.cached_write_tokens = u.cacheWrite;
  if (typeof u.totalTokens === 'number') usage.total_tokens = u.totalTokens;
  return usage;
}

export function emitTurnEndUsage(u: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext): void {
  const usage = buildTokenUsage(u);
  if (Object.keys(usage).length === 0) return;
  const cost = getRecord(u.cost);
  send('agent', {
    type: 'usage',
    usage,
    costUsd: cost?.total ?? cost?.totalCost ?? null,
    durationMs: Date.now() - ctx.runStartedAt,
  });
}

export function emitTurnEndErrorIfPresent(message: JsonRecord | undefined, raw: JsonRecord, send: SendAgentEvent): void {
  if (message?.stopReason !== 'error') return;
  const messageText =
    typeof message.errorMessage === 'string' && message.errorMessage.length > 0
      ? message.errorMessage
      : 'Pi agent error';
  send('agent', { type: 'error', message: messageText, raw });
}

export function handleTurnEnd(raw: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext): null {
  const message = getRecord(raw.message);
  const messageUsage = getRecord(message?.usage);
  if (messageUsage) emitTurnEndUsage(messageUsage, send, ctx);
  emitTurnEndErrorIfPresent(message, raw, send);
  return null;
}

export function handleAssistantTextDelta(ev: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext): void {
  if (typeof ev.delta !== 'string') return;
  if (!ctx.sentFirstToken.value) {
    ctx.sentFirstToken.value = true;
    send('agent', {
      type: 'status',
      label: 'streaming',
      ttftMs: Date.now() - ctx.runStartedAt,
    });
  }
  send('agent', { type: 'text_delta', delta: ev.delta });
}

export function handleAssistantThinkingDelta(ev: JsonRecord, send: SendAgentEvent): void {
  if (typeof ev.delta !== 'string') return;
  send('agent', { type: 'thinking_delta', delta: ev.delta });
}

export function handleAssistantThinkingStart(_ev: JsonRecord, send: SendAgentEvent): void {
  send('agent', { type: 'thinking_start' });
}

export function handleAssistantThinkingEnd(_ev: JsonRecord, send: SendAgentEvent): void {
  send('agent', { type: 'thinking_end' });
}

// pi's RPC protocol emits a message_update with error delta when
// the model returns an error (e.g. aborted, context overflow).
// Surface it so sendAgentEvent's error-handling path sets
// agentStreamError and the run flips to `failed` on close.
export function handleAssistantError(ev: JsonRecord, send: SendAgentEvent, _ctx: PiRpcContext, raw: JsonRecord): void {
  const message =
    typeof ev.reason === 'string' && ev.reason.length > 0
      ? ev.reason
      : typeof ev.delta === 'string' && ev.delta.length > 0
        ? ev.delta
        : 'Agent error';
  send('agent', { type: 'error', message, raw });
}

/** One `assistantMessageEvent.type` handler in the message_update sub-dispatch. */
type PiAssistantEventHandler = (ev: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext, raw: JsonRecord) => void;

const ASSISTANT_MESSAGE_EVENT_HANDLERS: Record<string, PiAssistantEventHandler> = {
  text_delta: handleAssistantTextDelta,
  thinking_delta: handleAssistantThinkingDelta,
  thinking_start: handleAssistantThinkingStart,
  thinking_end: handleAssistantThinkingEnd,
  error: handleAssistantError,
};

export function handleMessageUpdate(raw: JsonRecord, send: SendAgentEvent, ctx: PiRpcContext): null {
  const assistantMessageEvent = getRecord(raw.assistantMessageEvent);
  if (!assistantMessageEvent) return null;
  const ev = assistantMessageEvent;
  const handler = typeof ev.type === 'string' ? ASSISTANT_MESSAGE_EVENT_HANDLERS[ev.type] : undefined;
  handler?.(ev, send, ctx, raw);
  return null;
}

export function handleMessageEnd(): null {
  // message_end carries usage (already emitted from turn_end) and
  // tool call blocks (already emitted from tool_execution_start).
  // Nothing to extract here.
  return null;
}

export function handleToolExecutionStart(raw: JsonRecord, send: SendAgentEvent): null {
  send('agent', {
    type: 'tool_use',
    id: raw.toolCallId ?? null,
    name: raw.toolName ?? null,
    input: raw.args ?? null,
  });
  return null;
}

export function handleToolExecutionEnd(raw: JsonRecord, send: SendAgentEvent): null {
  const result = getRecord(raw.result);
  const content = result?.content;
  const text =
    Array.isArray(content)
      ? content
          .map((c: unknown) => {
            const item = getRecord(c);
            return item?.type === 'text' ? String(item.text ?? '') : JSON.stringify(c);
          })
          .join('\n')
      : typeof content === 'string'
        ? content
        : '';
  send('agent', {
    type: 'tool_result',
    toolUseId: raw.toolCallId ?? null,
    content: text,
    isError: raw.isError === true,
  });
  return null;
}

// pi's RPC protocol can emit `extension_error` when an extension
// throws during a tool call or event handler. Surface it so the
// daemon's error-handling path (sendAgentEvent → agentStreamError)
// can flip the run to `failed` and forward a visible SSE error.
export function handleExtensionError(raw: JsonRecord, send: SendAgentEvent): null {
  const message =
    typeof raw.error === 'string' && raw.error.length > 0
      ? raw.error
      : 'Extension error';
  send('agent', { type: 'error', message, raw });
  return null;
}

export function handleCompactionStart(_raw: JsonRecord, send: SendAgentEvent): null {
  send('agent', { type: 'status', label: 'compacting' });
  return null;
}

export function handleAutoRetryStart(_raw: JsonRecord, send: SendAgentEvent): null {
  send('agent', { type: 'status', label: 'retrying' });
  return null;
}

export function handleAutoRetryEnd(raw: JsonRecord, send: SendAgentEvent): null {
  // Auto-retry exhausted — the agent is about to give up. Surface
  // the final error so the daemon marks the run as failed rather
  // than silently succeeding with empty output.
  if (raw.success !== false) return null;
  const message =
    typeof raw.finalError === 'string' && raw.finalError.length > 0
      ? raw.finalError
      : 'Auto-retry exhausted';
  send('agent', { type: 'error', message, raw });
  return null;
}

const PI_RPC_EVENT_HANDLERS: Record<string, PiRpcEventHandler> = {
  agent_start: handleAgentStart,
  agent_end: handleAgentEnd,
  turn_start: handleTurnStart,
  turn_end: handleTurnEnd,
  message_update: handleMessageUpdate,
  message_end: handleMessageEnd,
  tool_execution_start: handleToolExecutionStart,
  tool_execution_end: handleToolExecutionEnd,
  extension_error: handleExtensionError,
  compaction_start: handleCompactionStart,
  auto_retry_start: handleAutoRetryStart,
  auto_retry_end: handleAutoRetryEnd,
};

/**
 * Maps a single raw pi RPC JSON object to zero or more daemon SSE events,
 * dispatching each through `send`. Returns `'agent_end'` when pi signals the
 * end of the run; returns `null` for every other event type.
 *
 * @param raw  - Parsed JSON object read from pi's stdout.
 * @param send - Callback that forwards a typed event to the daemon SSE layer.
 * @param ctx  - Per-run context: start timestamp and first-token sentinel.
 * @returns `'agent_end'` on run completion, `null` otherwise.
 */
export function mapPiRpcEvent(
  raw: JsonRecord,
  send: SendAgentEvent,
  ctx: PiRpcContext,
): 'agent_end' | null {
  const handler = typeof raw.type === 'string' ? PI_RPC_EVENT_HANDLERS[raw.type] : undefined;
  return handler ? handler(raw, send, ctx) : null;
}
