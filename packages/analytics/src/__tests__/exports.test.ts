import { expect, test } from "vitest";
import * as analytics from "../index.js";
import { AnalyticsPiiRejectedError } from "../ports.js";
// PARITY: the former platform namespace exposes the same class at the standalone entry.
test("analytics exports its ingestion refusal class", () => {
  expect(analytics.AnalyticsPiiRejectedError).toBe(AnalyticsPiiRejectedError);
});

// PARITY: moved policy errors preserve message and cause options.
test("policy refusal retains message and cause", () => {
  const cause = new Error("adapter failure");
  const error = new AnalyticsPiiRejectedError({ message: "policy refusal" }, { cause });
  expect(error.message).toBe("policy refusal");
  expect(error.cause).toBe(cause);
});
