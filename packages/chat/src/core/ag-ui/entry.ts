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
