import { expect, it } from "vitest";

import { AnalyticsPiiRejectedError } from "../ports.js";
import { redactPiiPathSegments, validateEventProps } from "../privacy.js";

const privacyPolicy = { maxEventPropCount: 3, maxEventPropStringLength: 14, sessionWindowMinutes: 5 };

it("redacts every email-shaped segment without disturbing malformed escapes or non-address at-signs", () => {
  expect(redactPiiPathSegments({ path: "/users/%E0%A4%A/alice%40example.test/@group/incomplete@/a@host./b@@host/charlie@some.test" }))
    .toBe("/users/%E0%A4%A/:redacted/@group/incomplete@/a@host./b@@host/:redacted");
  expect(redactPiiPathSegments({ path: "/malformed%XX@domain.test/notes" })).toBe("/:redacted/notes");
});

it("counts nested keys toward the aggregate bound while preserving a bag at the limit", () => {
  const allowed = { payload: { label: "short" }, total: 1 };
  expect(validateEventProps({ props: allowed, privacyPolicy })).toBe(allowed);
  expect(() => validateEventProps({ props: { payload: { label: "short", detail: null }, total: 1 }, privacyPolicy }))
    .toThrow(new AnalyticsPiiRejectedError({ message: "event properties exceed the 3-key bound" }));
});

it.each([
  { maxEventPropCount: 2.5 },
  { maxEventPropStringLength: 0 },
  { sessionWindowMinutes: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid policy bounds even when no properties are supplied (%j)", (override) => {
  expect(() => validateEventProps({ props: undefined, privacyPolicy: { ...privacyPolicy, ...override } }))
    .toThrow(new RangeError("analytics privacy bounds must be positive integers"));
});
