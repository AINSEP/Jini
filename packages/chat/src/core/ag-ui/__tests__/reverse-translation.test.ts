import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  closeAgUiRun,
  createAgUiToAgentTranslationState,
  createAgUiTranslationState,
  translateAgentEventToAgUi,
  translateAgUiEventToAgentEvent,
  type AgUiEvent,
} from "../entry.js";
import type { AgentEvent } from "../../events.js";

const NAMES = { usage: "jini.usage", status: "jini.status", extensionPrefix: "jini.ext." };
const forward = () => createAgUiTranslationState({ ids: { next: ({ prefix, ordinal }) => `${prefix}-${ordinal}` }, customEventNames: NAMES });
const reverse = () => createAgUiToAgentTranslationState({ customEventNames: NAMES });
const back = (events: AgUiEvent[], state = reverse()) => events.flatMap(event => translateAgUiEventToAgentEvent({ event, state }));

describe("AG-UI → AgentEvent translation", () => {
  it("round-trips every agent event kind through the AG-UI wire shape", () => {
    const state = forward();
    const events: AgentEvent[] = [
      { kind: "thinking", text: "plan" },
      { kind: "text", text: "Hello" },
      { kind: "thinking", text: "again" },
      { kind: "tool_use", id: "t1", name: "search", input: { q: "x" } },
      { kind: "tool_use", id: "t2", name: "noop" } as AgentEvent,
      { kind: "tool_result", toolUseId: "t1", content: "found", isError: false },
      { kind: "usage", inputTokens: 1, outputTokens: 2 } as AgentEvent,
      { kind: "status", label: "working" } as AgentEvent,
      { kind: "raw", line: "raw line" },
      { kind: "ext", name: "chart", data: { n: 1 } },
    ];
    const wire = [...events.flatMap(event => translateAgentEventToAgUi({ event, state })), ...closeAgUiRun({ state })];
    expect(back(wire)).toEqual([
      { kind: "thinking", text: "plan" },
      { kind: "text", text: "Hello" },
      { kind: "thinking", text: "again" },
      { kind: "tool_use", id: "t1", name: "search", input: { q: "x" } },
      { kind: "tool_use", id: "t2", name: "noop", input: {} },
      { kind: "tool_result", toolUseId: "t1", content: "found", isError: false },
      events[6], events[7],
      { kind: "raw", line: "raw line" },
      { kind: "ext", name: "chart", data: { n: 1 } },
    ]);
  });

  it("keeps a malformed args buffer as raw text and an empty one as {}", () => {
    const wire: AgUiEvent[] = [
      { type: EventType.TOOL_CALL_START, toolCallId: "a", toolCallName: "write" },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: "a", delta: "{\"pa" },
      { type: EventType.TOOL_CALL_END, toolCallId: "a" },
      { type: EventType.TOOL_CALL_START, toolCallId: "b", toolCallName: "ping" },
      { type: EventType.TOOL_CALL_END, toolCallId: "b" },
    ];
    expect(back(wire)).toEqual([
      { kind: "tool_use", id: "a", name: "write", input: "{\"pa" },
      { kind: "tool_use", id: "b", name: "ping", input: {} },
    ]);
  });

  it("ignores args or an end for a call that never started", () => {
    const state = reverse();
    expect(back([{ type: EventType.TOOL_CALL_ARGS, toolCallId: "ghost", delta: "{}" }, { type: EventType.TOOL_CALL_END, toolCallId: "ghost" }], state)).toEqual([]);
    expect(state.toolCalls.size).toBe(0);
  });

  it("maps a foreign custom event to an ext event under its own name and stringifies raw payloads", () => {
    expect(back([
      { type: EventType.CUSTOM, name: "vendor.thing", value: 3 },
      { type: EventType.RAW, event: { a: 1 } },
      { type: EventType.RAW, event: null },
      { type: EventType.TEXT_MESSAGE_START, messageId: "m", role: "assistant" },
    ])).toEqual([
      { kind: "ext", name: "vendor.thing", data: 3 },
      { kind: "raw", line: "{\"a\":1}" },
      { kind: "raw", line: "" },
    ]);
  });

  it("refuses an agent event kind it does not know, naming it", () => {
    expect(() => translateAgentEventToAgUi({ event: { kind: "mystery" } as unknown as AgentEvent, state: forward() }))
      .toThrow('translateAgentEventToAgUi: unhandled AgentEvent.kind {"kind":"mystery"}');
  });
});
