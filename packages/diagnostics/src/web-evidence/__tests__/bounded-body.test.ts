import assert from "node:assert/strict";
import { test } from "vitest";

import { readBoundedBody } from "../bounded-body.js";

/** @file The body cap: the read stops at `maxBytes` instead of buffering a whole response. */

test("readBoundedBody: stops at the cap and reports it, rather than buffering the whole response", async () => {
  const chunks = ["alpha", "-beta-gamma", "unread-tail"];
  let pulls = 0;
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode(chunks[pulls++]));
    },
    cancel() { cancellations += 1; },
  }, { highWaterMark: 0 }));
  const read = await readBoundedBody({ response, maxBytes: 10 });
  assert.equal(read.bodyBytes, 10);
  assert.equal(read.body.length, 10);
  assert.equal(read.body, "alpha-beta");
  assert.equal(pulls, 2);
  assert.equal(cancellations, 1);
  assert.equal(read.truncated, true);
});

test("readBoundedBody: a response under the cap is returned whole and not flagged", async () => {
  const read = await readBoundedBody({ response: new Response("hello"), maxBytes: 100 });
  assert.deepEqual(read, { body: "hello", bodyBytes: 5, truncated: false });
});

/** A response whose body arrives as the given chunks, one per pull, with an observable cancel. */
function chunkedResponse(chunks: string[], hooks: { onCancel?: () => void } = {}): Response {
  let pulls = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() { hooks.onCancel?.(); },
  }, { highWaterMark: 0 }));
}

test("readBoundedBody: maxBytes-1 truncates, maxBytes and maxBytes+1 return the body whole", async () => {
  const body = "0123456789";
  const below = await readBoundedBody({ response: new Response(body), maxBytes: body.length - 1 });
  assert.deepEqual(below, { body: "012345678", bodyBytes: 9, truncated: true });
  const exact = await readBoundedBody({ response: new Response(body), maxBytes: body.length });
  assert.deepEqual(exact, { body, bodyBytes: 10, truncated: false });
  const above = await readBoundedBody({ response: new Response(body), maxBytes: body.length + 1 });
  assert.deepEqual(above, { body, bodyBytes: 10, truncated: false });
});

test("readBoundedBody: the same boundary holds when the body arrives in several chunks", async () => {
  const chunks = ["alpha", "-beta"];
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 9 }), { body: "alpha-bet", bodyBytes: 9, truncated: true });
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 10 }), { body: "alpha-beta", bodyBytes: 10, truncated: false });
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 11 }), { body: "alpha-beta", bodyBytes: 10, truncated: false });
});

test("readBoundedBody: a single chunk larger than the cap is cut at the cap and the reader is cancelled once", async () => {
  let cancellations = 0;
  const read = await readBoundedBody({ response: chunkedResponse(["abcdefghij"], { onCancel: () => { cancellations += 1; } }), maxBytes: 4 });
  assert.deepEqual(read, { body: "abcd", bodyBytes: 4, truncated: true });
  assert.equal(cancellations, 1);
});

test("readBoundedBody: a cancel failure after overflow is swallowed, the capped body is still returned", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode("abcdefghij")); },
    cancel() { throw new Error("cancel failed"); },
  }, { highWaterMark: 0 }));
  const read = await readBoundedBody({ response, maxBytes: 3 });
  assert.deepEqual(read, { body: "abc", bodyBytes: 3, truncated: true });
});

test("readBoundedBody: a stream error is rethrown to the caller unchanged, not turned into a partial body", async () => {
  const boom = new Error("socket reset mid-body");
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(new TextEncoder().encode("partial"));
      else controller.error(boom);
    },
  }, { highWaterMark: 0 }));
  await assert.rejects(() => readBoundedBody({ response, maxBytes: 100 }), (err: unknown) => err === boom);
});

test("readBoundedBody: a response with no body is empty and not flagged", async () => {
  assert.deepEqual(await readBoundedBody({ response: new Response(null, { status: 204 }), maxBytes: 10 }), { body: "", bodyBytes: 0, truncated: false });
});

test("readBoundedBody: a multi-byte character split by the cap degrades to a replacement character", async () => {
  const read = await readBoundedBody({ response: new Response("a\u00e9"), maxBytes: 2 });
  assert.deepEqual(read, { body: "a\ufffd", bodyBytes: 2, truncated: true });
});
