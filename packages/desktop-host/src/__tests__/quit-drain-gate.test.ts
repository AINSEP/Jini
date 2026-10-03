
import { test } from "vitest";
import assert from "node:assert/strict";

import { decideBeforeQuit } from "../shutdown/index.js";

test("with nothing open and nothing tearing down, the quit goes straight through", () => {
  assert.equal(decideBeforeQuit({ phase: "idle", nothingToDrain: true }), "proceed");
});

test("the first quit with something to stop starts the drain", () => {
  assert.equal(decideBeforeQuit({ phase: "idle", nothingToDrain: false }), "drain");
});

test("a quit attempt while the drain is in flight is held, not let through", () => {



  assert.equal(decideBeforeQuit({ phase: "draining", nothingToDrain: false }), "hold");
});

test("a quit attempt mid-drain is held even once the counts already read empty", () => {


  assert.equal(decideBeforeQuit({ phase: "draining", nothingToDrain: true }), "hold");
});

test("every repeated attempt during one drain is held, never just the first", () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(decideBeforeQuit({ phase: "draining", nothingToDrain: attempt % 2 === 0 }), "hold", `attempt ${attempt}`);
  }
});

test("the drain's own closing quit goes through, whatever the counts say", () => {
  assert.equal(decideBeforeQuit({ phase: "drained", nothingToDrain: true }), "proceed");
  assert.equal(decideBeforeQuit({ phase: "drained", nothingToDrain: false }), "proceed");
});

test("an unknown phase throws instead of being read as idle", () => {
  assert.throws(
    // @ts-expect-error -- a misspelled phase: the type rejects it, and this asserts the runtime does too.
    () => decideBeforeQuit({ phase: "drainig", nothingToDrain: false }),
    { name: "TypeError", message: 'decideBeforeQuit: unknown quit phase "drainig"' },
  );
  assert.throws(
    // @ts-expect-error -- a missing phase, from a caller outside the type system.
    () => decideBeforeQuit({ phase: undefined, nothingToDrain: true }),
    { name: "TypeError", message: "decideBeforeQuit: unknown quit phase undefined" },
  );
});
