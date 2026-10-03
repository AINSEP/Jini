import assert from "node:assert/strict";
import { test } from "vitest";

import { CONTENT_TYPE_LIFECYCLE_OPS, parseContentTypeLifecycleOp } from "../lifecycle-dispatch.js";

/**
 * @file the closed-union-dispatch convention applied to content-type lifecycle ops (this
 * dispatch). Mirrors `features/settings/__tests__`'s equivalent coverage for
 * `definitions-dispatch.ts`.
 */

test("parseContentTypeLifecycleOp: accepts exactly the 3 closed ops", () => {
  assert.equal(parseContentTypeLifecycleOp({ op: "deprecate" }), "deprecate");
  assert.equal(parseContentTypeLifecycleOp({ op: "reactivate" }), "reactivate");
  assert.equal(parseContentTypeLifecycleOp({ op: "tombstone" }), "tombstone");
});

test("parseContentTypeLifecycleOp: rejects an arbitrary/unknown string", () => {
  assert.equal(parseContentTypeLifecycleOp({ op: "delete" }), null);
  assert.equal(parseContentTypeLifecycleOp({ op: "" }), null);
  assert.equal(parseContentTypeLifecycleOp({ op: "__proto__" }), null);
});

test("parseContentTypeLifecycleOp: rejects non-string input without throwing", () => {
  assert.equal(parseContentTypeLifecycleOp({ op: undefined }), null);
  assert.equal(parseContentTypeLifecycleOp({ op: 42 }), null);
  assert.equal(parseContentTypeLifecycleOp({ op: { toString: () => "deprecate" } }), null);
});

test("CONTENT_TYPE_LIFECYCLE_OPS: a prototype-chain key (e.g. 'toString') never resolves a handler", () => {
  const dict = CONTENT_TYPE_LIFECYCLE_OPS as unknown as Record<string, unknown>;
  assert.equal(dict.toString, undefined);
  assert.equal(dict.constructor, undefined);
});
