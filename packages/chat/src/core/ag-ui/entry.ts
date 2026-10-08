/** Pure chat-event to AG-UI projection; lifecycle state belongs to one run.
 * This legacy wire reducer is independent of saved-chat reduction: partial tool input remains
 * a CUSTOM extension, while media stays in run-event vocabulary and is absent from TOOL_CALL_RESULT.
 * Strict interruption ordering closes a message before a tool starts. IDs and custom event names
 * are injected, with official AG-UI types authoritative; auth, routes and encoder stay with the host.
 * The host emits RUN_STARTED and terminal RUN_FINISHED/RUN_ERROR outside this pure projection. */
import { EventType, type AGUIEvent } from '@ag-ui/core';
import type { AgentEvent } from '../events.js';

export interface EventIdGenerator {
  next(args: { prefix: string; ordinal: number }): string;
}
export interface CustomEventNames {
  readonly usage: string;
  readonly status: string;
  readonly extensionPrefix: string;
}

export interface RunAgentWirePayload {
  readonly type: string;
  readonly [key: string]: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

function reduceUsagePayload(payload: RunAgentWirePayload): AgentEvent {
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  return {
    kind: "usage",
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof payload.costUsd === "number" ? { costUsd: payload.costUsd } : {}),
    ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
  };
}

const WIRE_PAYLOAD_REDUCERS: Record<string, (payload: RunAgentWirePayload) => AgentEvent | null> = {
  status: (payload) => ({ kind: "status", label: asString(payload.label), ...(payload.detail ? { detail: asString(payload.detail) } : {}) }),
  text_delta: (payload) => ({ kind: "text", text: asString(payload.delta) }),
  thinking_delta: (payload) => ({ kind: "thinking", text: asString(payload.delta) }),
  tool_use: (payload) => ({ kind: "tool_use", id: asString(payload.id), name: asString(payload.name), input: payload.input }),
  tool_result: (payload) => ({
    kind: "tool_result",
    toolUseId: asString(payload.toolUseId),
    content: asString(payload.content),
    isError: Boolean(payload.isError),
  }),
  usage: reduceUsagePayload,
  raw: (payload) => ({ kind: "raw", line: asString(payload.line) }),
  "mcp-ui": (payload) => ({ kind: "ext", name: "mcp-ui", data: payload.resource }),
  a2ui: (payload) => ({ kind: "ext", name: "a2ui", data: payload.message }),
  thinking_start: () => null,
};

/** Preserve the legacy AG-UI wire reduction, including partial input as extension events.
 * Unlike the saved-chat reducer, this projection carries partial tool-input extensions. */
export function reduceAgentWirePayload({ payload }: { payload: RunAgentWirePayload }): AgentEvent | null {
  const reducer = Object.hasOwn(WIRE_PAYLOAD_REDUCERS, payload.type) ? WIRE_PAYLOAD_REDUCERS[payload.type] : undefined;
  return reducer ? reducer(payload) : { kind: "ext", name: payload.type, data: payload };
}

export type AgUiEvent = Extract<
  AGUIEvent,
  {
    type:
      | EventType.RUN_STARTED
      | EventType.RUN_FINISHED
      | EventType.RUN_ERROR
      | EventType.TEXT_MESSAGE_START
      | EventType.TEXT_MESSAGE_CONTENT
      | EventType.TEXT_MESSAGE_END
      | EventType.REASONING_START
      | EventType.REASONING_MESSAGE_START
      | EventType.REASONING_MESSAGE_CONTENT
      | EventType.REASONING_MESSAGE_END
      | EventType.REASONING_END
      | EventType.TOOL_CALL_START
      | EventType.TOOL_CALL_ARGS
      | EventType.TOOL_CALL_END
      | EventType.TOOL_CALL_RESULT
      | EventType.RAW
      | EventType.CUSTOM;
  }
>;

export interface AgUiTranslationState {
  openTextMessageId: string | null;
  openReasoningMessageId: string | null;

  nextId: number;
  readonly ids: EventIdGenerator;
  readonly customEventNames: CustomEventNames;
}

/** Create isolated per-run translation state with explicit IDs and custom-event wire names. */
export function createAgUiTranslationState({ ids, customEventNames }: { ids: EventIdGenerator; customEventNames: CustomEventNames }): AgUiTranslationState {
  return { openTextMessageId: null, openReasoningMessageId: null, nextId: 0, ids, customEventNames: { ...customEventNames } };
}

function mintId(state: AgUiTranslationState, prefix: string): string {
  state.nextId += 1;
  return state.ids.next({ prefix, ordinal: state.nextId });
}

function closeOpenMessages(state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId) {
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId: state.openTextMessageId });
    state.openTextMessageId = null;
  }
  if (state.openReasoningMessageId) {
    const messageId = state.openReasoningMessageId;
    events.push({ type: EventType.REASONING_MESSAGE_END, messageId });
    events.push({ type: EventType.REASONING_END, messageId });
    state.openReasoningMessageId = null;
  }
  return events;
}

function handleTextAgentEvent(event: Extract<AgentEvent, { kind: "text" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openReasoningMessageId) events.push(...closeOpenMessages(state));
  if (!state.openTextMessageId) {
    state.openTextMessageId = mintId(state, "msg");
    events.push({ type: EventType.TEXT_MESSAGE_START, messageId: state.openTextMessageId, role: "assistant" });
  }
  events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: state.openTextMessageId, delta: event.text });
  return events;
}

function handleThinkingAgentEvent(event: Extract<AgentEvent, { kind: "thinking" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId) events.push(...closeOpenMessages(state));
  if (!state.openReasoningMessageId) {
    state.openReasoningMessageId = mintId(state, "reasoning");
    events.push({ type: EventType.REASONING_START, messageId: state.openReasoningMessageId });
    events.push({ type: EventType.REASONING_MESSAGE_START, messageId: state.openReasoningMessageId, role: "reasoning" });
  }
  events.push({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: state.openReasoningMessageId, delta: event.text });
  return events;
}

function handleToolUseAgentEvent(event: Extract<AgentEvent, { kind: "tool_use" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId || state.openReasoningMessageId) events.push(...closeOpenMessages(state));
  events.push({ type: EventType.TOOL_CALL_START, toolCallId: event.id, toolCallName: event.name });
  events.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.id, delta: JSON.stringify(event.input ?? {}) });
  events.push({ type: EventType.TOOL_CALL_END, toolCallId: event.id });
  return events;
}

/** Emit ordered message/tool lifecycles; a tool call closes the preceding message first. */
export function translateAgentEventToAgUi({ event, state }: { event: AgentEvent; state: AgUiTranslationState }): AgUiEvent[] {
  switch (event.kind) {
    case "text":
      return handleTextAgentEvent(event, state);

    case "thinking":
      return handleThinkingAgentEvent(event, state);

    case "tool_use":
      return handleToolUseAgentEvent(event, state);

    case "tool_result":
      return [
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: mintId(state, "tool_result_msg"),
          toolCallId: event.toolUseId,
          content: event.content,
          role: "tool",
        },
      ];

    case "usage":
      return [{ type: EventType.CUSTOM, name: state.customEventNames.usage, value: event }];

    case "status":
      return [{ type: EventType.CUSTOM, name: state.customEventNames.status, value: event }];

    case "raw":
      return [{ type: EventType.RAW, event: event.line }];

    case "ext":
      return [{ type: EventType.CUSTOM, name: `${state.customEventNames.extensionPrefix}${event.name}`, value: event.data }];

    default: {
      const neverEvent: never = event;
      throw new Error(`translateAgentEventToAgUi: unhandled AgentEvent.kind ${JSON.stringify(neverEvent)}`);
    }
  }
}

/** Close open text/reasoning before the host emits RUN_FINISHED or RUN_ERROR. */
export function closeAgUiRun({ state }: { state: AgUiTranslationState }): AgUiEvent[] {
  return closeOpenMessages(state);
}


/**
 * Accumulates `TOOL_CALL_ARGS` deltas by `toolCallId` between a call's `TOOL_CALL_START` and
 * `TOOL_CALL_END` — the inverse of `assistant-ag-ui.ts`'s server-side translator, which emits all
 * three tool-call events back-to-back for one chat `tool_use` event today, but this side is written
 * to accumulate real streamed deltas too (a future daemon driver that streams `tool_input_delta`
 * incrementally needs no transport-layer change to render correctly). One instance per run, NOT a
 * module-level singleton — the same reasoning `assistant-ag-ui.ts`'s `AgUiTranslationState` gives.
 */
export interface AgUiToAgentTranslationState {
  toolCalls: Map<string, { name: string; argsJson: string }>;
  readonly customEventNames: CustomEventNames;
}

export function createAgUiToAgentTranslationState({ customEventNames }: { customEventNames: CustomEventNames }, _options: Record<string, never> = {}): AgUiToAgentTranslationState {
  return { toolCalls: new Map(), customEventNames: { ...customEventNames } };
}

/** The `TOOL_CALL_ARGS` case of {@link translateAgUiEventToAgentEvent} — accumulates one delta onto
 *  the in-flight call's buffer, a silent no-op for an id with no matching `TOOL_CALL_START`. Split
 *  out so this `if` is scored in its own complexity budget rather than the switch's. */
function accumulateToolCallArgs(toolCallId: string, delta: string, state: AgUiToAgentTranslationState): void {
  const call = state.toolCalls.get(toolCallId);
  if (call) call.argsJson += delta;
}

/** The `TOOL_CALL_END` case of {@link translateAgUiEventToAgentEvent} — parses the accumulated
 *  args buffer (already removed from `state` by the caller) into one `tool_use` event, or `[]` for
 *  an id with no matching `TOOL_CALL_START`. */
function finalizeToolCallAgentEvent(toolCallId: string, call: { name: string; argsJson: string } | undefined): AgentEvent[] {
  if (!call) return [];
  let input: unknown = {};
  try {
    input = call.argsJson.length > 0 ? JSON.parse(call.argsJson) : {};
  } catch {
    // A malformed/partial args buffer must not throw and drop the whole tool call — the raw
    // string is still more useful to a human than nothing.
    input = call.argsJson;
  }
  return [{ kind: "tool_use", id: toolCallId, name: call.name, input }];
}

/** The `CUSTOM` case of {@link translateAgUiEventToAgentEvent}. */
function translateAgUiCustomEvent(event: Extract<AgUiEvent, { type: EventType.CUSTOM }>, names: CustomEventNames): AgentEvent[] {
  // Host-supplied usage/status names: the server's own translator put the ORIGINAL `AgentEvent`
  // straight into `.value` (see `assistant-ag-ui.ts`'s `translateAgentEventToAgUi`), so this is
  // an exact round trip, not a re-derivation.
  if (event.name === names.usage || event.name === names.status) return [event.value as AgentEvent];
  if (event.name.startsWith(names.extensionPrefix)) return [{ kind: "ext", name: event.name.slice(names.extensionPrefix.length), data: event.value }];
  return [{ kind: "ext", name: event.name, data: event.value }];
}

/**
 * Translates one AG-UI event into zero or more chat-core `AgentEvent`s, threading `state` across
 * calls within a single run for tool-call argument accumulation.
 *
 * `TEXT_MESSAGE_START`/`END` and the `REASONING_*` boundary markers translate to nothing: chat-core
 * groups renderable output by a change in `AgentEvent.kind` alone (no message-boundary concept),
 * the same asymmetry `translateRunAgentPayload` already has reducing the OTHER leg of this round
 * trip (daemon wire -> `AgentEvent`) — this function is that reduction's mirror image. The two cases
 * with real internal branching (`TOOL_CALL_END`, `CUSTOM`) and the one with a guard (`TOOL_CALL_ARGS`)
 * are pulled into their own named functions above so this switch's own cost is just its case count.
 */
export function translateAgUiEventToAgentEvent({ event, state }: { event: AgUiEvent; state: AgUiToAgentTranslationState }, _options: Record<string, never> = {}): AgentEvent[] {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CONTENT:
      return [{ kind: "text", text: event.delta }];

    case EventType.REASONING_MESSAGE_CONTENT:
      return [{ kind: "thinking", text: event.delta }];

    case EventType.TOOL_CALL_START:
      state.toolCalls.set(event.toolCallId, { name: event.toolCallName, argsJson: "" });
      return [];

    case EventType.TOOL_CALL_ARGS:
      accumulateToolCallArgs(event.toolCallId, event.delta, state);
      return [];

    case EventType.TOOL_CALL_END: {
      const call = state.toolCalls.get(event.toolCallId);
      state.toolCalls.delete(event.toolCallId);
      return finalizeToolCallAgentEvent(event.toolCallId, call);
    }

    case EventType.TOOL_CALL_RESULT:
      // AG-UI's `ToolCallResultEvent` carries no `isError` field (verified against the real schema)
      // — a genuine protocol-level fidelity gap, not a translator bug: chat's `isError` flag cannot
      // survive the round trip through AG-UI's wire shape, so it always reconstructs as `false`.
      return [{ kind: "tool_result", toolUseId: event.toolCallId, content: event.content, isError: false }];

    case EventType.RAW:
      return [{ kind: "raw", line: asString(event.event) }];

    case EventType.CUSTOM:
      return translateAgUiCustomEvent(event, state.customEventNames);

    default:
      return [];
  }
}
