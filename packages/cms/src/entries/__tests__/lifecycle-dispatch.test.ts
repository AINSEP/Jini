import assert from "node:assert/strict";
import { test } from "vitest";

import { ENTRY_LIFECYCLE_OPS, parseEntryLifecycleOp } from "../lifecycle-dispatch.js";

/**
 * @file The closed-union-dispatch convention applied to entry publish/unpublish ops (this
 * dispatch).
 */

test("parseEntryLifecycleOp: accepts exactly the 2 closed ops", () => {
  assert.equal(parseEntryLifecycleOp("publish"), "publish");
  assert.equal(parseEntryLifecycleOp("unpublish"), "unpublish");
});

test("parseEntryLifecycleOp: rejects an arbitrary/unknown string or non-string input", () => {
  assert.equal(parseEntryLifecycleOp("delete"), null);
  assert.equal(parseEntryLifecycleOp(""), null);
  assert.equal(parseEntryLifecycleOp(undefined), null);
  assert.equal(parseEntryLifecycleOp(7), null);
});

test("ENTRY_LIFECYCLE_OPS: a prototype-chain key never resolves a handler", () => {
  const dict = ENTRY_LIFECYCLE_OPS as unknown as Record<string, unknown>;
  assert.equal(dict.toString, undefined);
  assert.equal(dict.hasOwnProperty, undefined);
});
