import { afterEach, expect, it, vi } from "vitest";
import { createFetchMcpHttpExchange } from "../adapter.http.js";

const request = { url: "https://example.test/mcp", method: "POST" as const, headers: { authorization: "Bearer example" } };
const encoder = new TextEncoder();
function responseOf(text: string, contentType: string) {
  return new Response(new ReadableStream<Uint8Array>({ start(c) {
    const bytes = encoder.encode(text);
    c.enqueue(bytes.subarray(0, 2)); c.enqueue(bytes.subarray(2)); c.close();
  } }), { status: 201, headers: { "content-type": contentType, "mcp-session-id": "session", "www-authenticate": "Bearer", "content-length": "1" } });
}

afterEach(() => { vi.doUnmock("@jini-ai/platform/fetch-with-timeout"); vi.resetModules(); });

it.each([
  { text: '{"value":"€"}', contentType: "APPLICATION/JSON" },
  { text: 'data: {"value":"€"}\n\n', contentType: "TEXT/EVENT-STREAM" },
])("caps actual $contentType bytes and preserves request/response metadata", async ({ text, contentType }) => {
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => responseOf(text, contentType));
  const cap = encoder.encode(text).byteLength;
  const exchange = createFetchMcpHttpExchange({ fetch }, { maxResponseBytes: cap, strictUtf8: true });
  await expect(exchange.send(request, { body: "input", signal: controller.signal })).resolves.toEqual({
    status: 201, contentType: contentType.toLowerCase(), sessionId: "session", wwwAuthenticate: "Bearer", text,
  });
  expect(fetch).toHaveBeenCalledWith(request.url, { method: "POST", headers: request.headers, redirect: "error", body: "input", signal: controller.signal });
  await expect(createFetchMcpHttpExchange({ fetch }, { maxResponseBytes: cap - 1 }).send(request)).rejects.toBeInstanceOf(RangeError);
});

it("strict decoding rejects malformed text and cleans up an unfinished stream", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(0xff)); }, cancel });
  const fetch: typeof globalThis.fetch = async () => new Response(body);
  await expect(createFetchMcpHttpExchange({ fetch }, { strictUtf8: true }).send(request)).rejects.toBeInstanceOf(TypeError);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

it("cancels/releases overflow without masking it with a cancellation error", async () => {
  const cancel = vi.fn(() => { throw new Error("cancel failed"); });
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode("too large")); }, cancel });
  const fetch: typeof globalThis.fetch = async () => new Response(body);
  await expect(createFetchMcpHttpExchange({ fetch }, { maxResponseBytes: 1 }).send(request)).rejects.toBeInstanceOf(RangeError);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

it("keeps default exchanges above the separate session limit working with the platform peer absent", async () => {
  // A missing optional peer throws on import; the legacy factory/send path must never load it.
  const peerLoad = vi.fn(() => { throw new Error("platform is not installed"); });
  vi.doMock("@jini-ai/platform/fetch-with-timeout", peerLoad);
  const { createFetchMcpHttpExchange: factory } = await import("../adapter.http.js");
  const text = "x".repeat(4 * 1024 * 1024 + 1);
  const fetch: typeof globalThis.fetch = async () => new Response(text);
  await expect(factory({ fetch }).send(request)).resolves.toEqual({ status: 200, contentType: "text/plain;charset=utf-8", sessionId: undefined, wwwAuthenticate: undefined, text });
  await expect(factory({ fetch }, { strictUtf8: false }).send(request)).resolves.toMatchObject({ text });
  expect(peerLoad).not.toHaveBeenCalled();
});
