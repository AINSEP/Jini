import assert from "node:assert/strict";
import { test } from "vitest";
import type { TrashMarkerResult } from "../../index.js";
import { removeEntityWithoutBlocker } from "../remove-without-blocker.js";

/** Hand-written fake removal: records each input and answers with the canned `result`. */
function fakeRemove(result: TrashMarkerResult): {
  remove: (input: { id: string }) => Promise<TrashMarkerResult>;
  calls: Array<{ id: string }>;
} {
  const calls: Array<{ id: string }> = [];
  return {
    calls,
    remove: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

test("every non-blocked result passes through unchanged, with the input forwarded as-is", async () => {
  const outcomes: TrashMarkerResult[] = [
    { ok: true, version: 3 },
    { ok: true, version: null, priorMarker: "draft", noop: true },
    { ok: false, reason: "not-found" },
    { ok: false, reason: "version-changed" },
  ];
  for (const outcome of outcomes) {
    const fake = fakeRemove(outcome);
    const input = { id: "post-1" };
    const result = await removeEntityWithoutBlocker({ remove: fake.remove })(input);
    assert.equal(result, outcome);
    assert.deepEqual(fake.calls, [input]);
    assert.equal(fake.calls[0], input);
  }
});

// Mutation `rwb-blocked-passthrough`: drop the `throw` (return the blocked result) and this goes RED.
test("a blocked result is a composition bug: it throws the exact message naming the id", async () => {
  const fake = fakeRemove({ ok: false, reason: "blocked", code: "has-children", count: 2 });
  await assert.rejects(removeEntityWithoutBlocker({ remove: fake.remove })({ id: "redirect-9" }), {
    message: "trash: 'redirect-9' reported 'blocked' from a type registered with no blocker — composition bug",
  });
  assert.deepEqual(fake.calls, [{ id: "redirect-9" }]);
});
