import assert from "node:assert/strict";
import { test } from "vitest";

import { decodeStrictBase64 } from "../strict-base64.js";

/**
 * @file Direct coverage for `decodeStrictBase64`. `Buffer.from(x, "base64")` never throws — it
 * silently skips characters outside the alphabet — so this function's refusal path has to be
 * proven by the regex/length checks, not by a try/catch that can never fire (see the two routes
 * this decoder replaces: `routes/publish-content/blob-put.ts`, `routes/media/upload.ts`).
 */

test("decodeStrictBase64: accepts well-formed standard base64 and returns exact bytes", () => {
  assert.deepEqual(decodeStrictBase64({ value: "aGVsbG8=" }), new Uint8Array(Buffer.from("hello", "utf8")));
  assert.deepEqual(decodeStrictBase64({ value: "Zm8=" }), new Uint8Array(Buffer.from("fo", "utf8")));
  assert.deepEqual(decodeStrictBase64({ value: "Zm9vYmFy" }), new Uint8Array(Buffer.from("foobar", "utf8")));
});

test("decodeStrictBase64: the accepted-case result bytes equal Buffer.from(v, 'base64') exactly", () => {
  for (const v of ["aGVsbG8=", "Zm8=", "Zm9vYmFy"]) {
    assert.deepEqual(decodeStrictBase64({ value: v }), new Uint8Array(Buffer.from(v, "base64")));
  }
});

test("decodeStrictBase64: rejects the empty string", () => {
  assert.equal(decodeStrictBase64({ value: "" }), null);
});

test("decodeStrictBase64: rejects an all-padding string", () => {
  assert.equal(decodeStrictBase64({ value: "====" }), null);
});

test("decodeStrictBase64: rejects characters outside the base64 alphabet", () => {
  assert.equal(decodeStrictBase64({ value: "!!!!" }), null);
});

test("decodeStrictBase64: rejects a non-alphabet character embedded mid-string", () => {
  assert.equal(decodeStrictBase64({ value: "Zm9v$" }), null);
});

test("decodeStrictBase64: rejects a truncated (non-multiple-of-4) length", () => {
  assert.equal(decodeStrictBase64({ value: "Zm9" }), null);
});

test("decodeStrictBase64: rejects embedded newlines even when the surrounding text is valid base64", () => {
  assert.equal(decodeStrictBase64({ value: "Zm9v\nYmFy" }), null);
});

test("decodeStrictBase64: rejects trailing whitespace", () => {
  assert.equal(decodeStrictBase64({ value: "Zm9v " }), null);
});

test("decodeStrictBase64: rejects padding that appears before the final characters", () => {
  assert.equal(decodeStrictBase64({ value: "a===" }), null);
});

test("decodeStrictBase64: rejects base64url characters ('-', '_')", () => {
  assert.equal(decodeStrictBase64({ value: "-_-_" }), null);
});
