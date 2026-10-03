import assert from "node:assert/strict";
import { test } from "vitest";

import type { AgentEvent } from '../../events.js';
import { runContentFromEvents as content, runEventsForSave as save, translateRunAgentPayload as payload, translateRunFrame as frame } from '../entry.js';
import { notices } from './fixture.js';
const runContentFromEvents = (events: readonly AgentEvent[]) => content({ events });
const runEventsForSave = (events: readonly AgentEvent[]) => save({ events });
const translateRunAgentPayload = (input: Parameters<typeof payload>[0]['payload']) => payload({ payload: input });
const translateRunFrame = (kind: string, raw: string) => frame({ kind, raw, notices });

function stdoutFrame(lines: readonly unknown[]): string {
  return JSON.stringify({ runId: "r1", kind: "stdout", payload: { chunk: lines.map((l) => `${JSON.stringify(l)}\n`).join("") } });
}

test("translateRunFrame: an api_retry heartbeat becomes a typed status event with the attempt numbers", () => {
  const retry = { type: "system", subtype: "api_retry", attempt: 4, max_retries: 10, retry_delay_ms: 518, error_status: 529, error: "overloaded" };
  const { events } = translateRunFrame("stdout", stdoutFrame([retry]));
  assert.deepEqual(
    events.filter((e) => e.kind === "status"),
    [{ kind: "status", code: "api_retry", label: "api_retry", detail: "529 overloaded", data: { attempt: 4, maxAttempts: 10, service: "Claude" } }],
  );
});

test("translateRunFrame: tool_progress and thinking_tokens heartbeats become status events", () => {
  const progress = { type: "tool_progress", tool_use_id: "t-heartbeat-0", tool_name: "mcp__jini__execute_delegated_tool", parent_tool_use_id: "t", elapsed_time_seconds: 30, heartbeat: true };
  const thinking = { type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50 };
  const { events } = translateRunFrame("stdout", stdoutFrame([progress, thinking]));
  assert.deepEqual(
    events.filter((e) => e.kind === "status"),
    [
      { kind: "status", code: "tool_progress", label: "tool_progress", data: { elapsedSeconds: 30 } },
      { kind: "status", code: "thinking", label: "thinking" },
    ],
  );
});

test("translateRunFrame: stream_event echo lines are dropped from raw; other lines are kept verbatim", () => {
  const delta = { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } };
  const hook = { type: "system", subtype: "hook_started" };
  assert.deepEqual(translateRunFrame("stdout", stdoutFrame([delta])).events, []);
  assert.deepEqual(translateRunFrame("stdout", stdoutFrame([delta, hook])).events, [{ kind: "raw", line: `${JSON.stringify(hook)}\n` }]);
  // A chunk that is not JSON lines (a plain-format CLI) stays one raw event, byte for byte.
  const plain = JSON.stringify({ runId: "r1", kind: "stdout", payload: { chunk: "hello\nworld" } });
  assert.deepEqual(translateRunFrame("stdout", plain).events, [{ kind: "raw", line: "hello\nworld" }]);
});

test("translateRunAgentPayload: tool_input_delta is not kept as an event (it duplicates the tool_use input)", () => {
  assert.equal(translateRunAgentPayload({ type: "tool_input_delta", id: "t", name: "x", delta: "{\"a\"" }), null);
});

test("runContentFromEvents: a working note before a tool call is not glued onto the answer", () => {
  const content = runContentFromEvents([
    { kind: "text", text: "Need project id. Find list_projects." },
    { kind: "tool_use", id: "t1", name: "mcp__supabase__list_projects", input: {} },
    { kind: "tool_result", toolUseId: "t1", content: "[]", isError: false },
    { kind: "text", text: "`test_table` now exists." },
  ]);
  assert.equal(content, "Need project id. Find list_projects.\n\n`test_table` now exists.");
});

test("translateRunFrame: assistant/user message echo lines are dropped from raw, even the head of a line split across chunks", () => {
  // The daemon already turns these into `text`/`thinking`/`tool_use`/`tool_result` events. Kept as raw
  // they stored every tool result twice (a 65 KB post body once as a tool_result, once as raw).
  const assistant = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] }, session_id: "s" };
  const user = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "big" }] } };
  const init = { type: "system", subtype: "init", session_id: "s" };
  assert.deepEqual(translateRunFrame("stdout", stdoutFrame([assistant, init, user])).events, [{ kind: "raw", line: `${JSON.stringify(init)}\n` }]);
  // A 65 KB line arrives over several stdout chunks; its first piece is not valid JSON on its own.
  const head = JSON.stringify({ runId: "r1", kind: "stdout", payload: { chunk: '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t","type":"tool_result","content":"<persisted' } });
  assert.deepEqual(translateRunFrame("stdout", head).events, []);
});

test("runEventsForSave: streamed text deltas are saved as one text event, content unchanged", () => {
  const events = [
    { kind: "text", text: "Checking." },
    { kind: "tool_use", id: "t1", name: "search_tools", input: {} },
    { kind: "tool_result", toolUseId: "t1", content: "ok", isError: false },
    { kind: "text", text: "Here" },
    { kind: "text", text: " are your" },
    { kind: "text", text: " 6 posts." },
    { kind: "usage", outputTokens: 9 },
  ] as const;
  const saved = runEventsForSave(events);
  assert.deepEqual(saved, [
    { kind: "text", text: "Checking." },
    { kind: "tool_use", id: "t1", name: "search_tools", input: {} },
    { kind: "tool_result", toolUseId: "t1", content: "ok", isError: false },
    { kind: "text", text: "Here are your 6 posts." },
    { kind: "usage", outputTokens: 9 },
  ]);
  assert.equal(runContentFromEvents(saved), runContentFromEvents(events));
});
