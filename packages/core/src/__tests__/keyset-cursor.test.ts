import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError } from "../tool-input-errors.js";

import { decodeKeysetCursor, encodeKeysetCursor } from "../keyset-cursor.js";

/** @file The shared `${createdAt}::${id}` keyset cursor: a round trip, and every malformed shape refused. */

test("a cursor round-trips its position, including an id that itself contains '::'", () => {
  for (const position of [
    { createdAt: "2026-09-28T00:00:00.000Z", id: "c1" },
    { createdAt: "2026-09-28T00:00:00.000Z", id: "a::b" },
  ]) {
    assert.deepEqual(decodeKeysetCursor({ cursor: encodeKeysetCursor(position) }), position);
  }
  assert.equal(encodeKeysetCursor({ createdAt: "2026-09-28T00:00:00.000Z", id: "c1" }), "2026-09-28T00:00:00.000Z::c1");
});

test("a malformed cursor is refused with ToolInputError 'invalid cursor'", () => {
  // No separator (a bare id), no id, no createdAt, a createdAt that is no date.
  for (const cursor of ["c1", "2026-09-28T00:00:00.000Z::", "::c1", "yesterday::c1"]) {
    assert.throws(
      () => decodeKeysetCursor({ cursor }),
      (err: unknown) => err instanceof ToolInputError && err.message === "invalid cursor",
      cursor
    );
  }
});
