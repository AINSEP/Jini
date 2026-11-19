import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSearchRequest } from "../http-query.js";

const limits = { maxTextLength: 256, maxCollections: 10, maxLimit: 50, maxCursorLength: 1024 };

for (const field of ["q", "collection", "limit", "cursor"] as const) {
  test(`repeated ${field} is malformed rather than selecting its first value`, () => {
    assert.deepEqual(parseSearchRequest({ query: { q: "valid", [field]: ["first", "second"] }, limits }), { error: { code: "not-single", field } });
  });
}

test("successful parsing trims text and collections, omits absent keys and ignores audiences", () => {
  assert.deepEqual(parseSearchRequest({ query: { q: " hello ", collection: " post, page ", limit: "5", cursor: "c1", audiences: "admin" }, limits }),
    { query: { text: "hello", collections: ["post", "page"], limit: 5, cursor: "c1" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "hello", audiences: ["admin"] }, limits }), { query: { text: "hello" } });
});

test("all four limits accept their boundary values", () => {
  const collections = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  for (const limit of ["1", "50"]) {
    assert.deepEqual(parseSearchRequest({ query: { q: "x".repeat(256), collection: collections.join(","), limit, cursor: "c".repeat(1024) }, limits }),
      { query: { text: "x".repeat(256), collections, limit: Number(limit), cursor: "c".repeat(1024) } });
  }
});

test("each bound is enforced independently and text length counts UTF-16 units", () => {
  assert.deepEqual(parseSearchRequest({ query: { q: "x".repeat(257) }, limits }), { error: { code: "text-too-long" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "a", collection: Array.from({ length: 11 }, (_, i) => `c${i}`).join(",") }, limits }), { error: { code: "invalid-collections" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "a", limit: "51" }, limits }), { error: { code: "invalid-limit" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "a", cursor: "c".repeat(1025) }, limits }), { error: { code: "invalid-cursor" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "😀".repeat(128) }, limits }), { query: { text: "😀".repeat(128) } });
  assert.deepEqual(parseSearchRequest({ query: { q: "😀".repeat(129) }, limits }), { error: { code: "text-too-long" } });
});

test("missing text, collection grammar, integer syntax and empty cursor retain their errors", () => {
  assert.deepEqual(parseSearchRequest({ query: {}, limits }), { error: { code: "text-required" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "  " }, limits }), { error: { code: "text-required" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "a", collection: "Post" }, limits }), { error: { code: "invalid-collections" } });
  for (const limit of ["0", "2.5", "1e1"]) {
    assert.deepEqual(parseSearchRequest({ query: { q: "a", limit }, limits }), { error: { code: "invalid-limit" } });
  }
  assert.deepEqual(parseSearchRequest({ query: { q: "a", cursor: "" }, limits }), { error: { code: "invalid-cursor" } });
});

test("multiple errors report the first in q, collection, limit, cursor order", () => {
  assert.deepEqual(parseSearchRequest({ query: { q: " ", collection: "Post", limit: "0", cursor: "" }, limits }), { error: { code: "text-required" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "valid", collection: "Post", limit: "0", cursor: "" }, limits }), { error: { code: "invalid-collections" } });
  assert.deepEqual(parseSearchRequest({ query: { q: "valid", collection: "post", limit: "0", cursor: "" }, limits }), { error: { code: "invalid-limit" } });
});
