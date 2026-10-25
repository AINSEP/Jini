import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTimeoutError, fetchTextWithTimeout, fetchWithTimeout, readFetchResponseText } from "../fetch-with-timeout.js";

const encoder = new TextEncoder();
function streamed(chunks: Uint8Array[], headers?: RequestInit["headers"]) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    cancel,
  });
  return { response: new Response(body, { ...(headers === undefined ? {} : { headers }) }), body, cancel };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("readFetchResponseText", () => {
  it("keeps response.text as the unlimited replacement-decoding default", async () => {
    const response = new Response(Uint8Array.of(0xff));
    const text = vi.spyOn(response, "text");
    await expect(readFetchResponseText({ response })).resolves.toBe("�");
    expect(text).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "1", "9999"])("counts actual bytes across split UTF-8, regardless of Content-Length %s", async length => {
    const { response, body } = streamed([Uint8Array.of(0xe2), Uint8Array.of(0x82, 0xac)], length === undefined ? {} : { "content-length": length });
    await expect(readFetchResponseText({ response }, { maxResponseBytes: 3, strictUtf8: true })).resolves.toBe("€");
    expect(body.locked).toBe(false);
  });

  it("rejects overflow before decoding and cancels/releases the reader even when cancellation fails", async () => {
    const failure = new Error("cancel failed");
    const cancel = vi.fn(() => { throw failure; });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode("abc")); c.enqueue(Uint8Array.of(0xff)); }, cancel });
    await expect(readFetchResponseText({ response: new Response(body) }, { maxResponseBytes: 3, strictUtf8: true })).rejects.toBeInstanceOf(RangeError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it.each([{ bytes: [0xff] }, { bytes: [0xe2, 0x82] }])("rejects malformed or truncated UTF-8 $bytes including at decoder flush", async ({ bytes }) => {
    const { response, body } = streamed([Uint8Array.from(bytes)]);
    await expect(readFetchResponseText({ response }, { strictUtf8: true })).rejects.toBeInstanceOf(TypeError);
    expect(body.locked).toBe(false);
  });

  it("keeps replacement decoding when only the cap is enabled", async () => {
    const { response } = streamed([Uint8Array.of(0xe2, 0x82)]);
    await expect(readFetchResponseText({ response }, { maxResponseBytes: 2 })).resolves.toBe("�");
  });

  it("accepts empty bodies and an exact zero-byte cap", async () => {
    await expect(readFetchResponseText({ response: new Response(null) }, { maxResponseBytes: 0, strictUtf8: true })).resolves.toBe("");
    await expect(readFetchResponseText({ response: new Response("") }, { maxResponseBytes: 0 })).resolves.toBe("");
    await expect(readFetchResponseText({ response: new Response("x") }, { maxResponseBytes: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid cap %s before consumption", async maxResponseBytes => {
    const response = new Response("abc");
    await expect(readFetchResponseText({ response }, { maxResponseBytes })).rejects.toBeInstanceOf(RangeError);
    expect(response.bodyUsed).toBe(false);
  });

  it("preserves read errors and releases the lock", async () => {
    const failure = new Error("read failed");
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.error(failure); } });
    await expect(readFetchResponseText({ response: new Response(body) }, { strictUtf8: true })).rejects.toBe(failure);
    expect(body.locked).toBe(false);
  });

  it("preserves consumption failure when both cleanup operations fail", async () => {
    const failure = new Error("read failed");
    const reader = { read: vi.fn(async () => { throw failure; }), cancel: vi.fn(async () => { throw new Error("cancel"); }), releaseLock: vi.fn(() => { throw new Error("release"); }) };
    const response = { body: { getReader: () => reader } } as unknown as Response;
    await expect(readFetchResponseText({ response }, { strictUtf8: true })).rejects.toBe(failure);
    expect(reader.cancel).toHaveBeenCalledWith(failure);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});

// Model fetch's abort contract without network I/O; fake timers drive the native timeout seam.
function timedFetch(phase: "headers" | "body") {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
    return controller.signal;
  });
  const fetchImpl: typeof fetch = async (_url, init) => {
    const signal = init!.signal!;
    if (phase === "headers") return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return new Response(new ReadableStream<Uint8Array>({ start(c) {
      if (signal.aborted) c.error(signal.reason);
      else signal.addEventListener("abort", () => c.error(signal.reason), { once: true });
    } }));
  };
  return fetchImpl;
}

describe("fetchTextWithTimeout and injected legacy fetch", () => {
  it.each(["headers", "body"] as const)("classifies timeout during %s", async phase => {
    const fetch = timedFetch(phase);
    const result = fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 100 }, { fetch }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ name: "FetchTimeoutError", url: "https://example.test", timeoutMs: 100 });
    expect(await result).toBeInstanceOf(FetchTimeoutError);
  });

  it.each(["headers", "body"] as const)("preserves caller abort during %s", async phase => {
    const fetch = timedFetch(phase);
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const result = fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 100, init: { signal: controller.signal } }, { fetch }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    expect(await result).toBe(reason);
  });

  it("preserves network errors", async () => {
    const failure = new Error("network");
    await expect(fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 5000 }, { fetch: async () => { throw failure; } })).rejects.toBe(failure);
  });

  it("keeps legacy response identity/body state and forwards init through the injected fetch", async () => {
    const response = new Response("ok", { status: 201, headers: { "x-id": "a" } });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const url = new URL("https://example.test");
    await expect(fetchWithTimeout(url, { method: "POST", body: "input" }, { timeoutMs: 5000, fetch })).resolves.toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST", body: "input", signal: expect.any(AbortSignal) }));
    await expect(response.text()).resolves.toBe("ok");
  });

  it("returns consumed response metadata and uses the shared byte/UTF-8 guards", async () => {
    const response = new Response("€", { status: 201, headers: { "x-id": "a" } });
    const result = await fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 5000 }, { fetch: async () => response, maxResponseBytes: 3, strictUtf8: true });
    expect(result).toEqual({ response, text: "€" });
    expect(result.response.status).toBe(201);
    expect(result.response.headers.get("x-id")).toBe("a");
    expect(result.response.bodyUsed).toBe(true);
    await expect(fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 5000 }, { fetch: async () => new Response("€"), maxResponseBytes: 2 })).rejects.toBeInstanceOf(RangeError);
    await expect(fetchTextWithTimeout({ url: "https://example.test", timeoutMs: 5000 }, { fetch: async () => new Response(Uint8Array.of(0xff)), strictUtf8: true })).rejects.toBeInstanceOf(TypeError);
  });
});
