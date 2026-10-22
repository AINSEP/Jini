import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { ScriptedMcpStdioChannel, type CapturedRpcMessage } from "../testing/adapter.memory.js";
import { connectMcpStdioSession, spawnMcpStdioChannel } from "../stdio/adapter.stdio.js";

/**
 * @file Tests for the REAL MCP client in `mcp-federation/adapter.stdio.ts`, driven against
 * `ScriptedMcpStdioChannel` — a fake pipe, not a fake client.
 *
 * This is the file that makes the "no live Supabase project is available in this sandbox"
 * constraint survivable. The production handshake, id correlation, pagination, timeout and
 * shutdown logic are all under test here; only the bytes underneath them are simulated. A test
 * that stubbed `McpSessionPort` instead would have proved that the stub works.
 *
 * The server side is scripted to misbehave on purpose — replying late, replying twice, never
 * replying, paginating forever, sending an unsolicited request, emitting non-JSON banner noise, and
 * dying mid-flight — because a federated server is by definition one Example does not control.
 */

const INIT_RESULT = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: {} },
  serverInfo: { name: "supabase", version: "0.9.0" },
};

const OBJECT_SCHEMA = { type: "object", properties: {} };

/** A well-behaved server: replies to `initialize`, `tools/list` and `tools/call`. */
function politeServer(options: { tools?: unknown[] | undefined; callResult?: unknown | undefined } = {}) {
  return (message: CapturedRpcMessage): unknown => {
    if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: INIT_RESULT };
    if (message.method === "tools/list") {
      return { jsonrpc: "2.0", id: message.id, result: { tools: options.tools ?? [{ name: "list_tables", description: "d", inputSchema: OBJECT_SCHEMA }] } };
    }
    if (message.method === "tools/call") {
      return { jsonrpc: "2.0", id: message.id, result: options.callResult ?? { content: [{ type: "text", text: "ok" }] } };
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

test("the handshake sends initialize first, then notifications/initialized with no id", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  assert.equal(channel.sent[0]?.method, "initialize");
  assert.equal(channel.sent[0]?.jsonrpc, "2.0");
  assert.equal(channel.sent[1]?.method, "notifications/initialized");
  // MCP requires a notification to carry no id — a server is entitled to reject the session
  // otherwise, so this is a protocol conformance assertion, not a style one.
  assert.equal(channel.sent[1]?.id, undefined);
});

test("initialize advertises no client capabilities, so the remote may not ask Example to do anything", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  // Notably this means no `sampling`, which would otherwise let a remote drive model inference on
  // Example's account.
  assert.deepEqual(channel.sent[0]?.params?.capabilities, {});
});

test("a server that never answers initialize fails the connect rather than hanging, and the channel is closed", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: () => undefined });

  await assert.rejects(() => connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 40 }), /timed out after 40ms/);
  // The child process equivalent must not be left parented to the daemon.
  assert.notEqual(channel.closedReason, null);
});

test("a server that rejects initialize with a JSON-RPC error surfaces that error", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => ({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "bad access token" } }) });

  await assert.rejects(() => connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 500 }), /JSON-RPC error -32000: bad access token/);
});

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

test("tools/list is drained across cursor pagination", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => {
      if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: INIT_RESULT };
      if (message.method !== "tools/list") return undefined;
      const cursor = message.params?.cursor;
      if (cursor === undefined) {
        return { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "a", inputSchema: OBJECT_SCHEMA }], nextCursor: "page-2" } };
      }
      if (cursor === "page-2") {
        return { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "b", inputSchema: OBJECT_SCHEMA }], nextCursor: "page-3" } };
      }
      return { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "c", inputSchema: OBJECT_SCHEMA }] } };
    } });

  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });
  const tools = await session.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["a", "b", "c"],
  );
});

test("a server paginating forever is cut off rather than spinning the daemon's boot", async () => {
  let page = 0;
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => {
      if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: INIT_RESULT };
      if (message.method !== "tools/list") return undefined;
      page += 1;
      return { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: `t${page}`, inputSchema: OBJECT_SCHEMA }], nextCursor: `page-${page}` } };
    } });

  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });
  await assert.rejects(() => session.listTools(), /kept returning a tools\/list nextCursor/);
  assert.ok(page <= 21, `pagination should be bounded, followed ${page} pages`);
});

test("annotations are carried through verbatim, so the trust tier can see what the remote claimed", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer({
      tools: [{ name: "execute_sql", inputSchema: OBJECT_SCHEMA, annotations: { readOnlyHint: true, destructiveHint: true, title: "Execute SQL" } }],
    }))(message) });

  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });
  const [tool] = await session.listTools();

  assert.deepEqual(tool?.annotations, { title: "Execute SQL", readOnlyHint: true, destructiveHint: true, idempotentHint: undefined, openWorldHint: undefined });
});

test("a malformed tool entry is dropped without costing the operator every other tool on the server", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer({
      tools: [{ name: "good", inputSchema: OBJECT_SCHEMA }, { description: "no name at all" }, null, 42, { name: "", inputSchema: OBJECT_SCHEMA }],
    }))(message) });

  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });
  const tools = await session.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["good"],
  );
});

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

test("tools/call sends the remote's own name and arguments, and returns its content", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer({ callResult: { content: [{ type: "text", text: "rows" }], isError: false } }))(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  const result = await session.callTool({ name: "list_tables", arguments: { schemas: ["public"] } });

  const call = channel.sent.find((message) => message.method === "tools/call");
  assert.equal(call?.params?.name, "list_tables");
  assert.deepEqual(call?.params?.arguments, { schemas: ["public"] });
  assert.deepEqual(result.content, [{ type: "text", text: "rows" }]);
  assert.equal(result.isError, false);
});

test("a remote's own isError claim is reported, not swallowed", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer({ callResult: { content: [{ type: "text", text: "boom" }], isError: true } }))(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  assert.equal((await session.callTool({ name: "list_tables", arguments: {} })).isError, true);
});

test("an aborted call rejects instead of leaving the caller waiting on a remote that may never answer", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (message.method === "initialize" ? { jsonrpc: "2.0", id: message.id, result: INIT_RESULT } : undefined) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 5_000 });

  const controller = new AbortController();
  const pending = session.callTool({ name: "list_tables", arguments: {} }, { signal: controller.signal });
  controller.abort();

  await assert.rejects(() => pending, /was aborted/);
});

// ---------------------------------------------------------------------------
// Correlation and timeouts — the cases a hostile or broken server creates
// ---------------------------------------------------------------------------

test("a late reply to a timed-out request never resolves a different, later call", async () => {
  // The correlation bug this guards: request 2 times out; the server answers it much later; if the
  // client had not forgotten id 2, that stale answer could settle whatever is waiting next.
  const abandoned: CapturedRpcMessage[] = [];
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => {
      if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: INIT_RESULT };
      if (message.method !== "tools/call") return undefined;
      // Hold both calls so the stale response arrives while the newer one is pending.
      abandoned.push(message);
      return undefined;
    } });

  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 30 });
  await assert.rejects(() => session.callTool({ name: "slow", arguments: {} }), /timed out/);

  const staleId = abandoned[0]?.id;
  assert.equal(typeof staleId, "number");

  // The server finally answers the abandoned id, claiming a wildly different result — and does so
  // while a genuine second call is already pending.
  const pending = session.callTool({ name: "fast", arguments: {} });
  const currentId = abandoned[1]?.id;
  assert.equal(typeof currentId, 'number');
  assert.notEqual(currentId, staleId);
  channel.deliver({ message: { jsonrpc: "2.0", id: staleId, result: { content: [{ type: "text", text: "STALE" }] } } });
  channel.deliver({ message: { jsonrpc: '2.0', id: currentId, result: { content: [{ type: 'text', text: 'CORRECT' }] } } });

  const result = await pending;
  assert.deepEqual(result.content, [{ type: "text", text: "CORRECT" }], "the stale reply must not have settled this call");
});

test("a duplicate reply to an already-settled id is ignored rather than throwing", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  await session.callTool({ name: "list_tables", arguments: {} });
  const callId = channel.idFor({ method: "tools/call" });
  assert.doesNotThrow(() => channel.deliver({ message: { jsonrpc: "2.0", id: callId, result: { content: "again" } } }));
});

test("non-JSON banner noise on the stream is dropped, not treated as a protocol failure", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  assert.doesNotThrow(() => channel.deliver({ message: "Supabase MCP server starting up..." }));
  assert.doesNotThrow(() => channel.deliver({ message: "{not json at all" }));

  // The session still works afterwards.
  assert.deepEqual((await session.listTools()).map((tool) => tool.name), ["list_tables"]);
});

test("the channel dying mid-flight rejects every in-flight request instead of hanging forever", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (message.method === "initialize" ? { jsonrpc: "2.0", id: message.id, result: INIT_RESULT } : undefined) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 10_000 });

  const first = session.callTool({ name: "a", arguments: {} });
  const second = session.callTool({ name: "b", arguments: {} });
  channel.fail({ reason: "child process exited (code=1, signal=null)" });

  await assert.rejects(() => first, /session closed before the request completed/);
  await assert.rejects(() => second, /session closed before the request completed/);
  // And a request made after the close fails fast rather than being written to a dead pipe.
  await assert.rejects(() => session.callTool({ name: "c", arguments: {} }), /session is closed/);
});

// ---------------------------------------------------------------------------
// Server-to-client traffic — what a remote may and may not ask for
// ---------------------------------------------------------------------------

test("an unsolicited server request (sampling/createMessage) is refused with method-not-found, never honoured", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  // The escalation attempt: the remote asks Example to run model inference on its behalf.
  channel.deliver({ message: { jsonrpc: "2.0", id: 77, method: "sampling/createMessage", params: { messages: [] } } });
  await Promise.resolve();

  const refusal = channel.sent.find((message) => message.id === 77);
  assert.equal(refusal?.error?.code, -32601);
  assert.match(String(refusal?.error?.message), /not supported by this client/);
});

test("a tools/list_changed notification is ignored — the admitted set is frozen at connect (trust.ts R5)", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });
  const before = channel.sent.length;

  // The rug-pull attempt: the server announces a changed surface after being vetted.
  channel.deliver({ message: { jsonrpc: "2.0", method: "notifications/tools/list_changed" } });
  await Promise.resolve();

  // No re-listing, no reply, no crash — the notification is inert.
  assert.equal(channel.sent.length, before);
  assert.ok(session);
});

test("close() shuts the channel down and makes further calls fail fast", async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => (politeServer())(message) });
  const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 1_000 });

  await session.close({});

  assert.equal(channel.closedReason, "closed by the host");
  await assert.rejects(() => session.callTool({ name: "x", arguments: {} }), /session is closed/);
});

test('real stdout framing reassembles a split reply and drains two replies in one write', { timeout: 5000 }, async () => {
  const script = `
    const readline = require('node:readline');
    const replies = [];
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        const reply = JSON.stringify({ jsonrpc: '2.0', id: message.id, result: ${JSON.stringify(INIT_RESULT)} });
        process.stdout.write('  ' + reply.slice(0, 30));
        setTimeout(() => process.stdout.write(reply.slice(30) + ' \\r\\n'), 30);
      } else if (message.method === 'tools/call') {
        replies.push(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: message.params.name }] } }));
        if (replies.length === 2) process.stdout.write('\\n  ' + replies[0] + ' \\n\\t' + replies[1] + '\\r\\n');
      }
    });
  `;
  const channel = spawnMcpStdioChannel({ messages: federationMessages, command: process.execPath, args: ['-e', script], env: {}, launchEnv: {} });
  try {
    const session = await connectMcpStdioSession({clientInfo, messages: federationMessages,  channel, requestTimeoutMs: 2000 });
    const results = await Promise.all([
      session.callTool({ name: 'first', arguments: {} }),
      session.callTool({ name: 'second', arguments: {} }),
    ]);
    assert.deepEqual(results.map((result) => result.content), [
      [{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }],
    ]);
  } finally {
    channel.close({});
  }
});

test('real stdout framing closes on an unterminated message over the 4 MiB cap', { timeout: 5000 }, async () => {
  const channel = spawnMcpStdioChannel({ messages: federationMessages, command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1)); setInterval(() => {}, 1000);"], env: {}, launchEnv: {} });
  try {
    const reason = await new Promise<string>((resolve) => channel.onClose({ listener: ({ reason }) => (resolve)(reason) }));
    assert.equal(reason, 'inbound message exceeded the size cap');
    assert.throws(() => channel.send({ message: '{}' }), /closed stdio channel/);
  } finally {
    channel.close({});
  }
});
