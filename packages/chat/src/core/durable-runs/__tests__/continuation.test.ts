import { expect, test } from "vitest";
import type { AgentEvent } from "../../index.js";
import { canonicalToolInput, continuationRequest, hasUnknownToolCall } from "../continuation.js";
import type { DurableRun } from "../ports.js";
import type { AgentPluginChatState } from "../../agent-plugin-chat-state.js";

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

test("an outcome-unknown result does not complete its call, so a repeat stays blocked", () => {
  const events: AgentEvent[] = [
    { kind: "tool_use", id: "lost", name: "content_write", input },
    { kind: "tool_result", toolUseId: "lost", content: "unknown", isError: true, outcome: "unknown" },
  ];
  expect(hasUnknownToolCall({ events, toolId: "content_write", input }, {})).toBe(true);
});

// ---- continuationRequest / canonicalToolInput boundary pins ----

const savedState: AgentPluginChatState = { decision: { selected: ["p1"] }, excluded: [] };
const skipState: AgentPluginChatState = { decision: null, excluded: ["p2"] };

function durableRun(overrides: Partial<DurableRun> = {}, context: Record<string, unknown> = { prompt: "Build it", agentPluginState: savedState, attachmentIds: ["a1"] }): DurableRun {
  return {
    conversationId: "c1", messageId: "m1", runId: "r1", workspaceId: "w1", principalId: "u1", engine: "e",
    message: { id: "m1", role: "assistant", content: "partial text", events: [] },
    request: { agentId: "claude", contextRef: JSON.stringify(context) },
    transcript: [{ id: "t1", role: "user", content: "hello" }, { id: "t2", role: "assistant", content: "hi" }],
    recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: 0, lastProgressAt: 0, cancelReason: null,
    sessionId: "s1", sessionConfirmed: true, child: null, attemptBase: [],
    ...overrides,
  };
}
const contextOf = (run: DurableRun, native = false) => JSON.parse(continuationRequest({ run, native }, {}).contextRef) as Record<string, unknown>;
const pluginEvent = (data: unknown): AgentEvent => ({ kind: "ext", name: "agent_plugins", data });

test("canonicalToolInput sorts object keys at every depth and keeps array order", () => {
  expect(canonicalToolInput({ value: { b: [2, { y: 1, x: null }], a: "s" } }, {})).toBe('{"a":"s","b":[2,{"x":null,"y":1}]}');
});

test("canonicalToolInput renders an unserializable value as null", () => {
  expect(canonicalToolInput({ value: undefined }, {})).toBe("null");
});

test("continuationRequest keeps the accepted request fields and replaces only contextRef", () => {
  const run = durableRun();
  const request = continuationRequest({ run, native: false }, {});
  expect(request.agentId).toBe("claude");
  expect(run.request.contextRef).toBe(JSON.stringify({ prompt: "Build it", agentPluginState: savedState, attachmentIds: ["a1"] }));
});

test("continuationRequest reconstruction mode embeds the transcript, ids and clears attachments", () => {
  const context = contextOf(durableRun());
  expect(context).toMatchObject({ conversationId: "c1", assistantMessageId: "m1", principalId: "u1", recoveryMode: "reconstruction", attachmentIds: [] });
  expect("recoverySessionId" in context).toBe(false);
  expect(context.prompt).toContain("Saved conversation:\nuser: hello\n\nassistant: hi");
  expect(context.prompt).toContain("Accepted task:\nBuild it");
  expect(context.prompt).toContain("Saved partial answer:\npartial text");
});

test("continuationRequest native mode names the session and omits the transcript", () => {
  const context = contextOf(durableRun(), true);
  expect(context).toMatchObject({ recoveryMode: "native", recoverySessionId: "s1" });
  expect(context.prompt).toContain("Native session is confirmed; continue its saved task.");
  expect(context.prompt).not.toContain("Saved conversation:");
});

test("continuationRequest renders a missing accepted prompt as empty text", () => {
  expect(contextOf(durableRun({}, {})).prompt).toContain("Accepted task:\n\n\n");
});

test("continuationRequest omits agentPluginState when neither context nor events carry one", () => {
  expect("agentPluginState" in contextOf(durableRun({}, { prompt: "x" }))).toBe(false);
});

test("continuationRequest keeps the accepted plugin state when the message has no events", () => {
  const run = durableRun({ message: { id: "m1", role: "assistant", content: "" } });
  expect(contextOf(run).agentPluginState).toEqual(savedState);
});

test("continuationRequest takes the latest saved plugin decision for this conversation", () => {
  const events: AgentEvent[] = [
    pluginEvent({ conversationId: "c1", state: savedState, plugins: [] }),
    pluginEvent({ conversationId: "c1", state: skipState, plugins: [] }),
    { kind: "ext", name: "recovery_marker", data: {} },
    { kind: "text", text: "after" },
    pluginEvent(undefined),
    pluginEvent({ conversationId: "other", state: savedState, plugins: [] }),
    pluginEvent({ conversationId: "c1", plugins: [] }),
  ];
  const run = durableRun({ message: { id: "m1", role: "assistant", content: "", events } }, { prompt: "x" });
  expect(contextOf(run).agentPluginState).toEqual(skipState);
});

test("continuationRequest lists tool calls with results, unwrapping delegated calls and flagging unknown outcomes", () => {
  const events: AgentEvent[] = [
    { kind: "tool_use", id: "u1", name: "mcp__jini__execute_delegated_tool", input: { toolId: "save", input: { a: 1 } } },
    { kind: "tool_result", toolUseId: "u1", content: "ok", isError: false },
    { kind: "tool_use", id: "u2", name: "plain", input: null },
  ];
  const prompt = String(contextOf(durableRun({ message: { id: "m1", role: "assistant", content: "", events } })).prompt);
  expect(prompt).toContain(`Saved tool calls and results:\n${JSON.stringify({ call: { toolId: "save", input: { a: 1 } }, result: events[1] })}\n${JSON.stringify({ call: { toolId: "plain", input: null }, result: "OUTCOME UNKNOWN: verify state before repeating" })}`);
});

test("continuationRequest flags a call whose saved result has an unknown outcome", () => {
  const events: AgentEvent[] = [
    { kind: "tool_use", id: "u1", name: "plain", input: null },
    { kind: "tool_result", toolUseId: "u1", content: "lost", isError: true, outcome: "unknown" },
  ];
  const prompt = String(contextOf(durableRun({ message: { id: "m1", role: "assistant", content: "", events } })).prompt);
  expect(prompt).toContain(JSON.stringify({ call: { toolId: "plain", input: null }, result: "OUTCOME UNKNOWN: verify state before repeating" }));
});

test("continuationRequest throws on invalid accepted context JSON", () => {
  expect(() => continuationRequest({ run: durableRun({ request: { contextRef: "{bad" } }), native: false }, {})).toThrow(/JSON/);
});
