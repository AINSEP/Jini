import { defaultFederationMessages } from "../messages.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { connectMcpHttpSession, createFetchMcpHttpExchange } from "../adapter.http.js";
import { McpAuthFailedError, McpProtocolError } from "../mcp-protocol.js";
import { ScriptedMcpHttpExchange } from "../testing/adapter.memory.js";
import { clientInfo } from "./fixtures.js";

const spec = { url: "https://example.invalid/mcp", headers: { Authorization: "Bearer stale" } };
function replies(request: { message?: { method?: string | undefined; id?: number | undefined } | undefined }) {
  if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
  return { body: { jsonrpc: "2.0", id: request.message?.id, result: request.message?.method === "initialize"
    ? { protocolVersion: "2025-06-18", serverInfo: { name: "fixture" } }
    : request.message?.method === "tools/list" ? { tools: [] } : { content: [] } } };
}
test("a required client identity reaches initialization; token supplier refreshes every POST", async () => {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => (replies)(request) });
  let token = 0;
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange, spec, clientInfo, requestTimeoutMs: 1000,
    bearerToken: ({ url }, { signal } = {}) => { assert.equal(url, spec.url); assert.equal(signal?.aborted, false); return `token-${++token}`; },
  });
  await session.listTools();
  await session.callTool({ name: "inspect", arguments: {} });
  assert.deepEqual(exchange.sent.map((request) => request.headers.authorization), ["Bearer token-1", "Bearer token-2", "Bearer token-3", "Bearer token-4"]);
  assert.equal(exchange.sent.every((request) => request.headers.Authorization === undefined), true);
  assert.deepEqual(exchange.sent[0]?.message?.params?.clientInfo, clientInfo);
  assert.deepEqual(spec.headers, { Authorization: "Bearer stale" });
  await session.close({});
});
test("401 challenge is passed to the host once, without a retry; 403 retains generic protocol failure", async () => {
  for (const status of [401, 403]) {
    const challenges: unknown[] = [];
    const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => request.message?.method === "tools/call"
      ? { status, wwwAuthenticate: 'Bearer resource_metadata="https://example.invalid/resource"', body: "" } : replies(request),
    });
    const session = await connectMcpHttpSession({ messages: defaultFederationMessages, exchange, spec, clientInfo, requestTimeoutMs: 1000, bearerToken: () => undefined }, {
      onAuthenticationChallenge: (challenge) => { challenges.push(challenge); },
    });
    await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), (error: unknown) => {
      assert.equal(error instanceof McpProtocolError, true);
      assert.equal(error instanceof McpAuthFailedError, status === 401);
      return true;
    });
    assert.deepEqual(challenges, status === 401 ? [{ url: spec.url, status: 401,
      wwwAuthenticate: 'Bearer resource_metadata="https://example.invalid/resource"' }] : []);
    assert.equal(exchange.sent.filter((request) => request.message?.method === "tools/call").length, 1);
    await session.close({});
  }
});
test("fetch adapter exposes WWW-Authenticate while refusing redirects", async () => {
  let redirect: RequestInit['redirect'];
  let requestOptions: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    redirect = init?.redirect;
    requestOptions = init;
    return new Response("", { status: 401, headers: { "www-authenticate": "Bearer scope=inspect" } });
  };
  const exchange = createFetchMcpHttpExchange({ fetch: fetchImpl });
  const response = await exchange.send({ url: spec.url, method: "POST", headers: {} });
  assert.equal(response.wwwAuthenticate, "Bearer scope=inspect");
  assert.equal(redirect, "error");
  // REGRESSION: fails if createFetchMcpHttpExchange explicitly passes signal: undefined.
  assert.ok(requestOptions);
  assert.equal(Object.hasOwn(requestOptions, "signal"), false);
  const signal = new AbortController().signal;
  await exchange.send({ url: spec.url, method: "POST", headers: {} }, { signal });
  // PARITY
  assert.equal(requestOptions.signal, signal);
});
