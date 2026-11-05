import assert from "node:assert/strict";
import { test } from "vitest";
import { connectMcpHttpSession } from "../adapter.http.js";
import { defaultFederationMessages } from "../messages.js";
import { McpProtocolError } from "../mcp-protocol.js";
import type { McpHttpExchange, McpHttpResponse } from "../ports.js";
import { ScriptedMcpHttpExchange } from "../testing/adapter.memory.js";
import { clientInfo } from "./fixtures.js";

const CANARY = 'fixture-opaque-"quoted"-\\credential';
const MARKER = "[REDACTED:exact_secret]";
const spec = { url: "https://example.invalid/mcp", headers: { Authorization: `Bearer ${CANARY}` } };

function initialize(id: number | undefined): object {
  return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture" } } };
}

test("HTTP results scrub configured bearer and API-key credentials from text, nested values and keys", async () => {
  for (const headers of [{ Authorization: `Bearer ${CANARY}` }, { "X-Api-Key": CANARY }]) {
    const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
      if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
      if (request.message?.method === "initialize") return { body: initialize(request.message.id) };
      return { body: { jsonrpc: "2.0", id: request.message?.id, result: {
        content: [{ type: "text", text: `echo ${CANARY}; ordinary output` }],
        structuredContent: { nested: [{ credential: CANARY }], [CANARY]: "retained" },
      } } };
    } });
    const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange,
      spec: { ...spec, headers }, clientInfo, requestTimeoutMs: 1000, bearerToken: () => undefined });
    try {
      assert.deepEqual(await session.callTool({ name: "inspect", arguments: {} }), {
        content: [{ type: "text", text: `echo ${MARKER}; ordinary output` }],
        structuredContent: { nested: [{ credential: MARKER }], [MARKER]: "retained" },
        isError: false,
      });
      assert.equal(exchange.sent[2]?.headers[Object.keys(headers)[0]!], Object.values(headers)[0]);
    } finally { await session.close({}); }
  }
});

test("HTTP JSON-RPC error messages scrub the token used for that exchange", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
    if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
    if (request.message?.method === "initialize") return { body: initialize(request.message.id) };
    return { body: { jsonrpc: "2.0", id: request.message?.id, error: { code: -32000, message: `reflected ${CANARY}` } } };
  } });
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange, spec,
    clientInfo, requestTimeoutMs: 1000, bearerToken: () => CANARY });
  try {
    await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), (error: unknown) => {
      assert.ok(error instanceof McpProtocolError);
      assert.equal(error.message.includes(CANARY), false);
      assert.equal(error.message.includes(MARKER), true);
      return true;
    });
  } finally { await session.close({}); }
});

test("short numeric credentials preserve JSON primitives and protocol ids", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
    if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
    if (request.message?.method === "initialize") return { body: initialize(request.message.id) };
    const body = { jsonrpc: "2.0", id: request.message?.id, result: {
      content: [{ type: "text", text: "echo 1" }], structuredContent: { amount: 1, enabled: true, absent: null },
    } };
    return { contentType: "text/event-stream", body: `data: ${JSON.stringify(body)}\n\n` };
  } });
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange,
    spec: { ...spec, headers: { Authorization: "Bearer 1" } }, clientInfo, requestTimeoutMs: 1000, bearerToken: () => undefined });
  try {
    assert.deepEqual(await session.callTool({ name: "inspect", arguments: {} }), {
      content: [{ type: "text", text: `echo ${MARKER}` }],
      structuredContent: { amount: 1, enabled: true, absent: null }, isError: false,
    });
    assert.equal(exchange.sent[2]?.headers["mcp-protocol-version"], "2025-06-18");
  } finally { await session.close({}); }
});

test("transport failures scrub the request's own token before becoming protocol errors", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
    if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
    if (request.message?.method === "initialize") return { body: initialize(request.message.id) };
    throw new Error(`request Authorization: Bearer ${CANARY} failed`);
  } });
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange, spec,
    clientInfo, requestTimeoutMs: 1000, bearerToken: () => CANARY });
  try {
    await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), (error: unknown) => {
      assert.ok(error instanceof McpProtocolError);
      assert.equal(error.message.includes(CANARY), false);
      assert.equal(error.message.includes(MARKER), true);
      return true;
    });
  } finally { await session.close({}); }
});

test("rotating HTTP tokens stay bound to their own out-of-order responses", async () => {
  const pending: Array<{ readonly token: string; readonly respond: () => void }> = [];
  let announce!: () => void;
  const bothPending = new Promise<void>(resolve => { announce = resolve; });
  const exchange: McpHttpExchange = {
    async send(_request, options = {}): Promise<McpHttpResponse> {
      const message = JSON.parse(options.body ?? "{}") as { id?: number; method?: string };
      if (message.method === "notifications/initialized") return { status: 202, contentType: "application/json", text: "" };
      if (message.method === "initialize") return { status: 200, contentType: "application/json", text: JSON.stringify(initialize(message.id)) };
      const token = _request.headers["authorization"]!.slice("Bearer ".length);
      return new Promise(resolve => {
        pending.push({ token, respond: () => resolve({ status: 200, contentType: "application/json", text: JSON.stringify({
          jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `${token}; unchanged` }] },
        }) }) });
        if (pending.length === 2) announce();
      });
    },
  };
  let sequence = 0;
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange,
    spec: { ...spec, headers: {} }, clientInfo, requestTimeoutMs: 1000, bearerToken: () => `fixture-rotated-${++sequence}` });
  try {
    const first = session.callTool({ name: "first", arguments: {} });
    const second = session.callTool({ name: "second", arguments: {} });
    await bothPending;
    assert.notEqual(pending[0]!.token, pending[1]!.token);
    pending[1]!.respond();
    pending[0]!.respond();
    for (const result of await Promise.all([first, second])) {
      assert.deepEqual(result, { content: [{ type: "text", text: `${MARKER}; unchanged` }], structuredContent: undefined, isError: false });
    }
  } finally { await session.close({}); }
});
