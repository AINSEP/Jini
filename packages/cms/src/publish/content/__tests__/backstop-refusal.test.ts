import assert from "node:assert/strict";
import { test } from "vitest";

import { BackstopRefusal } from "../backstop-refusal.js";

/** Pins the refusal's identity: hosts and adapters tell an expected refusal apart from an
 *  unexpected storage/transport failure by `instanceof` and by the stable `name`. */
test("BackstopRefusal carries its caller-safe message and a stable name", () => {
  const refusal = new BackstopRefusal({ message: "Choose a regular file." });
  assert.ok(refusal instanceof Error);
  assert.ok(refusal instanceof BackstopRefusal);
  assert.equal(refusal.name, "BackstopRefusal");
  assert.equal(refusal.message, "Choose a regular file.");
});

test("a plain Error is never mistaken for a BackstopRefusal", () => {
  assert.equal(new Error("boom") instanceof BackstopRefusal, false);
});
