import { expect, test } from "vitest";
import { scopeOption } from "../scope-option.js";

// Stryker L3 (F3): an absent scope must produce NO key (a port distinguishes "no partition" from
// `scope: undefined`), while an empty-string scope is still a real, distinct partition.
test.each([
  [undefined, {}],
  ["", { scope: "" }],
  ["site-1", { scope: "site-1" }],
])("scopeOption(%j)", (scope, expected) => {
  expect(scopeOption(scope)).toStrictEqual(expected);
});
