import { readFileSync } from "node:fs";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { readFetchResponseText } from "../fetch-with-timeout.js";

const encoder = new TextEncoder();
type Chunk = ReadableStreamReadResult<Uint8Array>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Inject only the response/reader contract; no transport, timers, or global stream mocks.
function fakeResponse({ chunks = [], read, cancel = async () => {}, releaseLock = () => {}, headers = {} }: {
  chunks?: Uint8Array[];
  read?: () => Promise<Chunk>;
  cancel?: (reason?: unknown) => Promise<void>;
  releaseLock?: () => void;
  headers?: Record<string, string>;
} = {}) {
  const queue: Chunk[] = chunks.map(value => ({ done: false, value }));
  const reader = {
    read: vi.fn(read ?? (async (): Promise<Chunk> => queue.shift() ?? { done: true, value: undefined })),
    cancel: vi.fn(cancel),
    releaseLock: vi.fn(releaseLock),
  };
  const getReader = vi.fn(() => reader);
  const text = vi.fn(async () => "unexpected fallback");
  const response = { body: { getReader }, text, headers: new Headers(headers) } as unknown as Response;
  return { response, reader, getReader, text };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("readFetchResponseText details", () => {
  it.each([
    { chunks: ["ab"], cap: 3, text: "ab", byteLength: 2, truncated: false, reads: 2 },
    { chunks: ["a", "bc"], cap: 3, text: "abc", byteLength: 3, truncated: false, reads: 3 },
    { chunks: ["abc", "", "d", "unread"], cap: 3, text: "abc", byteLength: 3, truncated: true, reads: 3 },
    { chunks: ["abcdef", "unread"], cap: 3, text: "abc", byteLength: 3, truncated: true, reads: 1 },
    { chunks: [], cap: 0, text: "", byteLength: 0, truncated: false, reads: 1 },
    { chunks: ["", ""], cap: 0, text: "", byteLength: 0, truncated: false, reads: 3 },
    { chunks: ["", "x"], cap: 0, text: "", byteLength: 0, truncated: true, reads: 2 },
  ])("returns retained bytes/completeness for $chunks at cap $cap", async ({ chunks, cap, text, byteLength, truncated, reads }) => {
    const fake = fakeResponse({ chunks: chunks.map(chunk => encoder.encode(chunk)) });
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: cap, result: "details", onLimit: "truncate" }))
      .resolves.toEqual({ text, byteLength, truncated });
    expect(fake.reader.read).toHaveBeenCalledTimes(reads);
    expect(fake.reader.cancel).toHaveBeenCalledTimes(Number(truncated));
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(fake.text).not.toHaveBeenCalled();
  });

  it("handles a null body without acquiring a reader", async () => {
    await expect(readFetchResponseText({ response: new Response(null), maxResponseBytes: 0, result: "details" }))
      .resolves.toEqual({ text: "", byteLength: 0, truncated: false });
  });

  it.each(["1", "9999"])("counts split UTF-8 bytes despite Content-Length %s", async length => {
    const fake = fakeResponse({ chunks: [Uint8Array.of(0xe2), Uint8Array.of(0x82, 0xac)], headers: { "content-length": length } });
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", strictUtf8: true }))
      .resolves.toEqual({ text: "€", byteLength: 3, truncated: false });
    expect(fake.reader.cancel).not.toHaveBeenCalled();
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "reject"] as const)("rejects overflow before decoding with policy %s", async onLimit => {
    const fake = fakeResponse({ chunks: [encoder.encode("abc"), Uint8Array.of(0xff)] });
    const result = readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", strictUtf8: true, ...(onLimit === undefined ? {} : { onLimit }) });
    await expect(result).rejects.toThrow(new RangeError("response exceeds the 3-byte limit"));
    expect(fake.reader.cancel).toHaveBeenCalledWith(expect.any(RangeError));
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, null])("validates cap %s before acquiring even an empty reader", async maxResponseBytes => {
    const fake = fakeResponse();
    // Deliberately include invalid JavaScript inputs that TypeScript consumers cannot supply.
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: maxResponseBytes as number, result: "details" })).rejects.toBeInstanceOf(RangeError);
    expect(fake.getReader).not.toHaveBeenCalled();
    expect(fake.text).not.toHaveBeenCalled();
  });

  it.each([
    { bytes: [0xff], cap: 1, text: "�", truncated: false },
    { bytes: [0xe2, 0x82], cap: 2, text: "�", truncated: false },
    { bytes: [0xe2, 0x82, 0xac], cap: 2, text: "�", truncated: true },
    { bytes: [0x61, 0xff], cap: 1, text: "a", truncated: true },
  ])("replacement decoding retains source-byte metadata for $bytes at cap $cap", async ({ bytes, cap, text, truncated }) => {
    const fake = fakeResponse({ chunks: [Uint8Array.from(bytes)] });
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: cap, result: "details", onLimit: "truncate" }))
      .resolves.toEqual({ text, byteLength: cap, truncated });
  });

  it.each([
    { bytes: [0xff], cap: 1 },
    { bytes: [0xe2, 0x82], cap: 2 },
    { bytes: [0xe2, 0x82, 0xac], cap: 2 },
  ])("strict decoding rejects malformed/truncated UTF-8 $bytes at cap $cap", async ({ bytes, cap }) => {
    const fake = fakeResponse({ chunks: [Uint8Array.from(bytes)] });
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: cap, result: "details", onLimit: "truncate", strictUtf8: true })).rejects.toBeInstanceOf(TypeError);
    expect(fake.reader.cancel).toHaveBeenCalledWith(expect.any(TypeError));
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("waits for EOF after equality and removes each read's abort listener", async () => {
    const tail = deferred<Chunk>();
    const tailStarted = deferred<void>();
    const fake = fakeResponse({ read: vi.fn<() => Promise<Chunk>>()
      .mockResolvedValueOnce({ done: false, value: encoder.encode("abc") })
      .mockImplementationOnce(() => { tailStarted.resolve(); return tail.promise; }) });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let settled = false;
    const result = readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", onLimit: "truncate", signal: controller.signal });
    void result.then(() => { settled = true; }, () => { settled = true; });
    await tailStarted.promise;
    expect(settled).toBe(false);
    expect(fake.reader.cancel).not.toHaveBeenCalled();
    tail.resolve({ done: true, value: undefined });
    await expect(result).resolves.toEqual({ text: "abc", byteLength: 3, truncated: false });
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls).toEqual(add.mock.calls.map(([event, listener]) => [event, listener]));
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("preserves an already-aborted reason without consuming the body", async () => {
    const controller = new AbortController();
    const reason = { kind: "cancelled" };
    controller.abort(reason);
    const fake = fakeResponse();
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", signal: controller.signal })).rejects.toBe(reason);
    expect(fake.getReader).not.toHaveBeenCalled();
    expect(fake.reader.read).not.toHaveBeenCalled();
  });

  it.each(["reject", "stall"] as const)("interrupts a stalled read even when cancellation will %s", async cleanup => {
    const pending = deferred<Chunk>();
    const started = deferred<void>();
    const reason = new Error("caller cancelled");
    const fake = fakeResponse({
      read: () => { started.resolve(); return pending.promise; },
      cancel: () => cleanup === "reject" ? Promise.reject(new Error("cancel failed")) : new Promise<void>(() => {}),
    });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", signal: controller.signal });
    const assertion = expect(result).rejects.toBe(reason);
    await started.promise;
    controller.abort(reason);
    await assertion;
    expect(fake.reader.cancel).toHaveBeenCalledWith(reason);
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    // The losing read may still fail later; its rejection must already be observed.
    pending.reject(new Error("late read failure"));
  });

  it.each(["throw", "reject", "stall"] as const)("returns a truncated prefix when cancellation will %s", async cleanup => {
    const fake = fakeResponse({ chunks: [encoder.encode("abcdef")], cancel: () => {
      if (cleanup === "throw") throw new Error("cancel threw");
      if (cleanup === "reject") return Promise.reject(new Error("cancel failed"));
      return new Promise<void>(() => {});
    } });
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", onLimit: "truncate" }))
      .resolves.toEqual({ text: "abc", byteLength: 3, truncated: true });
    expect(fake.reader.cancel).toHaveBeenCalledTimes(1);
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("preserves a read failure despite both cleanup failures and removes the abort listener", async () => {
    const failure = new Error("read failed");
    const fake = fakeResponse({ read: async () => { throw failure; }, cancel: async () => { throw new Error("cancel failed"); }, releaseLock: () => { throw new Error("release failed"); } });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(readFetchResponseText({ response: fake.response, maxResponseBytes: 3, result: "details", signal: controller.signal })).rejects.toBe(failure);
    expect(fake.reader.cancel).toHaveBeenCalledWith(failure);
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls).toEqual(add.mock.calls.map(([event, listener]) => [event, listener]));
  });

  it("keeps the existing public subpath and distinct overload return contracts", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.exports["./fetch-with-timeout"]).toEqual({ types: "./dist/fetch-with-timeout.d.ts", import: "./dist/fetch-with-timeout.js", default: "./dist/fetch-with-timeout.js" });
    const detailed = readFetchResponseText({ response: new Response("ok"), maxResponseBytes: 2, result: "details" });
    expectTypeOf(detailed).toEqualTypeOf<Promise<{ text: string; byteLength: number; truncated: boolean }>>();
    const legacy = readFetchResponseText({ response: new Response("ok") });
    expectTypeOf(legacy).toEqualTypeOf<Promise<string>>();
    await expect(detailed).resolves.toEqual({ text: "ok", byteLength: 2, truncated: false });
    await expect(legacy).resolves.toBe("ok");
  });

  it("keeps details policies opt-in when a legacy options object contains extra fields", async () => {
    const controller = new AbortController();
    controller.abort(new Error("details-only cancellation"));
    const options = { maxResponseBytes: 2, onLimit: "truncate" as const, signal: controller.signal };
    const fake = fakeResponse({ chunks: [encoder.encode("abc")] });
    await expect(readFetchResponseText({ response: fake.response }, options)).rejects.toBeInstanceOf(RangeError);
    expect(fake.reader.cancel).toHaveBeenCalledWith(expect.any(RangeError));
    expect(fake.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
