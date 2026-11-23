/** @file Tests for `find-in-page-verify.ts` — the counter arithmetic the live find-bar verifier asserts against. */
import { test } from "vitest";
import assert from "node:assert/strict";

import { advancesEveryStep, nextOrdinal, parseCount, previousOrdinal } from "../find-in-page-verify.js";

test("parseCount reads exactly \"N of M\", trimmed, and nothing else", () => {
  assert.deepEqual(parseCount({ text: "3 of 17" }), { ordinal: 3, total: 17 });
  assert.deepEqual(parseCount({ text: "  1 of 1\n" }), { ordinal: 1, total: 1 });
  for (const text of [null, undefined, "", "No results", "3 of", "of 17", "3 of 17 matches", "-1 of 2"]) {
    assert.equal(parseCount({ text }), null, String(text));
  }
});

test("a forward find lands one further, wrapping the last match back to the first", () => {
  assert.equal(nextOrdinal({ count: { ordinal: 3, total: 17 } }), 4);
  assert.equal(nextOrdinal({ count: { ordinal: 17, total: 17 } }), 1);
  assert.equal(nextOrdinal({ count: null }), null);
});

test("Shift+Enter lands one back, wrapping the first match to the last", () => {
  assert.equal(previousOrdinal({ count: { ordinal: 4, total: 17 } }), 3);
  assert.equal(previousOrdinal({ count: { ordinal: 1, total: 17 } }), 17);
  assert.equal(previousOrdinal({ count: { ordinal: 1, total: 1 } }), 1);
  assert.equal(previousOrdinal({ count: null }), null);
});

test("advancesEveryStep holds only for consecutive +1 steps over the same total, across the wrap", () => {
  const counts = (total: number, ...ordinals: number[]) => ordinals.map((ordinal) => ({ ordinal, total }));
  assert.equal(advancesEveryStep({ start: 2, steps: counts(4, 3, 4, 1), total: 4 }), true);
  assert.equal(advancesEveryStep({ start: 2, steps: [], total: 4 }), true);
  assert.equal(advancesEveryStep({ start: 2, steps: counts(4, 3, 3, 4), total: 4 }), false, "a press that did not advance");
  assert.equal(advancesEveryStep({ start: 2, steps: [{ ordinal: 3, total: 4 }, null], total: 4 }), false, "a press that lost the counter");
  assert.equal(advancesEveryStep({ start: 2, steps: counts(5, 3), total: 4 }), false, "the result set changed under the presses");
});
