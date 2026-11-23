import { expect, test } from "vitest";
import { formsMailOutboxReady } from "../mail-outbox-readiness.js";

// Named mutation rejected: inverting the check (every other mail lane would claim outbox readiness).
test("only the forms mail lane reports its notification jobs as bound to the shared outbox", () => {
  expect(formsMailOutboxReady({ capabilityName: "forms" })).toBe(true);
  for (const capabilityName of ["members", "newsletter", "comments", "Forms", ""]) expect(formsMailOutboxReady({ capabilityName })).toBe(false);
});
