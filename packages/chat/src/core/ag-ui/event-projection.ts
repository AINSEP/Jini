/** Pure chat-event to AG-UI projection; lifecycle state belongs to one run.
 * Daemon payloads are reduced to chat events by `run-events` `translateRunAgentPayload`, the one
 * reducer; this file only projects. AG-UI has no standard field for a tool call's display
 * correlation or for a tool result's error flag, media and outcome, so those ride as extra fields
 * under their chat-event names (the official event schemas are passthrough); `event-reduction.ts`
 * reads them back. Strict interruption ordering closes a message before a tool starts. IDs and custom event names
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
  events.push({
    type: EventType.TOOL_CALL_START, toolCallId: event.id, toolCallName: event.name,
    // Which bridge call this row stands for: the transcript matches a repeated call by it, so
    // without these two a client on this wire cannot tell a duplicate from a second call.
    ...(event.toolOrigin !== undefined ? { toolOrigin: event.toolOrigin } : {}),
    ...(event.bridgeCall !== undefined ? { bridgeCall: event.bridgeCall } : {}),
  });
  events.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.id, delta: JSON.stringify(event.input ?? {}) });
  events.push({ type: EventType.TOOL_CALL_END, toolCallId: event.id });
  return events;
}

/** A result's optional fields are written only when set, so a plain successful result is the
 *  standard event and nothing more. `isError` is absent for `false`: a reader takes absence as success. */
function handleToolResultAgentEvent(
  { event, state }: { event: Extract<AgentEvent, { kind: "tool_result" }>; state: AgUiTranslationState },
  _optional: Record<string, never> = {},
): AgUiEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: mintId(state, "tool_result_msg"),
      toolCallId: event.toolUseId,
      content: event.content,
      role: "tool",
      ...(event.isError ? { isError: true } : {}),
      ...(event.media !== undefined ? { media: event.media } : {}),
      ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
    },
  ];
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
      return handleToolResultAgentEvent({ event, state });

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
