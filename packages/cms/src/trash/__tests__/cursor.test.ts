import assert from "node:assert/strict";
import { test } from "vitest";
import { decodeTrashCursor, encodeTrashCursor } from "../cursor.js";

// F4.1: literal wire bytes, not a round trip alone, pin encoding and separator.
// PARITY
test("cursor uses UTF-8, NUL separator and unpadded URL-safe base64", () => {
  assert.equal(encodeTrashCursor({ trashedAt: "at", id: "id" }), "YXQAaWQ");
  assert.deepEqual(decodeTrashCursor({ cursor: "YXQAaWQ" }), { trashedAt: "at", id: "id" });
  assert.deepEqual(decodeTrashCursor({ cursor: "YXQA5pel5pys" }), { trashedAt: "at", id: "日本" });
  assert.equal(encodeTrashCursor({ trashedAt: "at", id: "日本" }), "YXQA5pel5pys");
});

// F1.1/F7.7: generated round trips supplement the literal wire-format oracle above.
// PARITY
test("generated nonempty Unicode cursor fields round-trip without losing either identity", () => {
  let seed = 810;
  const alphabet = ["a", "Z", "9", "-", "_", "日", "é", "😀"];
  const field = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const length = 1 + seed % 24;
    let value = "";
    for (let n = 0; n < length; n++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value += alphabet[(seed >>> 16) % alphabet.length];
    }
    return value;
  };
  for (let n = 0; n < 100; n++) {
    const input = { trashedAt: field(), id: field() };
    const cursor = encodeTrashCursor(input);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeTrashCursor({ cursor: cursor }), input);
  }
});

// PARITY
test("missing, malformed and empty-sided cursors restart pagination without throwing", () => {
  for (const input of [undefined, null, "", "!not-base64!", "bm8tc2VwYXJhdG9y", "AGlk", "YXQA"]) {
    assert.equal(decodeTrashCursor({ cursor: input }), null, String(input));
  }
});
