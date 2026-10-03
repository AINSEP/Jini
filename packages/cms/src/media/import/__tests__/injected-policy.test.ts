import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { fetchImage, validateImageBytes, MediaImportValidationError } from "../index.js";
import type { FetchImageRequired } from "../ports.js";

function setup(): FetchImageRequired {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return {
    url: "https://assets.example.org/custom.bin", maxBytes: 4,
    allowedContentTypes: new Set(["application/custom"]),
    sniffer: { sniff: () => "application/custom" },
    httpClient: { send: async () => { throw new Error("unguarded HTTP used"); } },
    outboundGuard: { send: async () => ({ status: 200, headers: {}, bodyText: "", bodyBytes: bytes }) },
  };
}

test("only the outbound guard sends; MIME, byte cap and timeout come from the caller", async () => {
  const required = setup();
  const send = vi.fn(required.outboundGuard.send);
  const result = await fetchImage({ ...required, outboundGuard: { send } }, { timeoutMs: 1234 });
  assert.equal(result.contentType, "application/custom");
  assert.deepEqual(result.bytes, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(send.mock.calls[0], [{ httpClient: required.httpClient, request: { method: "GET", url: required.url, headers: { Accept: "application/custom" }, timeoutMs: 1234, maxResponseBytes: 4 } }]);
});

test("guard refusal propagates unchanged and prevents any sniffing", async () => {
  const required = setup();
  const error = new Error("outbound destination refused");
  const sniff = vi.fn(required.sniffer.sniff);
  await assert.rejects(fetchImage({ ...required, sniffer: { sniff }, outboundGuard: { send: async () => { throw error; } } }), (actual) => actual === error);
  assert.equal(sniff.mock.calls.length, 0);
});

test.each([0, -1, NaN, Infinity, 1.5])("invalid byte ceiling %s fails before guard invocation", async (maxBytes) => {
  const required = setup();
  const send = vi.fn(required.outboundGuard.send);
  await assert.rejects(fetchImage({ ...required, maxBytes, outboundGuard: { send } }), MediaImportValidationError);
  assert.equal(send.mock.calls.length, 0);
});

test("caller MIME denial and clipping reject before accepting or sniffing", () => {
  const required = setup();
  assert.throws(() => validateImageBytes({ ...required, allowedContentTypes: new Set(), source: required.url, bytes: new Uint8Array([1]), bytesTruncated: false }), /actual bytes are 'application\/custom'/);
  const sniff = vi.fn(required.sniffer.sniff);
  assert.throws(() => validateImageBytes({ ...required, sniffer: { sniff }, source: required.url, bytes: new Uint8Array([1]), bytesTruncated: true }), /exceeds the 4-byte import limit/);
  assert.equal(sniff.mock.calls.length, 0);
});
