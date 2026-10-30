import { describe, expect, it, vi } from "vitest";
import { ResponseLimitExceededError, readFetchResponseText } from "../fetch-with-timeout.js";

describe("response limit errors", () => {
  it.each([0, 3])("identifies overflow at a %s-byte cap in both read modes", async limitBytes => {
    const text = "€x";
    const legacy = readFetchResponseText({ response: new Response(text) }, { maxResponseBytes: limitBytes });
    const detailed = readFetchResponseText({ response: new Response(text), maxResponseBytes: limitBytes, result: "details" });
    for (const result of [legacy, detailed]) {
      const error = await result.catch(error => error);
      expect(error).toBeInstanceOf(ResponseLimitExceededError);
      expect(error).toBeInstanceOf(RangeError);
      expect(error.name).toBe("ResponseLimitExceededError");
      expect(error.limitBytes).toBe(limitBytes);
      expect(error.message).toBe(`response exceeds the ${limitBytes}-byte limit`);
    }
  });

  it("keeps invalid configuration distinct from observed response overflow", async () => {
    const response = new Response("ok");
    const error = await readFetchResponseText({ response }, { maxResponseBytes: -1 }).catch(error => error);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(ResponseLimitExceededError);
    expect(response.bodyUsed).toBe(false);
  });

  it("passes the typed overflow to cleanup and preserves it when cancellation fails", async () => {
    const cancel = vi.fn(() => { throw new Error("cancel failed"); });
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(0xe2)); controller.enqueue(Uint8Array.of(0x82, 0xac)); },
      cancel,
    });
    const error = await readFetchResponseText({ response: new Response(body) }, { maxResponseBytes: 2, strictUtf8: true })
      .catch(error => error);
    expect(error).toBeInstanceOf(ResponseLimitExceededError);
    expect(error.limitBytes).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(error);
    expect(body.locked).toBe(false);
  });

  it("keeps exact-byte success and opt-in truncation unchanged", async () => {
    await expect(readFetchResponseText({ response: new Response("€") }, { maxResponseBytes: 3, strictUtf8: true }))
      .resolves.toBe("€");
    await expect(readFetchResponseText({ response: new Response("€x"), maxResponseBytes: 3, result: "details", onLimit: "truncate" }))
      .resolves.toEqual({ text: "€", byteLength: 3, truncated: true });
  });
});
