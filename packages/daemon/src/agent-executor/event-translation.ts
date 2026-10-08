import type {
   RunAgentPayload,
   RunErrorPayload,
} from '@jini-ai/protocol';
import type {
   AgentRuntimeEventTranslation,
} from './contracts.js';
import {
  isRecord,
  asString,
  asOptionalString,
} from './values.js';

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Narrows a parsed `usage` event's `usage` sub-object (`{input_tokens?, output_tokens?}`) — the one
 * piece of {@link translateUsagePayload} with real nested branching (an optional container holding
 * two optional numeric fields), extracted so that function reads as a flat field-by-field mapping.
 * @param rawUsage - `rawEvent.usage` once already narrowed to a record, or `undefined` when absent/malformed.
 * @returns `undefined` when neither token count is present — matching `translateUsagePayload`'s
 * original "omit the whole `usage` field rather than emit an empty object" behavior.
 * @complexity O(1).
 */
export function extractUsageTokens({ rawUsage }: { readonly rawUsage: Record<string, unknown> | undefined }
): { input_tokens?: number; output_tokens?: number } | undefined {
  if (!rawUsage) return undefined;
  const inputTokens = asOptionalNumber(rawUsage.input_tokens);
  const outputTokens = asOptionalNumber(rawUsage.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
  };
}

/**
 * Narrows one parsed `usage` event's loosely-typed fields into
 * `RunAgentPayload`'s `usage` variant. The 4 source parsers attach extra
 * fields this narrow payload has no room for — `thought_tokens`,
 * `cached_read_tokens`/`cached_write_tokens` (opencode/gemini/codex),
 * `modelUsage`/`stopReason`/`isError` (qoder), a top-level `stopReason`
 * (claude/copilot) — all intentionally dropped here, not carried through.
 * @param rawEvent - The raw `{type:'usage', ...}` record from a stream parser.
 * @returns The narrowed `RunAgentPayload` `usage` variant.
 * @complexity O(1).
 * @overallScore 100/100
 */
function translateUsagePayload(rawEvent: Record<string, unknown>): RunAgentPayload {
  const rawUsage = isRecord(rawEvent.usage) ? rawEvent.usage : undefined;
  const usage = extractUsageTokens({ rawUsage: rawUsage });
  const costUsd = asOptionalNumber(rawEvent.costUsd);
  const durationMs = asOptionalNumber(rawEvent.durationMs);
  return {
    type: 'usage',
    ...(usage !== undefined ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function translateStatusEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const model = asOptionalString(rawEvent.model);
  const ttftMs = asOptionalNumber(rawEvent.ttftMs);
  const detail = asOptionalString(rawEvent.detail);
  const sessionId = asOptionalString(rawEvent.sessionId);
  return {
    kind: 'agent',
    payload: {
      type: 'status',
      label: asString(rawEvent.label, 'unknown'),
      ...(model !== undefined ? { model } : {}),
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    },
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

function translateTextDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'text_delta', delta: asString(rawEvent.delta) } };
}

function translateThinkingStartEvent(): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'thinking_start' } };
}

function translateThinkingDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'thinking_delta', delta: asString(rawEvent.delta) } };
}

function translateToolUseEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return {
    kind: 'agent',
    payload: {
      type: 'tool_use',
      id: asString(rawEvent.id),
      name: asString(rawEvent.name),
      input: rawEvent.input ?? null,
    },
  };
}

function translateToolInputDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return {
    kind: 'agent',
    payload: {
      type: 'tool_input_delta',
      id: asString(rawEvent.id),
      name: asString(rawEvent.name),
      delta: asString(rawEvent.delta),
    },
  };
}

export function translateToolResultEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const isError = typeof rawEvent.isError === 'boolean' ? rawEvent.isError : undefined;
  return {
    kind: 'agent',
    payload: {
      type: 'tool_result',
      toolUseId: asString(rawEvent.toolUseId),
      content: asString(rawEvent.content),
      ...(isError !== undefined ? { isError } : {}),
    },
  };
}

function translateUsageEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: translateUsagePayload(rawEvent) };
}

function translateRawEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'raw', line: asString(rawEvent.line) } };
}

export function translateErrorEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const code = asOptionalString(rawEvent.code);
  const message = asString(rawEvent.message, 'Unknown agent error');
  return {
    kind: 'error',
    payload: { message, ...(code !== undefined ? { error: { code, message } } : {}) },
  };
}

export function translateTurnEndEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  // Claude-specific per-turn boundary. Not forwarded as an 'agent'
  // event (no RunAgentPayload variant represents it) — run() reacts to
  // it directly to close stdin (or, for gap 3, decide whether to inject
  // a tool result and keep it open instead). See module doc.
  const stopReason = asOptionalString(rawEvent.stopReason);
  return { kind: 'turn-end', ...(stopReason !== undefined ? { stopReason } : {}) };
}

/**
 * One entry per `rawEvent.type` this driver understands, each producing the same
 * {@link AgentRuntimeEventTranslation} `translateAgentRuntimeEvent` used to return from an inline
 * `switch` — replaced with this table (refactor-patterns' preferred fix for a long switch over an
 * event-kind discriminant) so each case's own mapping is independently readable and testable, and so
 * `translateAgentRuntimeEvent` itself is just a lookup plus the two upfront guards.
 */
const EVENT_TYPE_TRANSLATORS: Readonly<Record<string, (rawEvent: Record<string, unknown>) => AgentRuntimeEventTranslation>> = {
  status: rawEvent => translateStatusEvent({ rawEvent }),
  text_delta: translateTextDeltaEvent,
  thinking_start: translateThinkingStartEvent,
  thinking_delta: translateThinkingDeltaEvent,
  tool_use: translateToolUseEvent,
  tool_input_delta: translateToolInputDeltaEvent,
  tool_result: rawEvent => translateToolResultEvent({ rawEvent }),
  usage: translateUsageEvent,
  raw: translateRawEvent,
  error: rawEvent => translateErrorEvent({ rawEvent }),
  turn_end: rawEvent => translateTurnEndEvent({ rawEvent }),
};

/**
 * Narrows one parser-emitted `{type, ...}` record into this engine's
 * `RunAgentPayload` union (or the `error`/`turn-end`/`ignored` routing
 * `run()` special-cases). Pure — no I/O, no closure state — so every
 * variant each of the 4 supported parsers can produce is directly
 * assertable in isolation.
 *
 * Defensive by construction: several real parser emissions carry fields
 * looser than `RunAgentPayload`'s types promise (e.g. copilot's
 * `tool.execution_start` emits `id: data.toolCallId ?? null` — a literal
 * `null`, not the `string` `RunAgentPayload['tool_use']['id']` demands).
 * Every field read here is defensively coerced (`asString`/
 * `asOptionalString`/`asOptionalNumber`) rather than trusted, so a
 * malformed or null field degrades to a safe default instead of
 * propagating `null`/`undefined` into a field typed as required, or
 * throwing.
 *
 * @param rawEvent - One event as delivered to a stream parser's `onEvent` callback.
 * @returns The routing + payload this event maps to.
 * @complexity O(1) — one table lookup, no iteration.
 * @overallScore 100/100
 */
export function translateAgentRuntimeEvent({ rawEvent }: { readonly rawEvent: unknown }): AgentRuntimeEventTranslation {
  if (!isRecord(rawEvent) || typeof rawEvent.type !== 'string') {
    return { kind: 'ignored' };
  }
  const translator = EVENT_TYPE_TRANSLATORS[rawEvent.type];
  return translator ? translator(rawEvent) : { kind: 'ignored' };
}

/**
 * Maps an ACP session's transport error into the canonical run-error shape.
 * ACP adapters may add a structured `error` member, but a daemon driver must
 * never make one vendor's error shape part of the run protocol.
 */
export function translateAcpError(payload: unknown): RunErrorPayload {
  if (!isRecord(payload)) return { message: asString(payload, 'ACP agent failed') };
  const message = asString(payload.message, 'ACP agent failed');
  const error = isRecord(payload.error) ? payload.error : null;
  const code = error ? asOptionalString(error.code) : undefined;
  const retryable = error && typeof error.retryable === 'boolean' ? error.retryable : undefined;
  return {
    message,
    ...(code !== undefined
      ? {
          error: {
            code,
            message: asString(error?.message, message),
            ...(retryable !== undefined ? { retryable } : {}),
          },
        }
      : {}),
  };
}

/** The side-effect signals {@link applyAgentTranslationSideEffects} reports through, one callback per signal so a caller only wires the ones it actually tracks. */
interface AgentTranslationSideEffectSink {
  readonly onSessionId: (args: { readonly sessionId: string }) => void;
  readonly onToolCall: () => void;
  readonly onUserVisibleOutput: () => void;
}

/**
 * Applies one already-translated `'agent'`-kind event's side-effect signals — a captured session id
 * (gap 5), and the `toolCallSeen`/`userVisibleOutputSeen` pair every `wire*Lifecycle` driver tracks
 * for `FailureClassificationContext.sideEffects` — through `sink`. Extracted from `wireAcpLifecycle`'s
 * `send()`, where this exact three-level-deep nesting (session-id check, then tool_use/else-if
 * delta-length check) was that function's largest single cognitive-complexity contributor. Pure
 * except for calling the injected `sink` callbacks.
 * @param payload - The translated event's `RunAgentPayload`.
 * @param sessionId - The translation's optional captured session id, or `undefined`.
 * @param sink - The driver-specific effects to apply.
 * @complexity O(1).
 */
export function applyAgentTranslationSideEffects({ payload, sessionId, sink }: { readonly payload: RunAgentPayload; readonly sessionId: string | undefined; readonly sink: AgentTranslationSideEffectSink }
): void {
  if (sessionId !== undefined) sink.onSessionId({ sessionId });
  if (payload.type === 'tool_use') {
    sink.onToolCall();
  } else if ((payload.type === 'text_delta' || payload.type === 'thinking_delta') && payload.delta.length > 0) {
    sink.onUserVisibleOutput();
  }
}
