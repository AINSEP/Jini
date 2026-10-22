import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { InMemoryMcpSession, ScriptedMcpHttpExchange, ScriptedMcpStdioChannel } from "../testing/adapter.memory.js";
import type { RemoteToolResult } from "../ports.js";

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

test("InMemoryMcpSession passes cancellation to the injected remote and closes through the canonical ABI", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const remoteStarted = new Promise<void>(resolve => { started = resolve; });
  const session = new InMemoryMcpSession({ tools: [] }, {
    onCall: ({ name, args }, { signal } = {}) => {
      started();
      assert.equal(name, "list_tables");
      assert.deepEqual(args, { schemas: ["public"] });
      assert.equal(signal, controller.signal);
      return new Promise<RemoteToolResult>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("remote call aborted")), { once: true });
      });
    },
  });
  const pending = session.callTool({ name: "list_tables", arguments: { schemas: ["public"] } }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { message: "remote call aborted" });
  try {
    await Promise.race([remoteStarted, rejected]);
    controller.abort();
    await rejected;
    assert.deepEqual(session.calls, [{ name: "list_tables", arguments: { schemas: ["public"] } }]);
  } finally {
    controller.abort();
    await session.close({});
  }
  assert.equal(session.closed, true);
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

test("ScriptedMcpHttpExchange: a reply with no body serializes as an empty JSON object with the default status and type", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: () => ({}) });
  const response = await exchange.send({ url: "https://example.invalid/mcp", method: "POST", headers: {} }, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.deepEqual(response, { status: 200, contentType: "application/json", text: "{}" });
});

test("ScriptedMcpHttpExchange: a server that never answers stays pending forever when the client passes no abort signal", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: () => undefined });
  const pending = exchange.send({ url: "https://example.invalid/mcp", method: "DELETE", headers: {} });
  const outcome = await Promise.race([pending.then(() => "settled", () => "rejected"), new Promise(resolve => setTimeout(() => resolve("still pending"), 20))]);
  assert.equal(outcome, "still pending");
  assert.equal(exchange.sent[0]?.message, undefined, "a bodyless request is captured without a JSON-RPC frame");
});

test("ScriptedMcpHttpExchange: lastRequestFor returns the most recent matching request, or undefined when none matched", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: () => ({ body: "" }) });
  for (const id of [1, 2]) await exchange.send({ url: "https://example.invalid/mcp", method: "POST", headers: {} }, { body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }) });
  assert.equal(exchange.lastRequestFor({ method: "tools/list" })?.message?.id, 2);
  assert.equal(exchange.lastRequestFor({ method: "tools/call" }), undefined);
});
