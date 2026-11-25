import { expect, it } from "vitest";
import { knownMappedErrorResponse } from "../route-helpers.js";

it("first typed refusal wins without rendering unknown exceptions", () => {
  class Parent extends Error {} class Child extends Parent {}
  const table = [[Parent, 409, "FIRST"], [Child, 400, "SECOND"]] as const;
  expect(knownMappedErrorResponse({ err: new Child("safe"), table })).toEqual({ status: 409, body: { error: "safe", code: "FIRST" } });
  expect(knownMappedErrorResponse({ err: new Error("private driver detail"), table })).toBeUndefined();
});
