import { expect, it, vi } from "vitest";
import type { HttpFetchPort } from "@jini-ai/core/contracts/runtime";
import type { TextReadOptions } from "@jini-ai/core/net";
import { createFetchMcpHttpExchange } from "../adapter.http.js";
import { McpProtocolError } from "../mcp-protocol.js";

const request = { url: "https://example.test/mcp", method: "POST" as const, headers: { authorization: "Bearer example" } };

it.each([
  { text: '{"value":"€"}', contentType: "APPLICATION/JSON" },
  { text: 'data: {"value":"€"}\n\n', contentType: "TEXT/EVENT-STREAM" },
])("passes both read options and preserves $contentType metadata", async ({ text, contentType }) => {
  const response = new Response(text, { status: 201, headers: {
    "content-type": contentType, "mcp-session-id": "session", "www-authenticate": "Bearer",
  } });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
  const readResponseText = vi.fn<HttpFetchPort['readResponseText']>(async () => text);
  const maxResponseBytes = new TextEncoder().encode(text).byteLength;
  const exchange = createFetchMcpHttpExchange({ fetch }, { maxResponseBytes, strictUtf8: true, readResponseText });
  const controller = new AbortController();
  await expect(exchange.send(request, { body: "input", signal: controller.signal })).resolves.toEqual({
    status: 201, contentType: contentType.toLowerCase(), sessionId: "session", wwwAuthenticate: "Bearer", text,
  });
  expect(fetch).toHaveBeenCalledWith(request.url, { method: "POST", headers: request.headers, redirect: "error", body: "input", signal: controller.signal });
  expect(readResponseText.mock.calls).toEqual([[{ response }, { maxResponseBytes, strictUtf8: true }]]);
});

it.each<TextReadOptions>([{ maxResponseBytes: 0 }, { maxResponseBytes: 1 }, { strictUtf8: true }, { maxResponseBytes: 0, strictUtf8: false }, { maxResponseBytes: 1, strictUtf8: true }])(
  "requires a reader synchronously for %j before fetching", optional => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const construct = () => createFetchMcpHttpExchange({ fetch }, optional);
    expect(construct).toThrow(McpProtocolError);
    expect(construct).toThrow(new McpProtocolError({ message: "mcp-federation: readResponseText is required when maxResponseBytes or strictUtf8 is set" }));
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each<TextReadOptions>([{ maxResponseBytes: 0 }, { strictUtf8: true }])("uses the injected reader for %j and preserves rejection identity", async optional => {
  const response = new Response("body");
  const failure = new Error("reader refused");
  const readResponseText = vi.fn<HttpFetchPort['readResponseText']>(async () => { throw failure; });
  const exchange = createFetchMcpHttpExchange({ fetch: async () => response }, { ...optional, readResponseText });
  await expect(exchange.send(request)).rejects.toBe(failure);
  expect(readResponseText.mock.calls).toEqual([[{ response }, optional]]);
});

it.each<TextReadOptions>([{}, { strictUtf8: false }])("keeps uncapped responses above 4 MiB on response.text for %j", async optional => {
  const text = "x".repeat(4 * 1024 * 1024 + 1);
  const readResponseText = vi.fn<HttpFetchPort['readResponseText']>();
  const fetch: typeof globalThis.fetch = async () => new Response(text);
  await expect(createFetchMcpHttpExchange({ fetch }, { ...optional, readResponseText }).send(request)).resolves.toEqual({
    status: 200, contentType: "text/plain;charset=utf-8", sessionId: undefined, wwwAuthenticate: undefined, text,
  });
  expect(readResponseText).not.toHaveBeenCalled();
});
