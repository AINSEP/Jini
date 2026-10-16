import { expect, test } from "vitest";
import type { AgentEvent } from "../../index.js";
import { hasUnknownToolCall } from "../continuation.js";

const input = { type: "menu", id: "main" };

test.each(["execute_readonly_delegated_tool", "mcp__jini__execute_readonly_delegated_tool"])(
  "read-only wrapper %s never implies an unknown mutation, with or without a result", (name) => {
    const call: AgentEvent = { kind: "tool_use", id: "readonly", name, input: { toolId: "content_read", input } };
    for (const events of [[call], [call, { kind: "tool_result", toolUseId: "readonly", content: "refused", isError: true }]] as AgentEvent[][]) {
      expect(hasUnknownToolCall({ events, toolId: "content_read", input }, {})).toBe(false);
    }
  },
);

test.each(["content_read", "execute_delegated_tool", "mcp__jini__execute_delegated_tool"])(
  "an unanswered mutation %s still blocks after a read-only refusal", (name) => {
    const events: AgentEvent[] = [
      { kind: "tool_use", id: "readonly", name: "execute_readonly_delegated_tool", input: { toolId: "content_read", input } },
      { kind: "tool_result", toolUseId: "readonly", content: "refused", isError: true },
      { kind: "tool_use", id: "mutation", name, input: name === "content_read" ? input : { toolId: "content_read", input } },
    ];
    expect(hasUnknownToolCall({ events, toolId: "content_read", input: { id: "main", type: "menu" } }, {})).toBe(true);
    expect(hasUnknownToolCall({ events, toolId: "other", input }, {})).toBe(false);
    expect(hasUnknownToolCall({ events, toolId: "content_read", input: {} }, {})).toBe(false);
    events.push({ kind: "tool_result", toolUseId: "mutation", content: "done", isError: false });
    expect(hasUnknownToolCall({ events, toolId: "content_read", input }, {})).toBe(false);
  },
);
