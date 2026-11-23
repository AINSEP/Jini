/** AG-UI events back to chat events: the reverse of `event-projection.ts`.
 * Tool-call arguments are accumulated per run; the custom event names are the host's.
 * A tool call's and a tool result's optional fields arrive as extra fields under their chat-event
 * names. They are read by `run-events` `translateRunAgentPayload`, the one reducer, so this wire and
 * the daemon wire accept and ignore exactly the same shapes. */
import { EventType } from '@ag-ui/core';
import { asString, translateRunAgentPayload } from '../run-events/entry.js';
import type { AgUiEvent, CustomEventNames } from './event-projection.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/**
 * Accumulates `TOOL_CALL_ARGS` deltas by `toolCallId` between a call's `TOOL_CALL_START` and
 * `TOOL_CALL_END` — the inverse of `assistant-ag-ui.ts`'s server-side translator, which emits all
 * three tool-call events back-to-back for one chat `tool_use` event today, but this side is written
 * to accumulate real streamed deltas too (a future daemon driver that streams `tool_input_delta`
 * incrementally needs no transport-layer change to render correctly). One instance per run, NOT a
 * module-level singleton — the same reasoning `assistant-ag-ui.ts`'s `AgUiTranslationState` gives.
 */
export interface AgUiToAgentTranslationState {
  toolCalls: Map<string, AgUiOpenToolCall>;
  readonly customEventNames: CustomEventNames;
}

/** One call between its `TOOL_CALL_START` and `TOOL_CALL_END`. `toolOrigin` and `bridgeCall` are
 *  the start event's extra fields as received, not yet checked. */
export interface AgUiOpenToolCall {
  name: string;
  argsJson: string;
  toolOrigin?: unknown;
  bridgeCall?: unknown;
}

export function createAgUiToAgentTranslationState({ customEventNames }: { customEventNames: CustomEventNames }, _options: Record<string, never> = {}): AgUiToAgentTranslationState {
  return { toolCalls: new Map(), customEventNames: { ...customEventNames } };
}

/** The `TOOL_CALL_ARGS` case of {@link translateAgUiEventToAgentEvent} — accumulates one delta onto
 *  the in-flight call's buffer, a silent no-op for an id with no matching `TOOL_CALL_START`. Split
 *  out so this `if` is scored in its own complexity budget rather than the switch's. */
function accumulateToolCallArgs({ toolCallId, delta, state }: {
  toolCallId: string;
  delta: string;
  state: AgUiToAgentTranslationState;
}): void {
  const call = state.toolCalls.get(toolCallId);
  if (call) call.argsJson += delta;
}

/** `TEXT_MESSAGE_START` keeps an explicit step boundary so two assistant messages cannot fuse into
 *  one word; every other unmapped event translates to nothing. Split out so this `if` is scored in
 *  its own complexity budget rather than the switch's. */
function translateAgUiStepStart({ event }: { event: AgUiEvent }, _options = {}): AgentEvent[] {
  if (event.type !== EventType.TEXT_MESSAGE_START) return [];
  return [{ kind: 'status', code: 'step_start', label: '', data: { messageId: event.messageId } }];
}

/** The `TOOL_CALL_END` case of {@link translateAgUiEventToAgentEvent} — parses the accumulated
 *  args buffer (already removed from `state` by the caller) into one `tool_use` event, or `[]` for
 *  an id with no matching `TOOL_CALL_START`. */
function finalizeToolCallAgentEvent({ toolCallId, call }: {
  toolCallId: string;
  call: AgUiOpenToolCall | undefined;
}): AgentEvent[] {
  if (!call) return [];
  let input: unknown = {};
  try {
    input = call.argsJson.length > 0 ? JSON.parse(call.argsJson) : {};
  } catch {
    // A malformed/partial args buffer must not throw and drop the whole tool call — the raw
    // string is still more useful to a human than nothing.
    input = call.argsJson;
  }
  return reduced({ payload: { type: "tool_use", id: toolCallId, name: call.name, input, toolOrigin: call.toolOrigin, bridgeCall: call.bridgeCall } });
}

/** Hands a rebuilt daemon payload to the one reducer; a type it drops yields no event. */
function reduced({ payload }: { payload: { readonly type: string; readonly [key: string]: unknown } }, _options: Record<string, never> = {}): AgentEvent[] {
  const event = translateRunAgentPayload({ payload });
  return event ? [event] : [];
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
 * `TEXT_MESSAGE_START` preserves an explicit step boundary so two assistant messages cannot fuse
 * into one word. End/reasoning markers carry no text. The two cases
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
      state.toolCalls.set(event.toolCallId, { name: event.toolCallName, argsJson: "", toolOrigin: event.toolOrigin, bridgeCall: event.bridgeCall });
      return [];

    case EventType.TOOL_CALL_ARGS:
      accumulateToolCallArgs({ toolCallId: event.toolCallId, delta: event.delta, state });
      return [];

    case EventType.TOOL_CALL_END: {
      const call = state.toolCalls.get(event.toolCallId);
      state.toolCalls.delete(event.toolCallId);
      return finalizeToolCallAgentEvent({ toolCallId: event.toolCallId, call });
    }

    case EventType.TOOL_CALL_RESULT:
      // AG-UI's `ToolCallResultEvent` has no standard `isError`, `media` or `outcome` field. The
      // projection writes them as extra fields; a server that sends none (an older one, or another
      // AG-UI server) reads as a plain successful result, as before.
      return reduced({ payload: { type: "tool_result", toolUseId: event.toolCallId, content: event.content, isError: event.isError, media: event.media, outcome: event.outcome } });

    case EventType.RAW:
      return [{ kind: "raw", line: asString({ value: event.event }) }];

    case EventType.CUSTOM:
      return translateAgUiCustomEvent(event, state.customEventNames);

    default:
      return translateAgUiStepStart({ event });
  }
}
