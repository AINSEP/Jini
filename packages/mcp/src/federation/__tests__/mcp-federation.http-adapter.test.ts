import { defaultFederationMessages } from "../messages.js";
import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { type CapturedHttpRequest, ScriptedMcpHttpExchange, type ScriptedHttpReply } from "../testing/adapter.memory.js";
import { connectMcpHttpSession, createFetchMcpHttpExchange } from "../adapter.http.js";
import { McpAuthFailedError, McpProtocolError } from "../mcp-protocol.js";
import type { McpHttpLaunchSpec } from "../ports.js";

/**
 * @file Tests for the REAL hosted MCP client in `mcp-federation/adapter.http.ts`, driven against
 * `ScriptedMcpHttpExchange` — a fake server, not a fake client.
 *
 * The sibling of `mcp-federation.stdio-adapter.test.ts`, and it carries the same load: no hosted
 * MCP server is reachable from this sandbox, so the only way the production handshake, session
 * handling, SSE framing, pagination and error mapping can mean anything is to run the real code
 * against a scripted transport.
 *
 * The server side misbehaves on purpose throughout — refusing with 401, answering with an
 * unparseable body, issuing a session id that would inject headers, paginating forever, and going
 * silent — because a hosted federated server is by definition one Example does not control, and the
 * token in its `Authorization` header makes getting this wrong expensive.
 */

const SPEC: McpHttpLaunchSpec = {
  url: "https://mcp.example.com/mcp",
  headers: { authorization: "Bearer token-abc" },
};

const INIT_RESULT = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: {} },
  serverInfo: { name: "higgsfield", version: "1.2.0" },
};

const OBJECT_SCHEMA = { type: "object", properties: {} };

const ONE_TOOL = [{ name: "generate_image", description: "d", inputSchema: OBJECT_SCHEMA }];

/** A well-behaved server: answers initialize, the initialized notification, tools/list and
 *  tools/call. Overrides let one test change one thing. */
function politeServer(options: { tools?: unknown[] | undefined; callResult?: unknown | undefined; sessionId?: string | undefined } = {}) {
  return (request: CapturedHttpRequest): ScriptedHttpReply | undefined => {
    const method = request.message?.method;
    if (method === "initialize") {
      return { body: { jsonrpc: "2.0", id: request.message?.id, result: INIT_RESULT }, sessionId: options.sessionId ?? "sess-1" };
    }
    // A notification has no id and, per the spec, gets an empty 202 rather than a JSON-RPC frame.
    if (method === "notifications/initialized") return { status: 202, contentType: "", body: "" };
    if (method === "tools/list") {
      return { body: { jsonrpc: "2.0", id: request.message?.id, result: { tools: options.tools ?? ONE_TOOL } } };
    }
    if (method === "tools/call") {
      return { body: { jsonrpc: "2.0", id: request.message?.id, result: options.callResult ?? { content: [{ type: "text", text: "ok" }] } } };
    }
    if (request.method === "DELETE") return { status: 200, body: "" };
    return undefined;
  };
}

function connect(exchange: ScriptedMcpHttpExchange, requestTimeoutMs = 1_000) {
  return connectMcpHttpSession({ messages: defaultFederationMessages,clientInfo, bearerToken: () => undefined,  exchange, spec: SPEC, requestTimeoutMs });
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

test("the handshake sends initialize first, then notifications/initialized with no id", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  await connect(exchange);

  assert.equal(exchange.sent[0]?.message?.method, "initialize");
  assert.equal(exchange.sent[0]?.message?.jsonrpc, "2.0");
  assert.equal(exchange.sent[1]?.message?.method, "notifications/initialized");
  // MCP requires a notification to carry no id — a server is entitled to reject the session
  // otherwise, so this is a protocol conformance assertion, not a style one.
  assert.equal(exchange.sent[1]?.message?.id, undefined);
});

test("initialize advertises no client capabilities, so the remote may not ask Example to run inference", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  await connect(exchange);

  assert.deepEqual(exchange.sent[0]?.message?.params?.capabilities, {});
});

test("every request carries the operator's configured auth header and both accepted content types", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  const session = await connect(exchange);
  await session.listTools();

  const listRequest = exchange.lastRequestFor({ method: "tools/list" });
  assert.equal(listRequest?.headers.authorization, "Bearer token-abc");
  assert.equal(listRequest?.headers.accept, "application/json, text/event-stream");
  assert.equal(listRequest?.headers["content-type"], "application/json");
});

test("a failed handshake rejects rather than returning a half-built session", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) =>
      request.message?.method === "initialize"
        ? { body: { jsonrpc: "2.0", id: request.message.id, error: { code: -32000, message: "no" } } }
        : { status: 200, body: "" },
  });

  await assert.rejects(connect(exchange), /remote returned JSON-RPC error -32000: no/);
});

// ---------------------------------------------------------------------------
// Session id — the header-injection surface
// ---------------------------------------------------------------------------

test("the session id the server issues at initialize is echoed on every later request", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer({ sessionId: "sess-xyz" }))(request) });
  const session = await connect(exchange);
  await session.listTools();

  assert.equal(exchange.lastRequestFor({ method: "tools/list" })?.headers["mcp-session-id"], "sess-xyz");
});

test("a server that issues no session id gets no session header back, rather than an empty one", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      const polite = politeServer()(request);
      if (request.message?.method === "initialize") return { ...polite, sessionId: undefined };
      return polite;
    },
  });
  const session = await connect(exchange);
  await session.listTools();

  assert.equal(exchange.lastRequestFor({ method: "tools/list" })?.headers["mcp-session-id"], undefined);
});

test("a session id containing CRLF is refused — it would inject headers into every later request", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer({ sessionId: "abc\r\nX-Injected: yes" }))(request) });

  await assert.rejects(
    connect(exchange),
    /the server issued an Mcp-Session-Id containing characters that are not safe to send back/,
  );
});

test("a session id containing a space is refused too — the spec's own visible-ASCII rule", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer({ sessionId: "has space" }))(request) });

  await assert.rejects(connect(exchange), /Mcp-Session-Id containing characters that are not safe/);
});

// ---------------------------------------------------------------------------
// The two response modes a server may choose between
// ---------------------------------------------------------------------------

test("a plain application/json response is read", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  const session = await connect(exchange);

  const tools = await session.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["generate_image"],
  );
});

test("an SSE-framed response carries the same frame and is read identically", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method !== "tools/list") return politeServer()(request);
      const frame = JSON.stringify({ jsonrpc: "2.0", id: request.message.id, result: { tools: ONE_TOOL } });
      return { contentType: "text/event-stream", body: `event: message\ndata: ${frame}\n\n` };
    },
  });
  const session = await connect(exchange);

  const tools = await session.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["generate_image"],
  );
});

test("an SSE payload split across several data: lines is rejoined before parsing", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method !== "tools/list") return politeServer()(request);
      const frame = JSON.stringify({ jsonrpc: "2.0", id: request.message.id, result: { tools: ONE_TOOL } });
      const half = Math.floor(frame.length / 2);
      return { contentType: "text/event-stream", body: `data: ${frame.slice(0, half)}\ndata: ${frame.slice(half)}\n\n` };
    },
  });
  const session = await connect(exchange);

  // The SSE spec joins multi-line data with newlines, and JSON tolerates newlines between tokens,
  // so a server splitting a long frame this way must still round-trip.
  const tools = await session.listTools();
  assert.equal(tools.length, 1);
});

test("a charset parameter on the SSE content type does not defeat the match", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method !== "tools/list") return politeServer()(request);
      const frame = JSON.stringify({ jsonrpc: "2.0", id: request.message.id, result: { tools: ONE_TOOL } });
      return { contentType: "text/event-stream; charset=utf-8", body: `data: ${frame}\n\n` };
    },
  });
  const session = await connect(exchange);

  assert.equal((await session.listTools()).length, 1);
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("a paginated tools/list is drained across pages and the cursor is sent back", async () => {
  const pages = new Map<string | undefined, ScriptedHttpReply["body"]>();
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method !== "tools/list") return politeServer()(request);
      const cursor = request.message.params?.cursor as string | undefined;
      const id = request.message.id;
      if (cursor === undefined) {
        return { body: { jsonrpc: "2.0", id, result: { tools: [{ name: "a", inputSchema: OBJECT_SCHEMA }], nextCursor: "page-2" } } };
      }
      pages.set(cursor, true);
      return { body: { jsonrpc: "2.0", id, result: { tools: [{ name: "b", inputSchema: OBJECT_SCHEMA }] } } };
    },
  });
  const session = await connect(exchange);

  const tools = await session.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["a", "b"],
  );
  assert.ok(pages.has("page-2"), "the second page was requested with the cursor the server returned");
});

test("a server that paginates forever is abandoned rather than followed", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method !== "tools/list") return politeServer()(request);
      return {
        body: { jsonrpc: "2.0", id: request.message.id, result: { tools: [{ name: "a", inputSchema: OBJECT_SCHEMA }], nextCursor: "always" } },
      };
    },
  });
  const session = await connect(exchange);

  await assert.rejects(session.listTools(), /kept returning a tools\/list nextCursor past 20 pages/);
});

// ---------------------------------------------------------------------------
// Hostile and broken responses
// ---------------------------------------------------------------------------

test("a 401 names the real cause — the authorization expired — and points at the fix", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { status: 401, body: "" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  await assert.rejects(
    session.listTools(),
    (error: unknown) => {
      assert.ok(error instanceof McpAuthFailedError);
      assert.match(error.message, /refused 'tools\/list' with 401 — its authorization has expired or been revoked; ask the administrator to reconnect this connection/);
      return true;
    },
  );
});

test("a tools/call 401 retains the auth-failure class used by the reauthorization hook", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => request.message?.method === "tools/call" ? { status: 401, body: "" } : politeServer()(request),
  });
  const session = await connect(exchange);
  await assert.rejects(session.callTool({ name: "generate_image", arguments: { prompt: "x" } }), (error: unknown) => {
    assert.ok(error instanceof McpAuthFailedError);
    assert.match(error.message, /refused 'tools\/call' with 401/);
    return true;
  });
});

test("a 403 is reported as a protocol error, NOT an authorization failure — a scoped token is not a stale one", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { status: 403, body: "" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  await assert.rejects(
    session.listTools(),
    (error: unknown) =>
      error instanceof McpProtocolError &&
      !(error instanceof McpAuthFailedError) &&
      error.message === "mcp-federation: the server answered 'tools/list' with HTTP 403",
  );
});

test("a 500 is reported as a status, NOT as an authorization problem", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { status: 500, body: "" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  // The distinction matters to an operator: reconnecting fixes a 401 and does nothing for a 500.
  await assert.rejects(session.listTools(), /the server answered 'tools\/list' with HTTP 500/);
});

test("a body that is not JSON is refused rather than surfaced as a result", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { body: "<html>gateway error</html>" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  await assert.rejects(session.listTools(), /response to 'tools\/list' was not valid JSON/);
});

test("an empty body where a frame was required is refused", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { body: "" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  await assert.rejects(session.listTools(), /response to 'tools\/list' carried no JSON-RPC message/);
});

test("an SSE stream with no data: line at all is refused", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) =>
      request.message?.method === "tools/list" ? { contentType: "text/event-stream", body: ": keep-alive\n\n" } : politeServer()(request),
  });
  const session = await connect(exchange);

  await assert.rejects(session.listTools(), /carried no JSON-RPC message/);
});

test("an oversized body is refused before it is parsed", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? { body: "x".repeat(4 * 1024 * 1024 + 1) } : politeServer()(request)),
  });
  const session = await connect(exchange);

  await assert.rejects(session.listTools(), /exceeded 4194304 bytes/);
});

test("a successful hosted call sends the remote name and arguments and returns the complete result", async () => {
  const expected = {
    content: [{ type: "text", text: "generated image" }],
    structuredContent: { assetId: "asset-1" },
    isError: false,
  };
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer({ callResult: expected, sessionId: "sess-call" }))(request) });
  const session = await connect(exchange);
  const result = await session.callTool({ name: "generate_image", arguments: { prompt: "x" } });
  const sent = exchange.lastRequestFor({ method: "tools/call" });
  assert.ok(sent);
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, SPEC.url);
  assert.deepEqual(sent.message?.params, { name: "generate_image", arguments: { prompt: "x" } });
  assert.equal(sent.headers.authorization, "Bearer token-abc");
  assert.equal(sent.headers["mcp-session-id"], "sess-call");
  assert.deepEqual(result, expected);
});

test("a JSON-RPC error frame becomes a protocol error carrying the remote's own code and message", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) =>
      request.message?.method === "tools/call"
        ? { body: { jsonrpc: "2.0", id: request.message.id, error: { code: -32602, message: "unknown tool" } } }
        : politeServer()(request),
  });
  const session = await connect(exchange);

  await assert.rejects(session.callTool({ name: "nope", arguments: {} }), /remote returned JSON-RPC error -32602: unknown tool/);
});

// ---------------------------------------------------------------------------
// Timeouts and abort
// ---------------------------------------------------------------------------

test("a server that never answers is abandoned at the timeout rather than awaited forever", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/list" ? undefined : politeServer()(request)),
  });
  const session = await connect(exchange, 25);

  await assert.rejects(session.listTools(), /the request timed out after 25ms/);
});

test("a caller's own abort signal cancels the call, and is reported as an abort not a timeout", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/call" ? undefined : politeServer()(request)),
  });
  const session = await connect(exchange, 5_000);

  const controller = new AbortController();
  const pending = session.callTool({ name: "generate_image", arguments: {} }, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending, /the request was aborted/);
});

test("a signal that is already aborted before the call starts aborts it immediately, without waiting for a later abort event", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.message?.method === "tools/call" ? undefined : politeServer()(request)),
  });
  const session = await connect(exchange, 5_000);

  const controller = new AbortController();
  controller.abort();
  const pending = session.callTool({ name: "generate_image", arguments: {} }, { signal: controller.signal });

  await assert.rejects(pending, /the request was aborted/);
});

test("a raw transport failure (not a timeout or an abort) is reported as a request failure, carrying the underlying Error's message", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.message?.method === "tools/list") throw new Error("ECONNREFUSED: connection refused");
      return politeServer()(request);
    },
  });
  const session = await connect(exchange, 5_000);

  await assert.rejects(session.listTools(), /the request failed — ECONNREFUSED: connection refused/);
});

test("a raw transport failure that throws a non-Error value still produces a readable message, via String()", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- deliberate: a hostile or
      // broken transport is not obligated to reject with a real Error, and this is exactly the
      // non-Error shape `buildPostFailureError`'s `String(error)` fallback exists to handle.
      if (request.message?.method === "tools/list") throw "raw-transport-failure";
      return politeServer()(request);
    },
  });
  const session = await connect(exchange, 5_000);

  await assert.rejects(session.listTools(), /the request failed — raw-transport-failure/);
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

test("close tells the server to drop the session, carrying the id it issued", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer({ sessionId: "sess-close" }))(request) });
  const session = await connect(exchange);

  await session.close({});

  const deleteRequest = exchange.sent.at(-1);
  assert.equal(deleteRequest?.method, "DELETE");
  assert.equal(deleteRequest?.headers["mcp-session-id"], "sess-close");
});

test("a server that refuses the shutdown DELETE does not make close throw", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => (request.method === "DELETE" ? { status: 405, body: "" } : politeServer()(request)),
  });
  const session = await connect(exchange);

  // The spec explicitly allows a server to refuse session termination. Tidying up must not throw.
  await session.close({});
});

test("close does not throw when the DELETE fails at the transport level, not just with a refusal status", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.method === "DELETE") throw new Error("network down");
      return politeServer()(request);
    },
  });
  const session = await connect(exchange);

  await assert.doesNotReject(session.close({}));
});

test("a failed handshake that already had a session id issued still cleans it up, even when the cleanup DELETE itself fails", async () => {
  const exchange = new ScriptedMcpHttpExchange({
    respond: ({ request }) => {
      if (request.method === "DELETE") throw new Error("network down");
      if (request.message?.method === "initialize") {
        return { body: { jsonrpc: "2.0", id: request.message.id, error: { code: -32000, message: "no" } }, sessionId: "sess-doomed" };
      }
      return politeServer()(request);
    },
  });

  // The original handshake failure must win — a failed best-effort cleanup must not replace or
  // swallow it.
  await assert.rejects(connect(exchange), /remote returned JSON-RPC error -32000: no/);
  const deletes = exchange.sent.filter((request) => request.method === "DELETE");
  assert.equal(deletes.length, 1, "the issued remote session must be cleaned up once");
  assert.equal(deletes[0]?.headers["mcp-session-id"], "sess-doomed");
});

test("a closed session refuses further calls instead of reopening one", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  const session = await connect(exchange);
  await session.close({});

  await assert.rejects(session.listTools(), /session is closed/);
});

test("close is idempotent — a second call issues no second DELETE", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (politeServer())(request) });
  const session = await connect(exchange);

  await session.close({});
  const afterFirst = exchange.sent.length;
  await session.close({});

  assert.equal(exchange.sent.length, afterFirst);
});

// ---------------------------------------------------------------------------
// The production fetch exchange
// ---------------------------------------------------------------------------

test("the fetch exchange refuses to follow redirects, so a bearer token is never re-sent to a host the server nominated", async () => {
  let seenInit: RequestInit | undefined;
  const exchange = createFetchMcpHttpExchange({ fetch: (async (_url: string, init: RequestInit) => {
    seenInit = init;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch });

  await exchange.send({ url: SPEC.url, method: "POST", headers: { authorization: "Bearer t" } }, { body: "{}" });

  assert.equal(seenInit?.redirect, "error");
});

test("the fetch exchange lowercases the content type and surfaces the session id header", async () => {
  const exchange = createFetchMcpHttpExchange({ fetch: (async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "TEXT/EVENT-STREAM; charset=UTF-8", "mcp-session-id": "s-1" },
    })) as unknown as typeof fetch });

  const response = await exchange.send({ url: SPEC.url, method: "POST", headers: {} }, { body: "{}" });

  assert.equal(response.contentType, "text/event-stream; charset=utf-8");
  assert.equal(response.sessionId, "s-1");
});

test("the fetch exchange sends no body on a DELETE", async () => {
  let seenInit: RequestInit | undefined;
  const exchange = createFetchMcpHttpExchange({ fetch: (async (_url: string, init: RequestInit) => {
    seenInit = init;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch });

  await exchange.send({ url: SPEC.url, method: "DELETE", headers: {} });

  assert.equal(seenInit?.method, "DELETE");
  assert.equal(seenInit?.body, undefined);
});
