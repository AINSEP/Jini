import { expect, it } from "vitest";
import { isUnexpectedServerFailure } from "../server-failure.js";

it.each([
  ["network outage", { status: 0 }, true],
  ["first server failure", { status: 500 }, true],
  ["service unavailable", { status: 503 }, true],
  ["last client error", { status: 499 }, false],
  ["non-numeric server status", { status: "503" }, false],
  ["plain exception", new Error("Save failed"), false],
  ["absent exception", null, false],
] as const)("classifies %s for the shared failure notice", (_label, error, expected) => {
  expect(isUnexpectedServerFailure({ error })).toBe(expected);
});
