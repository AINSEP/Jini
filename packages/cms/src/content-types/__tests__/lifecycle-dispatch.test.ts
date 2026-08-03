import assert from "node:assert/strict";
import { test } from "vitest";

import { CONTENT_TYPE_LIFECYCLE_OPS, parseContentTypeLifecycleOp } from "../lifecycle-dispatch.js";

/**
 * @file ADR-042 closed-union-dispatch convention applied to content-type lifecycle ops (this
 * dispatch). Mirrors `features/settings/__tests__`'s equivalent coverage for
 * `definitions-dispatch.ts`.
 */

test("parseContentTypeLifecycleOp: accepts exactly the 3 closed ops", () => {
  assert.equal(parseContentTypeLifecycleOp("deprecate"), "deprecate");
  assert.equal(parseContentTypeLifecycleOp("reactivate"), "reactivate");
  assert.equal(parseContentTypeLifecycleOp("tombstone"), "tombstone");
});

test("parseContentTypeLifecycleOp: rejects an arbitrary/unknown string", () => {
  assert.equal(parseContentTypeLifecycleOp("delete"), null);
  assert.equal(parseContentTypeLifecycleOp(""), null);
  assert.equal(parseContentTypeLifecycleOp("__proto__"), null);
});

test("parseContentTypeLifecycleOp: rejects non-string input without throwing", () => {
  assert.equal(parseContentTypeLifecycleOp(undefined), null);
  assert.equal(parseContentTypeLifecycleOp(42), null);
  assert.equal(parseContentTypeLifecycleOp({ toString: () => "deprecate" }), null);
});

test("CONTENT_TYPE_LIFECYCLE_OPS: a prototype-chain key (e.g. 'toString') never resolves a handler", () => {
  const dict = CONTENT_TYPE_LIFECYCLE_OPS as unknown as Record<string, unknown>;
  assert.equal(dict.toString, undefined);
  assert.equal(dict.constructor, undefined);
});
