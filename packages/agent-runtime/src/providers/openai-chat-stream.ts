import { emitGuardedTextDelta } from '../role-marker-guard.js';
import { parseSseJsonRecord } from './sse-decode.js';
import { type OpenAiStreamState, type OpenAiTurnEvent, type PendingToolCall, type OpenAiToolCall } from './openai-chat-types.js';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses one SSE frame's data as a JSON object, or `null` for a malformed/empty keep-alive frame or a non-object payload — both are tolerated by the caller as "nothing to do this frame". */
export const parseOpenAiSseData = parseSseJsonRecord;

export function applyOpenAiStreamUsage({ state, data, onEvent }: { state: OpenAiStreamState; data: Record<string, unknown>; onEvent: (event: OpenAiTurnEvent) => void }, _optional: Record<string, never> = {}): void {
  if (!isRecord(data.usage)) return;
  state.usage = data.usage;
  onEvent({ type: 'usage', usage: data.usage });
}

/** The chunk's first (and, for Chat Completions, only) choice — `null` when the chunk carries no choice at all (e.g. a usage-only trailer chunk). */
export function firstOpenAiChoice({ data }: { data: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> | null {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const choice = choices[0];
  return isRecord(choice) ? choice : null;
}

/**
 * Feeds one text delta through the role-marker guard and emits the safe portion. Returns
 * `'break'` once the guard flags contamination (the caller ends the turn immediately), otherwise
 * `'continue'` — same contract as `anthropic-messages.ts#handleAnthropicTextDelta`.
 */
export function handleOpenAiTextContentDelta({ state, content, onEvent }: { state: OpenAiStreamState; content: string; onEvent: (event: OpenAiTurnEvent) => void }, _optional: Record<string, never> = {}): 'continue' | 'break' {
  return emitGuardedTextDelta({ state, text: content, onEvent });
}

/** Builds a fresh `PendingToolCall` from the streaming chunk that first mentions a given tool-call index — OpenAI sends `id`/`function.name` once, on that first chunk, then dribbles `function.arguments` in across subsequent chunks (accumulated separately by the caller). */
export function newPendingOpenAiToolCall({ rawCall, index }: { rawCall: Record<string, unknown>; index: number }, _optional: Record<string, never> = {}): PendingToolCall {
  const id = typeof rawCall.id === 'string' ? rawCall.id : `call_${index}`;
  const fn = isRecord(rawCall.function) ? rawCall.function : {};
  const name = typeof fn.name === 'string' ? fn.name : '';
  return { id, name, argsJson: '' };
}

/** Accumulates one `delta.tool_calls[]` entry from a streaming chunk into its running `PendingToolCall`. */
export function accumulateOpenAiToolCallDelta({ state, rawCall }: { state: OpenAiStreamState; rawCall: unknown }, _optional: Record<string, never> = {}): void {
  if (!isRecord(rawCall) || typeof rawCall.index !== 'number') return;
  let pending = state.toolCalls.get(rawCall.index);
  if (!pending) {
    pending = newPendingOpenAiToolCall({ rawCall: rawCall, index: rawCall.index });
    state.toolCalls.set(rawCall.index, pending);
  }
  const fn = isRecord(rawCall.function) ? rawCall.function : null;
  if (fn && typeof fn.arguments === 'string') {
    pending.argsJson += fn.arguments;
  }
}
function openAiDeltaText(delta: Record<string, unknown>): string | null { return typeof delta.content === 'string' && delta.content.length > 0 ? delta.content : null; }
/** Reduces one chunk's `choices[0]` — `finish_reason`, text content, and tool-call deltas — into `state`. Returns `'break'` when the text-delta guard detects contamination. */
export function handleOpenAiChoiceDelta({ state, choice, onEvent }: { state: OpenAiStreamState; choice: Record<string, unknown>; onEvent: (event: OpenAiTurnEvent) => void }, _optional: Record<string, never> = {}): 'continue' | 'break' {
  if (typeof choice.finish_reason === 'string') {
    state.finishReason = choice.finish_reason;
  }
  const delta = isRecord(choice.delta) ? choice.delta : null;
  if (!delta) return 'continue';

  const text = openAiDeltaText(delta);
  if (text !== null && handleOpenAiTextContentDelta({ state: state, content: text, onEvent: onEvent }) === 'break') return 'break';
  if (Array.isArray(delta.tool_calls)) {
    for (const rawCall of delta.tool_calls) {
      accumulateOpenAiToolCallDelta({ state: state, rawCall: rawCall });
    }
  }
  return 'continue';
}

/** Parses one accumulated tool call's `argsJson`, falling back to `{}` for empty or malformed JSON — mirrors Anthropic's identical fallback for `input_json_delta` accumulation in `anthropic-messages.ts`. */
export function resolveOpenAiToolCalls({ pending }: { pending: ReadonlyMap<number, PendingToolCall> }, _optional: Record<string, never> = {}): OpenAiToolCall[] {
  return Array.from(pending.values()).map((call) => {
    let input: unknown = {};
    if (call.argsJson.trim()) {
      try {
        input = JSON.parse(call.argsJson);
      } catch {
        input = {};
      }
    }
    return { id: call.id, name: call.name, input };
  });
}

export function emitPendingOpenAiToolUseEvents({ toolCalls, onEvent }: { toolCalls: readonly OpenAiToolCall[]; onEvent: (event: OpenAiTurnEvent) => void }, _optional = {}): void {
  for (const call of toolCalls) {
    onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
}
