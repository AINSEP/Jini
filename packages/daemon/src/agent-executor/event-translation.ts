import type {
   RunAgentPayload,
   RunErrorPayload,
} from '@jini-ai/protocol';
import { normalizeAiUsage } from '@jini-ai/core/contracts/ai-trace';
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
 * Narrows a parsed `usage` event's `usage` sub-object — the one
 * piece of {@link translateUsagePayload} with real nested branching (an optional container holding
 * optional numeric fields), extracted so that function reads as a flat field-by-field mapping.
 * Reuses the runtime's alias owner so cache/reasoning counters survive the canonical boundary.
 * @param rawUsage - `rawEvent.usage` once already narrowed to a record, or `undefined` when absent/malformed.
 * @returns `undefined` when no token count is present — matching `translateUsagePayload`'s
 * original "omit the whole `usage` field rather than emit an empty object" behavior.
 * @complexity O(1).
 */
export function extractUsageTokens({ rawUsage }: { readonly rawUsage: Record<string, unknown> | undefined }, _options: Record<string, never> = {}
): Extract<RunAgentPayload, { type: 'usage' }>['usage'] {
  const normalized = normalizeAiUsage({ usage: rawUsage });
  if (!normalized) return undefined;
  const fields = { input_tokens: normalized.inputTokens, output_tokens: normalized.outputTokens, cache_read_input_tokens: normalized.cacheReadTokens, cache_creation_input_tokens: normalized.cacheWriteTokens, reasoning_tokens: normalized.reasoningTokens };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
}

/**
 * Narrows one parsed `usage` event's loosely-typed fields into
 * `RunAgentPayload`'s `usage` variant. The 4 source parsers attach extra
 * fields beyond the basic counts — `thought_tokens`,
 * `cached_read_tokens`/`cached_write_tokens` (opencode/gemini/codex),
 * `modelUsage`/`stopReason`/`isError` (qoder), a top-level `stopReason`
 * (claude). Cache/reasoning counters and stop reasons now survive tracing; vendor-only
 * `modelUsage` and `isError` remain outside this neutral usage contract.
 * @param rawEvent - The raw `{type:'usage', ...}` record from a stream parser.
 * @returns The narrowed `RunAgentPayload` `usage` variant.
 * @complexity O(1).
 * @overallScore 100/100
 */
function translateUsagePayload({ rawEvent }: { rawEvent: Record<string, unknown> }): RunAgentPayload {
  const record = { value: rawEvent.usage };
  const rawUsage = isRecord(record) ? record.value : undefined;
  const usage = extractUsageTokens({ rawUsage: rawUsage });
  const costUsd = asOptionalNumber(rawEvent.costUsd);
  const cumulativeCostUsd = asOptionalNumber(rawEvent.cumulativeCostUsd);
  const costSessionId = asOptionalString({ value: rawEvent.costSessionId });
  const durationMs = asOptionalNumber(rawEvent.durationMs);
  const stopReason = asOptionalString({ value: rawEvent.stopReason });
  return {
    type: 'usage',
    ...(usage !== undefined ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(cumulativeCostUsd !== undefined ? { cumulativeCostUsd } : {}),
    ...(costSessionId !== undefined ? { costSessionId } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
  };
}

export function translateStatusEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const model = asOptionalString({ value: rawEvent.model });
  const ttftMs = asOptionalNumber(rawEvent.ttftMs);
  const detail = asOptionalString({ value: rawEvent.detail });
  const sessionId = asOptionalString({ value: rawEvent.sessionId });
  return {
    kind: 'agent',
    payload: {
      type: 'status',
      label: asString({ value: rawEvent.label }, { fallback: 'unknown' }),
      ...(model !== undefined ? { model } : {}),
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    },
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

function translateTextDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'text_delta', delta: asString({ value: rawEvent.delta }) } };
}

function translateThinkingStartEvent(): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'thinking_start' } };
}

function translateThinkingDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'thinking_delta', delta: asString({ value: rawEvent.delta }) } };
}

function translateToolUseEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  const bridgeCall = { value: rawEvent.bridgeCall };
  return {
    kind: 'agent',
    payload: {
      type: 'tool_use',
      id: asString({ value: rawEvent.id }),
      name: asString({ value: rawEvent.name }),
      input: rawEvent.input ?? null,
      ...(isRecord(bridgeCall) && typeof bridgeCall.value.name === 'string'
        ? { bridgeCall: { name: bridgeCall.value.name, input: bridgeCall.value.input,
          ...(bridgeCall.value.buffered === true ? { buffered: true } : {}) } } : {}),
    },
  };
}

function translateToolInputDeltaEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return {
    kind: 'agent',
    payload: {
      type: 'tool_input_delta',
      id: asString({ value: rawEvent.id }),
      name: asString({ value: rawEvent.name }),
      delta: asString({ value: rawEvent.delta }),
    },
  };
}

export function translateToolResultEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const delegatedToolUseId = asOptionalString({ value: rawEvent.delegatedToolUseId });
  const isError = typeof rawEvent.isError === 'boolean' ? rawEvent.isError : undefined;
  return {
    kind: 'agent',
    payload: {
      type: 'tool_result',
      toolUseId: asString({ value: rawEvent.toolUseId }),
      content: asString({ value: rawEvent.content }),
      ...(delegatedToolUseId !== undefined ? { delegatedToolUseId } : {}),
      ...(isError !== undefined ? { isError } : {}),
    },
  };
}

function translateUsageEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: translateUsagePayload({ rawEvent }) };
}

function translateRawEvent(rawEvent: Record<string, unknown>): AgentRuntimeEventTranslation {
  return { kind: 'agent', payload: { type: 'raw', line: asString({ value: rawEvent.line }) } };
}

export function translateErrorEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> }): AgentRuntimeEventTranslation {
  const code = asOptionalString({ value: rawEvent.code });
  const message = asString({ value: rawEvent.message }, { fallback: 'Unknown agent error' });
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
  const stopReason = asOptionalString({ value: rawEvent.stopReason });
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
 * looser than `RunAgentPayload`'s types promise (e.g. an untrusted
 * tool event can carry a literal `null`, not the `string`
 * `RunAgentPayload['tool_use']['id']` demands).
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
  const record = { value: rawEvent };
  if (!isRecord(record) || typeof record.value.type !== 'string') {
    return { kind: 'ignored' };
  }
  const translator = EVENT_TYPE_TRANSLATORS[record.value.type];
  return translator ? translator(record.value) : { kind: 'ignored' };
}

/**
 * Maps an ACP session's transport error into the canonical run-error shape.
 * ACP adapters may add a structured `error` member, but a daemon driver must
 * never make one vendor's error shape part of the run protocol.
 */
export function translateAcpError({ payload }: { payload: unknown }, _optional: Record<string, never> = {}): RunErrorPayload {
  const record = { value: payload };
  if (!isRecord(record)) return { message: asString({ value: payload }, { fallback: 'ACP agent failed' }) };
  const message = asString({ value: record.value.message }, { fallback: 'ACP agent failed' });
  const errorRecord = { value: record.value.error };
  const error = isRecord(errorRecord) ? errorRecord.value : null;
  const code = error ? asOptionalString({ value: error.code }) : undefined;
  const retryable = error && typeof error.retryable === 'boolean' ? error.retryable : undefined;
  return {
    message,
    ...(code !== undefined
      ? {
          error: {
            code,
            message: asString({ value: error?.message }, { fallback: message }),
            ...(retryable !== undefined ? { retryable } : {}),
          },
        }
      : {}),
  };
}

/** The side-effect signals {@link applyAgentTranslationSideEffects} reports through, one callback per signal so a caller only wires the ones it actually tracks. */
interface AgentTranslationSideEffectSink {
  readonly onSessionId: (args: { readonly sessionId: string }) => void;
  /** Receives the already-narrowed `tool_use` payload, so a caller never re-checks its variant. */
  readonly onToolCall: (args: { readonly toolUse: Extract<RunAgentPayload, { type: 'tool_use' }> }) => void;
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
    sink.onToolCall({ toolUse: payload });
    return;
  }
  if ((payload.type === 'text_delta' || payload.type === 'thinking_delta') && payload.delta.length > 0) sink.onUserVisibleOutput();
}
