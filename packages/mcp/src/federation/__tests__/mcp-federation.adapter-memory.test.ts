import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { InMemoryMcpSession, ScriptedMcpStdioChannel } from "../testing/adapter.memory.js";

/**
 * @file Direct tests for the federation test doubles themselves (`adapter.memory.ts`), not through
 * a consumer. Every existing caller (`mcp-federation.registrations.test.ts`,
 * `mcp-federation.stdio-adapter.test.ts`) always supplies its own `onCall`/scripts every scenario
 * it needs, so a handful of the doubles' own documented fallback/guard behaviors were never
 * exercised by any of them — this file exists to close exactly those, independent of any specific
 * consumer's usage pattern (the right way to test a fixture: prove the fixture behaves as
 * documented, not just that some consumer happens to work).
 */

test("InMemoryMcpSession: with no onCall supplied, callTool falls back to echoing the call back as text", async () => {
  const session = new InMemoryMcpSession({ tools: [] });
  const result = await session.callTool({ name: "some_tool", arguments: { a: 1 } });
  assert.deepEqual(result, { content: [{ type: "text", text: 'called some_tool with {"a":1}' }] });
});

test("ScriptedMcpStdioChannel: send() after close() throws, rather than silently accepting a message on a dead channel", () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: () => undefined });
  channel.close({});
  assert.throws(() => channel.send({ message: JSON.stringify({ jsonrpc: "2.0", method: "ping" }) }), /scripted channel is closed/);
});

test("ScriptedMcpStdioChannel: fail() is idempotent — a second call does not re-notify close listeners or overwrite the first reason", () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: () => undefined });
  const reasons: string[] = [];
  channel.onClose({ listener: ({ reason }) => reasons.push(reason) });

  channel.fail({ reason: "first failure" });
  channel.fail({ reason: "second failure" });

  assert.deepEqual(reasons, ["first failure"], "the close listener must fire exactly once, with the FIRST reason");
  assert.equal(channel.closedReason, "first failure");
});

test("ScriptedMcpStdioChannel: idFor returns undefined for a method the client never sent", () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: () => undefined });
  channel.send({ message: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.equal(channel.idFor({ method: "tools/call" }), undefined);
});
